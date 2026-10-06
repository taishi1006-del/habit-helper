import type { Session } from '@supabase/supabase-js'
import type { Habit, HabitRecord } from './types'
import { supabase, supabaseConfigError } from './supabase'

const SESSION_KEY = 'habit-helper-auth-session-v1'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AuthSession = Session

export type RemoteAppData = {
  user: { id: string; email: string; name: string }
  preferences: { dailyGoal: number; notificationsEnabled: boolean; aiReflectionEnabled: boolean }
  habits: Habit[]
  records: HabitRecord[]
}

export class ApiRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const authErrorMessage = (error: { message?: string; code?: string; status?: number }) => {
  const message = String(error.message ?? '').toLowerCase()
  const code = String(error.code ?? '').toLowerCase()
  if (message.includes('invalid login credentials') || code === 'invalid_credentials') return 'メールアドレスまたはパスワードが正しくありません'
  if (message.includes('email not confirmed') || code === 'email_not_confirmed') return '確認メールのリンクを開いてからログインしてください'
  if (message.includes('user already registered') || code === 'user_already_exists') return 'このメールアドレスはすでに登録されています。ログインしてください'
  if (message.includes('password') && (message.includes('6') || message.includes('short'))) return 'パスワードは6文字以上で入力してください'
  if (message.includes('fetch') || message.includes('network') || error.status === 0) return 'Supabaseに接続できません。接続情報とネットワークを確認してください'
  return error.message || 'Supabase認証に失敗しました'
}

const getSupabase = () => {
  if (!supabase) throw new Error(supabaseConfigError)
  return supabase
}

const validateCredentials = (email: string, password: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !password) throw new Error('メールアドレスとパスワードを入力してください')
  if (!emailPattern.test(normalizedEmail)) throw new Error('正しいメールアドレスを入力してください')
  if (password.length < 6) throw new Error('パスワードは6文字以上で入力してください')
  return normalizedEmail
}

const request = async <T>(path: string, session: AuthSession | null, init: RequestInit = {}, allowRefresh = true): Promise<T> => {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiRequestError(0, 'アプリのAPIに接続できません。ネットワーク接続と、ローカルの場合は開発サーバーが起動しているか確認してください')
  }
  const payload = await response.json().catch(() => null)
  if (response.status === 401 && session?.refresh_token && allowRefresh) {
    try {
      const client = getSupabase()
      const renewed = await client.auth.refreshSession({ refresh_token: session.refresh_token })
      if (renewed.error || !renewed.data.session) throw renewed.error ?? new Error('セッションを更新できませんでした')
      saveSession(renewed.data.session)
      return request<T>(path, renewed.data.session, init, false)
    } catch {
      // The original authentication error is shown below when refresh fails.
    }
  }
  if (!response.ok) throw new ApiRequestError(response.status, typeof payload?.error === 'string' ? payload.error : '通信に失敗しました')
  if (response.status !== 204 && payload === null) throw new ApiRequestError(502, '保存APIから正しい応答がありません。開発サーバーまたはVercelのAPI設定を確認してください')
  return payload as T
}

export const getStoredSession = (): AuthSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) as AuthSession : null
    return parsed?.access_token && parsed?.refresh_token && parsed.user?.id ? parsed : null
  } catch {
    return null
  }
}

export const saveSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export const clearSession = () => localStorage.removeItem(SESSION_KEY)

export const getCurrentAuthSession = async (): Promise<AuthSession | null> => {
  const client = getSupabase()
  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(authErrorMessage(error))
  if (data.session) saveSession(data.session)
  else clearSession()
  return data.session
}

export const subscribeToAuthChanges = (onChange: (session: AuthSession | null) => void) => {
  if (!supabase) return () => undefined
  const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession) saveSession(nextSession)
    else clearSession()
    onChange(nextSession)
  })
  return () => data.subscription.unsubscribe()
}

export const signIn = async (email: string, password: string): Promise<AuthSession> => {
  const normalizedEmail = validateCredentials(email, password)
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: normalizedEmail, password })
  if (error) throw new Error(authErrorMessage(error))
  if (!data.session) throw new Error('ログインセッションを取得できませんでした')
  return data.session
}

export const signUp = async (email: string, password: string, name: string): Promise<AuthSession | null> => {
  const normalizedEmail = validateCredentials(email, password)
  const { data, error } = await getSupabase().auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: { name: name.trim().slice(0, 20) },
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throw new Error(authErrorMessage(error))
  return data.session
}

export const signOut = async (session: AuthSession | null) => {
  let error: { message?: string; code?: string; status?: number } | null = null
  if (supabase && session) {
    const result = await supabase.auth.signOut({ scope: 'local' })
    error = result.error
  }
  clearSession()
  if (error) throw new Error(authErrorMessage(error))
}

export const fetchAppData = (session: AuthSession) => request<RemoteAppData>('/api/data', session)

export const createHabit = (session: AuthSession, habit: Omit<Habit, 'id' | 'createdAt'>) => request<Record<string, unknown>>('/api/habits', session, { method: 'POST', body: JSON.stringify(habit) })

export const updateHabit = (session: AuthSession, id: string, habit: Partial<Omit<Habit, 'id' | 'createdAt'>>) => request<Record<string, unknown>>(`/api/habits/${encodeURIComponent(id)}`, session, { method: 'PATCH', body: JSON.stringify(habit, (_key, value) => value === undefined ? null : value) })

export const deleteHabit = (session: AuthSession, id: string) => request<void>(`/api/habits/${encodeURIComponent(id)}`, session, { method: 'DELETE' })

export const upsertRecord = (session: AuthSession, values: { habitId: string; completedDate: string; note?: string; amount?: number }) => request<Record<string, unknown>>('/api/records', session, { method: 'POST', body: JSON.stringify(values) })

export const deleteRecord = (session: AuthSession, habitId: string, date: string) => request<void>(`/api/records?habitId=${encodeURIComponent(habitId)}&date=${encodeURIComponent(date)}`, session, { method: 'DELETE' })

export const updateProfile = (session: AuthSession, values: { displayName?: string; dailyGoal?: number; notificationsEnabled?: boolean; aiReflectionEnabled?: boolean }) => request<Record<string, unknown>>('/api/profile', session, { method: 'PATCH', body: JSON.stringify(values) })

export const resetUserData = (session: AuthSession) => request<void>('/api/data', session, { method: 'DELETE' })
