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

const config = () => {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) throw new ApiError(500, 'Supabaseの環境変数が設定されていません')
  return { url: url.replace(/\/$/, ''), anonKey, serviceRoleKey }
}

const getAuthorization = (req: ApiRequest) => {
  const value = req.headers?.authorization ?? req.headers?.Authorization
  return Array.isArray(value) ? value[0] : value
}

export async function requireUser(req: ApiRequest, res: ApiResponse) {
  const { url, anonKey } = config()
  const authorization = getAuthorization(req)
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'ログインが必要です')

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization,
    },
  })
  if (!response.ok) throw new ApiError(401, 'ログインセッションが無効です')
  const user = await response.json() as AuthUser
  if (!user.id) throw new ApiError(401, 'ユーザーを確認できません')
  return user
}

export async function supabaseAuthRequest(path: string, body: unknown) {
  const { url, anonKey } = config()
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) throw new ApiError(response.status === 400 ? 400 : 401, payload.error_description ?? payload.msg ?? payload.message ?? '認証に失敗しました')
  return payload
}

export async function dbRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = config()
  const headers = new Headers(init.headers)
  headers.set('apikey', serviceRoleKey)
  headers.set('Authorization', `Bearer ${serviceRoleKey}`)
  headers.set('Content-Type', 'application/json')
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers })
}

export async function dbJson(path: string, init: RequestInit = {}) {
  const response = await dbRequest(path, init)
  const payload = await response.json().catch(() => null) as Record<string, any> | null
  if (!response.ok) throw new ApiError(500, typeof payload?.message === 'string' ? payload.message : 'データベース操作に失敗しました')
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
