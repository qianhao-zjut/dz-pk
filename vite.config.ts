import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

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
    }
  ],
})
