import { dbJson, readJson, requireUser, sendError } from './_shared'

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' })
    const body = await readJson(req)
    const updates: Record<string, unknown> = {}
    if (typeof body.displayName === 'string') updates.name = body.displayName.trim().slice(0, 20)
    if (typeof body.dailyGoal === 'number') updates.daily_goal = Math.min(20, Math.max(1, Math.round(body.dailyGoal)))
    if (typeof body.notificationsEnabled === 'boolean') updates.notifications_enabled = body.notificationsEnabled
    if (typeof body.aiReflectionEnabled === 'boolean') updates.ai_reflection_enabled = body.aiReflectionEnabled
    if (!Object.keys(updates).length) return res.status(400).json({ error: '更新内容がありません' })
    const rows = await dbJson(`users?id=eq.${encodeURIComponent(user.id)}&select=id,name,email,daily_goal,notifications_enabled,ai_reflection_enabled`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) }) as Record<string, any>[]
    return res.status(200).json(rows[0] ?? {})
  } catch (error) {
    return sendError(res, error)
  }
}
