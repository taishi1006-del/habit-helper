import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'habit-helper-local-api',
    configureServer(server) {
      // Reuse the production handlers locally; never provide an administrative key.
      const env = loadEnv(server.config.mode, server.config.root, '')
      const runtime = globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } }
      for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
        if (!runtime.process.env[name] && env[name]) runtime.process.env[name] = env[name]
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        const match = url.pathname.match(/^\/api\/(data|habits|records|profile)(?:\/([^/]+))?\/?$/)
        if (!match || (match[2] && match[1] !== 'habits')) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'APIが見つかりません' }))
          return
        }
        try {
          let body = ''
          req.setEncoding('utf8')
          for await (const chunk of req) {
            body += chunk
            if (body.length > 65536) {
              res.statusCode = 413
              res.end(JSON.stringify({ error: '入力が大きすぎます' }))
              return
            }
          }
          let parsedBody: unknown
          try { parsedBody = body ? JSON.parse(body) : undefined } catch {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '入力形式が正しくありません' }))
            return
          }
          const path = match[2] ? '/api/habits/[id].ts' : `/api/${match[1]}.ts`
          const module = await server.ssrLoadModule(path)
          const response = {
            status(code: number) { res.statusCode = code; return response },
            json(value: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) },
            end() { res.end() },
          }
          await module.default({ method: req.method, headers: req.headers, url: req.url, body: parsedBody, query: { ...Object.fromEntries(url.searchParams), ...(match[2] ? { id: decodeURIComponent(match[2]) } : {}) } }, response)
        } catch {
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'ローカルAPIを実行できません。接続設定を確認してください' }))
          }
        }
      })
    },
  }],
})
