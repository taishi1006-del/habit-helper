import { readJson, sendError, supabaseAuthRequest } from '../_shared'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' })
    const session = await supabaseAuthRequest('token?grant_type=password', { email, password })
    return res.status(200).json(session)
  } catch (error) {
    return sendError(res, error)
  }
}
