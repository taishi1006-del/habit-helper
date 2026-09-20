import { dbJson, habitPayload, readJson, requireUser, sendError, userFilter } from './_shared.js'

export default async function handler(req: any, res: any) {
  try {
    const user = await requireUser(req, res)
    if (req.method === 'GET') {
      const rows = await dbJson(`habits?select=*&${userFilter(user.id)}&order=created_at.asc`)
      return res.status(200).json(rows)
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
    const body = await readJson(req)
    const payload = habitPayload(body)
    const rows = await dbJson('habits?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, user_id: user.id }),
    }) as Record<string, any>[]
    return res.status(201).json(rows[0])
  } catch (error) {
    return sendError(res, error)
  }
}
