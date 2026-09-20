import type { Habit, HabitRecord } from './types'

const SESSION_KEY = 'habit-helper-auth-session-v1'

export type AuthSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  user: { id: string; email?: string; user_metadata?: { name?: string } }
}

export type RemoteAppData = {
  user: { id: string; email: string; name: string }
  preferences: { dailyGoal: number; notificationsEnabled: boolean; aiReflectionEnabled: boolean }
  habits: Habit[]
  records: HabitRecord[]
}

const request = async <T>(path: string, session: AuthSession | null, init: RequestInit = {}, allowRefresh = true): Promise<T> => {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => null)
  if (response.status === 401 && session?.refresh_token && allowRefresh) {
    try {
      const renewed = await request<AuthSession>('/api/auth/refresh', null, { method: 'POST', body: JSON.stringify({ refreshToken: session.refresh_token }) }, false)
      saveSession(renewed)
      return request<T>(path, renewed, init, false)
    } catch {
      // The original authentication error is shown below when refresh fails.
    }
  }
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : '通信に失敗しました')
  return payload as T
}

export const getStoredSession = (): AuthSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as AuthSession : null
  } catch {
    return null
  }
}

export const saveSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export const clearSession = () => localStorage.removeItem(SESSION_KEY)

export const signIn = (email: string, password: string) => request<AuthSession>('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password }) })

export const signUp = (email: string, password: string, name: string) => request<AuthSession>('/api/auth/signup', null, { method: 'POST', body: JSON.stringify({ email, password, name }) })

export const fetchAppData = (session: AuthSession) => request<RemoteAppData>('/api/data', session)

export const createHabit = (session: AuthSession, habit: Omit<Habit, 'id' | 'createdAt'>) => request<Record<string, unknown>>('/api/habits', session, { method: 'POST', body: JSON.stringify(habit) })

export const updateHabit = (session: AuthSession, id: string, habit: Partial<Omit<Habit, 'id' | 'createdAt'>>) => request<Record<string, unknown>>(`/api/habits/${encodeURIComponent(id)}`, session, { method: 'PATCH', body: JSON.stringify(habit) })

export const deleteHabit = (session: AuthSession, id: string) => request<void>(`/api/habits/${encodeURIComponent(id)}`, session, { method: 'DELETE' })

export const upsertRecord = (session: AuthSession, values: { habitId: string; completedDate: string; note?: string; amount?: number }) => request<Record<string, unknown>>('/api/records', session, { method: 'POST', body: JSON.stringify(values) })

export const deleteRecord = (session: AuthSession, habitId: string, date: string) => request<void>(`/api/records?habitId=${encodeURIComponent(habitId)}&date=${encodeURIComponent(date)}`, session, { method: 'DELETE' })

export const updateProfile = (session: AuthSession, values: { displayName?: string; dailyGoal?: number; notificationsEnabled?: boolean; aiReflectionEnabled?: boolean }) => request<Record<string, unknown>>('/api/profile', session, { method: 'PATCH', body: JSON.stringify(values) })

export const resetUserData = (session: AuthSession) => request<void>('/api/data', session, { method: 'DELETE' })
