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
  accessToken: string
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code = 'API_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

const authConfig = () => {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !anonKey) {
    const missing = [!url ? 'VITE_SUPABASE_URL' : '', !anonKey ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : ''].filter(Boolean).join(' / ')
    throw new ApiError(500, `Supabase接続設定がありません。${missing}を設定し、開発サーバーを再起動してください。サーバー専用のSUPABASE_URL / SUPABASE_PUBLISHABLE_KEYでも設定できます。`, 'SUPABASE_ENV_MISSING')
  }
  return { url: url.replace(/\/$/, ''), anonKey }
}

const connectionError = (error: unknown, operation: string) => {
  const cause = error instanceof Error ? error.cause as { code?: unknown; errors?: { code?: unknown }[] } | undefined : undefined
  // Report only known transport codes, never URLs, keys, headers or tokens.
  const allowed = new Set(['EACCES', 'EPERM', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'])
  const codes = [...new Set([cause?.code, ...(cause?.errors?.map((item) => item.code) ?? [])].filter((value): value is string => typeof value === 'string' && allowed.has(value)))]
  const denied = codes.some((code) => code === 'EACCES' || code === 'EPERM')
  const category = denied ? 'SUPABASE_NETWORK_DENIED' : 'SUPABASE_NETWORK_ERROR'
  console.error('[Supabase connection]', { operation, code: category, transportCodes: codes })
  const hint = denied
    ? 'APIサーバーの外部通信が拒否されています。サーバーの実行環境に通信許可があるか確認してください。'
    : 'APIサーバーのネットワーク接続とSupabase URLを確認してください。'
  return new ApiError(502, `APIサーバーからSupabaseへ接続できません。${hint}${codes.length ? `（${codes.join(', ')}）` : ''}`, category)
}

const invalidApiKey = (payload: Record<string, any> | null) => payload?.code === 'invalid_api_key' || /invalid api key|invalid apikey/i.test(String(payload?.message ?? payload?.msg ?? ''))
const keyError = () => new ApiError(502, 'Supabaseの公開キーが正しくありません。VITE_SUPABASE_PUBLISHABLE_KEY（またはSUPABASE_PUBLISHABLE_KEY）を確認してください。', 'SUPABASE_KEY_INVALID')

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
  } catch (error) {
    throw connectionError(error, 'auth.user')
  }
  const payload = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok) {
    if (invalidApiKey(payload)) throw keyError()
    if (response.status === 401 || response.status === 403) throw new ApiError(401, 'ログインセッションが無効です', 'SESSION_INVALID')
    if (response.status === 429) throw new ApiError(429, 'Supabaseへのアクセスが集中しています。少し待って再試行してください。', 'SUPABASE_RATE_LIMITED')
    throw new ApiError(502, `Supabase認証サーバーがエラーを返しました（HTTP ${response.status}）。時間をおいて再試行してください。`, 'SUPABASE_AUTH_ERROR')
  }
  if (!payload) throw new ApiError(502, 'Supabase認証サーバーから正しい応答がありません。', 'SUPABASE_AUTH_RESPONSE_INVALID')
  const user = payload as Omit<AuthUser, 'accessToken'>
  if (!user.id) throw new ApiError(401, 'ユーザーを確認できません')
  return { ...user, accessToken: authorization.slice('Bearer '.length) }
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
  } catch (error) {
    throw connectionError(error, 'auth.request')
  }
  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) {
    const code = String(payload.error ?? payload.code ?? '')
    const message = payload.error_description ?? payload.msg ?? payload.message
    if (code === 'invalid_credentials') throw new ApiError(400, 'メールアドレスまたはパスワードが正しくありません')
    if (code === 'email_not_confirmed') throw new ApiError(400, '確認メールのリンクを開いてからログインしてください')
    if (code === 'invalid_api_key' || response.status === 401 && /api.?key/i.test(String(message ?? ''))) {
      throw keyError()
    }
    if (response.status >= 500) throw new ApiError(502, 'Supabase側でエラーが発生しました。時間をおいて再試行してください')
    throw new ApiError(response.status === 400 ? 400 : 401, message ?? '認証に失敗しました')
  }
  return payload
}

