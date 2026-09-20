import { readJson, sendError, supabaseAuthRequest } from '../_shared'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 20) : ''
    if (!email || password.length < 6) return res.status(400).json({ error: 'メールアドレスと6文字以上のパスワードを入力してください' })
    const result = await supabaseAuthRequest('signup', { email, password, data: { name } })
    return res.status(200).json(result)
  } catch (error) {
    return sendError(res, error)
  }
}
