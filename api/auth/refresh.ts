import { readJson, sendError, supabaseAuthRequest } from '../_shared.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const body = await readJson(req)
    if (typeof body.refreshToken !== 'string' || !body.refreshToken) return res.status(400).json({ error: 'リフレッシュトークンがありません' })
    const session = await supabaseAuthRequest('token?grant_type=refresh_token', { refresh_token: body.refreshToken })
    return res.status(200).json(session)
  } catch (error) {
    return sendError(res, error)
  }
}
