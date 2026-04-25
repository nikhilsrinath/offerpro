import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so the API key is available for the dev proxy
  const env = loadEnv(mode, process.cwd(), '')
  const nvidiaKey = env.VITE_NVIDIA_API_KEY || env.NVIDIA_API_KEY || ''

  if (!nvidiaKey) {
    console.warn('[vite] NVIDIA_API_KEY not found in .env — AI will not work on localhost')
  }

  return {
    plugins: [
      react(),
      {
        name: 'admin-route',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/admin' || req.url?.startsWith('/admin?')) {
              req.url = '/admin/index.html'
            }
            next()
          })
        },
      },
      {
        name: 'dev-api-email',
        configureServer(server) {
          server.middlewares.use('/api/email', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Allow', 'POST')
              res.end(JSON.stringify({ success: false, error: 'Method not allowed' }))
              return
            }
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                req.body = body ? JSON.parse(body) : {}
                const resShim = {
                  statusCode: 200,
                  setHeader: (k, v) => res.setHeader(k, v),
                  status(code) { this.statusCode = code; return this },
                  json(payload) {
                    res.statusCode = this.statusCode
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(payload))
                  },
                }
                const mod = await server.ssrLoadModule('/api/email.js')
                await mod.default(req, resShim)
              } catch (err) {
                console.error('[dev-api-email] error:', err)
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ success: false, error: err?.message || 'dev server error' }))
              }
            })
          })
        },
      },
    ],
    server: {
      proxy: {
        // On localhost: proxy /api/nvidia directly to NVIDIA's completions endpoint,
        // injecting the API key the same way the Vercel serverless function does in prod.
        '/api/nvidia': {
          target: 'https://integrate.api.nvidia.com',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/v1/chat/completions',
          headers: {
            Authorization: `Bearer ${nvidiaKey}`,
            Accept: 'text/event-stream',
          },
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin/index.html'),
        },
      },
    },
  }
})
