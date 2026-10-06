import { dbJson, isValidDate, requireUser, sendError, userFilter } from './_shared.js'

const readBody = (req: any) => typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})

const ownedHabit = async (userId: string, habitId: string, accessToken: string) => {
  const rows = await dbJson(`habits?select=id&id=eq.${encodeURIComponent(habitId)}&${userFilter(userId)}&limit=1`, {}, accessToken) as Record<string, any>[]
  return rows.length > 0
}

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = readBody(req)
      const habitId = typeof body.habitId === 'string' ? body.habitId : ''
      const date = typeof body.completedDate === 'string' ? body.completedDate : ''
      if (!habitId || !isValidDate(date)) return res.status(400).json({ error: '習慣と正しい日付が必要です' })
      if (!await ownedHabit(user.id, habitId, user.accessToken)) return res.status(404).json({ error: '習慣が見つかりません' })
      const values: Record<string, unknown> = { user_id: user.id, habit_id: habitId, date, completed: true }
      // Rechecking must not erase a previously saved memo or amount.
      if ('note' in body) values.memo = typeof body.note === 'string' ? body.note.trim().slice(0, 120) || null : null
      if ('amount' in body) {
        if (body.amount != null && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0)) {
          return res.status(400).json({ error: '実績は0以上の数値で入力してください' })
        }
        values.amount = body.amount ?? null
      }
      const rows = await dbJson('habit_records?on_conflict=user_id,habit_id,date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(values),
      }, user.accessToken) as Record<string, any>[]
      return res.status(200).json(rows[0])
    }
    if (req.method === 'DELETE') {
      const habitId = typeof req.query?.habitId === 'string' ? req.query.habitId : ''
      const date = typeof req.query?.date === 'string' ? req.query.date : ''
      if (!habitId || !isValidDate(date)) return res.status(400).json({ error: '習慣と正しい日付が必要です' })
      if (!await ownedHabit(user.id, habitId, user.accessToken)) return res.status(404).json({ error: '習慣が見つかりません' })
      // Undo changes only this day's flag. History and memos are retained.
      const rows = await dbJson(`habit_records?habit_id=eq.${encodeURIComponent(habitId)}&date=eq.${encodeURIComponent(date)}&${userFilter(user.id)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ completed: false }) }, user.accessToken) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '達成記録が見つかりません' })
      return res.status(204).end()
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (error) {
    return sendError(res, error)
  }
}
