import { ApiError, dbJson, dbRequest, readJson, requireUser, routeParam, sendError, userFilter } from '../_shared'

const allowedFields = ['name', 'icon', 'frequencyType', 'targetPerWeek', 'targetPerMonth', 'targetValue', 'targetUnit', 'selectedDays', 'reminderEnabled', 'reminderTime', 'smartReminder', 'startDate', 'endDate', 'tone'] as const

const toDbUpdates = (body: Record<string, unknown>) => {
  const updates: Record<string, unknown> = {}
  const mapping: Record<string, string> = {
    name: 'name', icon: 'icon', frequencyType: 'frequency_type', targetPerWeek: 'target_per_week', targetPerMonth: 'target_per_month', targetValue: 'target_value', targetUnit: 'target_unit', selectedDays: 'selected_days', reminderEnabled: 'reminder_enabled', reminderTime: 'reminder_time', smartReminder: 'smart_reminder', startDate: 'start_date', endDate: 'end_date', tone: 'tone',
  }
  allowedFields.forEach((field) => {
    if (field in body) updates[mapping[field]] = body[field] === '' ? null : body[field]
  })
  if (typeof updates.name === 'string') updates.name = updates.name.trim().slice(0, 80)
  if (!updates.name && 'name' in updates) throw new ApiError(400, '習慣名を入力してください')
  return updates
}

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    const id = routeParam(req, 'id')
    if (!id) return res.status(400).json({ error: '習慣IDがありません' })
    const filter = `id=eq.${encodeURIComponent(id)}&${userFilter(user.id)}`

    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const updates = toDbUpdates(body)
      const rows = await dbJson(`habits?${filter}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) }) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '習慣が見つかりません' })
      return res.status(200).json(rows[0])
    }
    if (req.method === 'DELETE') {
      const rows = await dbJson(`habits?${filter}&select=id`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }) as Record<string, any>[]
      if (!rows.length) return res.status(404).json({ error: '習慣が見つかりません' })
      return res.status(204).end()
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (error) {
    return sendError(res, error)
  }
}
