import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { handleActRequest } from './actQueue.mjs'

const DATA = process.env.BANKROLL_PATH || '/data/bankroll.json'
const PORT = Number(process.env.PORT || 3001)
const DEFAULT = { balance: 10000 }

function readBalance() {
  try {
    if (fs.existsSync(DATA)) {
      const parsed = JSON.parse(fs.readFileSync(DATA, 'utf-8'))
      if (parsed && typeof parsed.balance === 'number') return parsed
    }
  } catch (err) {
    console.error('read bankroll failed', err)
  }
  return { ...DEFAULT }
}

function writeBalance(body) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true })
  fs.writeFileSync(DATA, body)
}

const server = http.createServer((req, res) => {
  if (handleActRequest(req, res)) return

  const url = (req.url || '').split('?')[0]
  if (url !== '/api/bankroll' && url !== '/api/bankroll/') {
    res.writeHead(404)
    res.end('not found')
    return
  }

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(readBalance()))
    return
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 16) req.destroy()
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        if (typeof parsed?.balance !== 'number') {
          res.writeHead(400)
          res.end('invalid body')
          return
        }
        writeBalance(JSON.stringify({ balance: parsed.balance }))
        res.end('ok')
      } catch {
        res.writeHead(400)
        res.end('invalid json')
      }
    })
    return
  }

  res.writeHead(405)
  res.end('method not allowed')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`bankroll api listening on ${PORT}, data=${DATA}`)
})