export async function dbRequest(path: string, init: RequestInit = {}, accessToken: string) {
  const { url, anonKey } = authConfig()
  const headers = new Headers(init.headers)
  headers.set('apikey', anonKey)
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set('Content-Type', 'application/json')
  try {
    return await fetch(`${url}/rest/v1/${path}`, { ...init, headers })
  } catch (error) {
    throw connectionError(error, 'database.request')
  }
}

export async function dbJson(path: string, init: RequestInit = {}, accessToken: string) {
  const response = await dbRequest(path, init, accessToken)
  const payload = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok) {
    if (invalidApiKey(payload)) throw keyError()
    const message = typeof payload?.message === 'string' ? payload.message : typeof payload?.hint === 'string' ? payload.hint : 'データベース操作に失敗しました'
    const status = response.status === 401 || response.status === 403 ? response.status : 500
    const code = response.status === 403 || payload?.code === '42501' ? 'SUPABASE_RLS_DENIED' : response.status === 401 ? 'SESSION_INVALID' : 'SUPABASE_DB_ERROR'
    throw new ApiError(status, message, code)
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
  return res.status(apiError.status).json({ error: apiError.message, code: apiError.code })
}

export function mapHabit(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? '💧',
    // Rows created before frequency settings existed are treated as daily.
    frequencyType: row.frequency_type ?? 'daily',
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

const frequencyTypes = ['daily', 'weekly', 'monthly', 'selected_days'] as const

const normalizeSelectedDays = (value: unknown) => {
  if (!Array.isArray(value)) throw new ApiError(400, '曜日を正しく選択してください')
  const days = value.map((day) => {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7) {
      throw new ApiError(400, '曜日は月曜=1から日曜=7の範囲で指定してください')
    }
    return day
  })
  return [...new Set(days)].sort((left, right) => left - right)
}

const normalizeInteger = (value: unknown, min: number, max: number, message: string) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, message)
  }
  return value
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function habitPayload(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const frequencyType = String(body.frequencyType ?? 'daily')
  if (!name || !frequencyTypes.includes(frequencyType as typeof frequencyTypes[number])) throw new ApiError(400, '習慣名と頻度を入力してください')
  const targetPerWeek = frequencyType === 'weekly'
    ? normalizeInteger(body.targetPerWeek, 1, 7, '週の目標は1〜7回で指定してください')
    : null
  const targetPerMonth = frequencyType === 'monthly'
    ? normalizeInteger(body.targetPerMonth, 1, 31, '月の目標は1〜31回で指定してください')
    : null
  const selectedDays = frequencyType === 'selected_days' ? normalizeSelectedDays(body.selectedDays) : null
  if (frequencyType === 'selected_days' && selectedDays?.length === 0) throw new ApiError(400, '曜日を1つ以上選択してください')
  // Use the browser's calendar date, never a UTC-based replacement.
  if (!isValidDate(body.startDate)) throw new ApiError(400, '正しい開始日を入力してください')
  if (body.endDate != null && body.endDate !== '' && (!isValidDate(body.endDate) || body.endDate < body.startDate)) throw new ApiError(400, '終了日は開始日以降の正しい日付にしてください')
  return {
    name,
    icon: typeof body.icon === 'string' ? body.icon.slice(0, 8) : '💧',
    frequency_type: frequencyType,
    target_per_week: targetPerWeek,
    target_per_month: targetPerMonth,
    target_value: typeof body.targetValue === 'number' && body.targetValue > 0 ? body.targetValue : null,
    target_unit: typeof body.targetUnit === 'string' ? body.targetUnit : null,
    selected_days: selectedDays,
    reminder_enabled: body.reminderEnabled !== false,
    reminder_time: typeof body.reminderTime === 'string' ? body.reminderTime : '20:00',
    smart_reminder: body.smartReminder === true,
    start_date: body.startDate,
    end_date: typeof body.endDate === 'string' && body.endDate ? body.endDate : null,
    tone: typeof body.tone === 'string' ? body.tone : 'mint',
  }
}
