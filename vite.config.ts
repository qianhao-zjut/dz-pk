import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import http from 'http'
import path from 'path'

// 记录库地址：本地 dev 时由 vite middleware 把 /v1/* 转发过去（与线上 nginx 反代同路径）
const RECORDSTORE_URL = process.env.RECORDSTORE_URL || 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bankroll-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/bankroll') {
            const dbPath = path.resolve(__dirname, 'bankroll.json')
            if (req.method === 'GET') {
              if (fs.existsSync(dbPath)) {
                res.setHeader('Content-Type', 'application/json')
                res.end(fs.readFileSync(dbPath, 'utf-8'))
              } else {
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ balance: 10000 }))
              }
              return
            } else if (req.method === 'POST') {
              let body = ''
              req.on('data', chunk => { body += chunk })
              req.on('end', () => {
                fs.writeFileSync(dbPath, body)
                res.end('ok')
              })
              return
            }
          }
          next()
        })
      }
    },
    {
      name: 'recordstore-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.startsWith('/v1/')) {
            next()
            return
          }
          const chunks: Buffer[] = []
          req.on('data', (chunk) => chunks.push(chunk))
          req.on('end', () => {
            const body = Buffer.concat(chunks)
            const target = new URL(req.url!, RECORDSTORE_URL)
            const proxyReq = http.request(
              {
                method: req.method,
                hostname: target.hostname,
                port: target.port,
                path: target.pathname + target.search,
                headers: {
                  'Content-Type': req.headers['content-type'] || 'application/json',
                  'Content-Length': body.length,
                },
                timeout: 5000,
              },
              (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 502, {
                  'Content-Type': proxyRes.headers['content-type'] || 'application/json',
                })
                proxyRes.pipe(res)
              }
            )
            proxyReq.on('timeout', () => proxyReq.destroy())
            proxyReq.on('error', () => {
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' })
              }
              res.end(JSON.stringify({ error: 'bad_gateway', message: 'recordstore unreachable' }))
            })
            proxyReq.write(body)
            proxyReq.end()
          })
        })
      }
    }
  ],
})
