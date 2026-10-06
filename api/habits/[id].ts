import { dbJson, habitPayload, mapHabit, readJson, requireUser, routeParam, sendError, userFilter } from '../_shared.js'

const allowedFields = ['name', 'icon', 'frequencyType', 'targetPerWeek', 'targetPerMonth', 'targetValue', 'targetUnit', 'selectedDays', 'reminderEnabled', 'reminderTime', 'smartReminder', 'startDate', 'endDate', 'tone'] as const

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    const id = routeParam(req, 'id')
    if (!id) return res.status(400).json({ error: '習慣IDがありません' })
    const filter = `id=eq.${encodeURIComponent(id)}&${userFilter(user.id)}`

    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const currentRows = await dbJson(`habits?${filter}&select=*&limit=1`, {}, user.accessToken) as Record<string, any>[]
      if (!currentRows.length) return res.status(404).json({ error: '習慣が見つかりません' })
      // Validate the merged habit, including partial edits, using creation rules.
      const values = Object.fromEntries(allowedFields.filter((field) => field in body).map((field) => [field, body[field]]))
      const updates = habitPayload({ ...mapHabit(currentRows[0]), ...values })
      const rows = await dbJson(`habits?${filter}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) }, user.accessToken) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '習慣が見つかりません' })
      return res.status(200).json(rows[0])
    }
    if (req.method === 'DELETE') {
      const rows = await dbJson(`habits?${filter}&select=id`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }, user.accessToken) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '習慣が見つかりません' })
      return res.status(204).end()
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (error) {
    return sendError(res, error)
  }
}
