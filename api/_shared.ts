type ApiRequest = {
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[] | undefined>
  url?: string
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
}

type AuthUser = {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const authConfig = () => {
  const url = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) throw new ApiError(500, 'Supabase認証用の環境変数（SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY または SUPABASE_ANON_KEY）が設定されていません')
  return { url: url.replace(/\/$/, ''), anonKey }
}

const dbConfig = () => {
  const { url, anonKey } = authConfig()
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim()
  const legacyServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const serviceRoleKey = secretKey || legacyServiceRoleKey
  if (!serviceRoleKey) throw new ApiError(500, 'Supabase DB用の環境変数（SUPABASE_SECRET_KEY または SUPABASE_SERVICE_ROLE_KEY）が設定されていません')
  return { url, anonKey, serviceRoleKey, isNewSecretKey: Boolean(secretKey) }
}

const getAuthorization = (req: ApiRequest) => {
  const value = req.headers?.authorization ?? req.headers?.Authorization
  return Array.isArray(value) ? value[0] : value
}

export async function requireUser(req: ApiRequest, res: ApiResponse) {
  const { url, anonKey } = authConfig()
  const authorization = getAuthorization(req)
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'ログインが必要です')

  let response: Response
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: authorization,
      },
    })
  } catch {
    throw new ApiError(502, 'Supabaseへ接続できません。VercelのSUPABASE_URLが正しいか確認してください')
  }
  if (!response.ok) throw new ApiError(401, 'ログインセッションが無効です')
  const user = await response.json() as AuthUser
  if (!user.id) throw new ApiError(401, 'ユーザーを確認できません')
  return user
}

export async function supabaseAuthRequest(path: string, body: unknown) {
  const { url, anonKey } = authConfig()
  let response: Response
  try {
    response = await fetch(`${url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(502, 'Supabaseへ接続できません。VercelのSUPABASE_URLが正しいか確認してください')
  }
  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) {
    const code = String(payload.error ?? payload.code ?? '')
    const message = payload.error_description ?? payload.msg ?? payload.message
    if (code === 'invalid_credentials') throw new ApiError(400, 'メールアドレスまたはパスワードが正しくありません')
    if (code === 'email_not_confirmed') throw new ApiError(400, '確認メールのリンクを開いてからログインしてください')
    if (code === 'invalid_api_key' || response.status === 401 && /api.?key/i.test(String(message ?? ''))) {
      throw new ApiError(502, 'SupabaseのAPIキーが正しくありません。VercelのSUPABASE_PUBLISHABLE_KEYを確認してください')
    }
    if (response.status >= 500) throw new ApiError(502, 'Supabase側でエラーが発生しました。時間をおいて再試行してください')
    throw new ApiError(response.status === 400 ? 400 : 401, message ?? '認証に失敗しました')
  }
  return payload
}

export async function dbRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey, isNewSecretKey } = dbConfig()
  const headers = new Headers(init.headers)
  headers.set('apikey', serviceRoleKey)
  // 新しい sb_secret_* キーはJWTではないため、Authorizationへ入れるとInvalid JWTになります。
  // 旧 service_role JWTだけは従来どおりBearerとしても送ります。
  if (!isNewSecretKey) headers.set('Authorization', `Bearer ${serviceRoleKey}`)
  headers.set('Content-Type', 'application/json')
  try {
    return await fetch(`${url}/rest/v1/${path}`, { ...init, headers })
  } catch {
    throw new ApiError(502, 'Supabaseデータベースへ接続できません。VercelのSUPABASE_URLを確認してください')
  }
}

export async function dbJson(path: string, init: RequestInit = {}) {
  const response = await dbRequest(path, init)
  const payload = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : typeof payload?.hint === 'string' ? payload.hint : 'データベース操作に失敗しました'
    const status = response.status === 401 || response.status === 403 ? response.status : 500
    throw new ApiError(status, message)
  }
  return payload
}

export async function readJson(req: ApiRequest) {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>
  if (typeof req.body === 'string') return JSON.parse(req.body) as Record<string, unknown>
  return {}
}

export function userFilter(userId: string) {
  return `user_id=eq.${encodeURIComponent(userId)}`
}

export function routeParam(req: ApiRequest, name: string) {
  const value = req.query?.[name]
  if (Array.isArray(value)) return value[0]
  if (value) return value
  const pathname = req.url?.split('?')[0] ?? ''
  const parts = pathname.split('/').filter(Boolean)
  const index = parts.lastIndexOf(name)
  return index >= 0 ? parts[index + 1] : parts[parts.length - 1]
}

export function sendError(res: ApiResponse, error: unknown) {
  const apiError = error instanceof ApiError ? error : new ApiError(500, 'サーバーエラーが発生しました')
  return res.status(apiError.status).json({ error: apiError.message })
}

export function mapHabit(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? '💧',
    frequencyType: row.frequency_type,
    targetPerWeek: row.target_per_week ?? undefined,
    targetPerMonth: row.target_per_month ?? undefined,
    targetValue: row.target_value ?? undefined,
    targetUnit: row.target_unit ?? undefined,
    selectedDays: row.selected_days ?? undefined,
    reminderEnabled: row.reminder_enabled ?? true,
    reminderTime: row.reminder_time ?? '20:00',
    smartReminder: row.smart_reminder ?? false,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    createdAt: row.created_at,
    tone: row.tone ?? 'mint',
  }
}

export function mapRecord(row: Record<string, any>) {
  return {
    id: row.id,
    habitId: row.habit_id,
    completedDate: row.date,
    note: row.memo ?? undefined,
    amount: row.amount ?? undefined,
    createdAt: row.created_at,
  }
}

export function habitPayload(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const frequencyType = body.frequencyType
  if (!name || !['daily', 'weekly', 'monthly', 'selected_days'].includes(String(frequencyType))) throw new ApiError(400, '習慣名と頻度を入力してください')
  return {
    name,
    icon: typeof body.icon === 'string' ? body.icon.slice(0, 8) : '💧',
    frequency_type: frequencyType,
    target_per_week: typeof body.targetPerWeek === 'number' ? body.targetPerWeek : null,
    target_per_month: typeof body.targetPerMonth === 'number' ? body.targetPerMonth : null,
    target_value: typeof body.targetValue === 'number' && body.targetValue > 0 ? body.targetValue : null,
    target_unit: typeof body.targetUnit === 'string' ? body.targetUnit : null,
    selected_days: Array.isArray(body.selectedDays) ? body.selectedDays.filter((day) => typeof day === 'number') : null,
    reminder_enabled: body.reminderEnabled !== false,
    reminder_time: typeof body.reminderTime === 'string' ? body.reminderTime : '20:00',
    smart_reminder: body.smartReminder === true,
    start_date: typeof body.startDate === 'string' ? body.startDate : new Date().toISOString().slice(0, 10),
    end_date: typeof body.endDate === 'string' && body.endDate ? body.endDate : null,
    tone: typeof body.tone === 'string' ? body.tone : 'mint',
  }
}
