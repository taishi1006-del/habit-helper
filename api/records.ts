import { dbJson, requireUser, sendError, userFilter } from './_shared'

const readBody = (req: any) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})

const ownedHabit = async (userId: string, habitId: string) => {
  const rows = await dbJson(`habits?select=id&id=eq.${encodeURIComponent(habitId)}&${userFilter(userId)}&limit=1`) as Record<string, any>[]
  return rows.length > 0
}

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = readBody(req)
      const habitId = typeof body.habitId === 'string' ? body.habitId : ''
      const date = typeof body.completedDate === 'string' ? body.completedDate : ''
      if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '習慣と日付が必要です' })
      if (!await ownedHabit(user.id, habitId)) return res.status(404).json({ error: '習慣が見つかりません' })
      const rows = await dbJson('habit_records?on_conflict=user_id,habit_id,date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ user_id: user.id, habit_id: habitId, date, completed: true, memo: typeof body.note === 'string' ? body.note.trim().slice(0, 120) || null : null, amount: typeof body.amount === 'number' && body.amount >= 0 ? body.amount : null }),
      }) as Record<string, any>[]
      return res.status(200).json(rows[0])
    }
    if (req.method === 'DELETE') {
      const habitId = typeof req.query?.habitId === 'string' ? req.query.habitId : ''
      const date = typeof req.query?.date === 'string' ? req.query.date : ''
      if (!habitId || !date) return res.status(400).json({ error: '習慣と日付が必要です' })
      const rows = await dbJson(`habit_records?habit_id=eq.${encodeURIComponent(habitId)}&date=eq.${encodeURIComponent(date)}&${userFilter(user.id)}&select=id`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '達成記録が見つかりません' })
      return res.status(204).end()
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (error) {
    return sendError(res, error)
  }
}
