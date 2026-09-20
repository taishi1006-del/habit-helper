import { dbJson, dbRequest, mapHabit, mapRecord, requireUser, sendError, userFilter } from './_shared.js'

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    const filter = userFilter(user.id)

    if (req.method === 'DELETE') {
      const recordsResponse = await dbRequest(`habit_records?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      if (!recordsResponse.ok) throw new Error('達成記録のリセットに失敗しました')
      const habitsResponse = await dbRequest(`habits?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      if (!habitsResponse.ok) throw new Error('データのリセットに失敗しました')
      return res.status(204).end()
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })

    let profiles = await dbJson(`users?select=id,name,email,daily_goal,notifications_enabled,ai_reflection_enabled&id=eq.${encodeURIComponent(user.id)}&limit=1`) as Record<string, any>[]
    if (!profiles.length) {
      await dbJson('users?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: user.id, name: String(user.user_metadata?.name ?? ''), email: user.email ?? '' }),
      })
      profiles = await dbJson(`users?select=id,name,email,daily_goal,notifications_enabled,ai_reflection_enabled&id=eq.${encodeURIComponent(user.id)}&limit=1`) as Record<string, any>[]
    }

    const [habitRows, recordRows] = await Promise.all([
      dbJson(`habits?select=*&${filter}&order=created_at.asc`) as Promise<Record<string, any>[]>,
      dbJson(`habit_records?select=*&${filter}&order=date.desc`) as Promise<Record<string, any>[]>,
    ])
    const profile = profiles[0] ?? {}
    return res.status(200).json({
      user: { id: user.id, email: user.email ?? profile.email ?? '', name: profile.name ?? '' },
      preferences: {
        dailyGoal: profile.daily_goal ?? 3,
        notificationsEnabled: profile.notifications_enabled ?? false,
        aiReflectionEnabled: profile.ai_reflection_enabled ?? true,
      },
      habits: habitRows.map(mapHabit),
      records: recordRows.map(mapRecord),
    })
  } catch (error) {
    return sendError(res, error)
  }
}
