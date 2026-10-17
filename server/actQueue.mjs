// 动作信箱。牌局状态在浏览器里，这里只暂存一条外部动作，等页面取走并回报结果。
// POST /api/act 会等到页面执行完，或 8 秒内没人来取。

const ACT_TIMEOUT_MS = 8000
const ACTIONS = new Set(['fold', 'check', 'call', 'raise', 'allin', 'deal', 'rebuy'])
const PAGE_ERRORS = new Set([
  'no_table',
  'not_your_turn',
  'illegal_action',
  'hand_in_progress',
  'need_rebuy',
  'insufficient_funds',
  'bad_action',
  'bad_amount',
])

let seq = 0
/** @type {null | { id: string, action: string, to?: number, claimed: boolean, timer: NodeJS.Timeout, resolve: (result: { status: number, body: Record<string, unknown> }) => void }} */
let slot = null

export function resetActQueue() {
  if (slot) {
    clearTimeout(slot.timer)
    const resolve = slot.resolve
    slot = null
    resolve({ status: 500, body: { ok: false, error: 'reset' } })
  }
  seq = 0
}

/**
 * @param {{ action: string, to?: number }} command
 * @param {number} [timeoutMs]
 */
export function submitAct(command, timeoutMs = ACT_TIMEOUT_MS) {
  if (slot) {
    return Promise.resolve({
      status: 409,
      body: { ok: false, error: 'pending', action: command.action },
    })
  }
  return new Promise((resolve) => {
    const id = String(++seq)
    const timer = setTimeout(() => {
      if (!slot || slot.id !== id) return
      slot = null
      resolve({ status: 504, body: { ok: false, error: 'no_table', action: command.action } })
    }, timeoutMs)
    slot = { id, action: command.action, to: command.to, claimed: false, skip: new Set(), timer, resolve }
  })
}

export function claimAct(clientId) {
  if (!slot || slot.claimed) return null
  const who = clientId || 'anon'
  if (slot.skip.has(who)) return null
  slot.claimed = true
  slot.claimer = who
  const cmd = { id: slot.id, action: slot.action }
  if (slot.to !== undefined) cmd.to = slot.to
  return cmd
}

/**
 * @param {string} id
 * @param {{ ok?: boolean, error?: string }} result
 */
export function finishAct(id, result) {
  if (!slot || slot.id !== String(id) || !slot.claimed) return false
  // 没入座的页面不能把动作占住，留给已经坐下的那一页
  if (result?.error === 'no_table') {
    slot.skip.add(slot.claimer || 'anon')
    slot.claimed = false
    slot.claimer = null
    return 'retry'
  }
  clearTimeout(slot.timer)
  const action = slot.action
  const resolve = slot.resolve
  slot = null
  if (result?.ok === true) {
    resolve({ status: 200, body: { ok: true, action } })
    return true
  }
  const error = PAGE_ERRORS.has(result?.error) ? result.error : 'illegal_action'
  resolve({ status: 409, body: { ok: false, error, action } })
  return true
}

function sendJson(res, status, body) {
  const clean = {}
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) clean[key] = value
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(clean))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4096) {
        reject(new Error('too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function validateAct(parsed) {
  if (!parsed || typeof parsed.action !== 'string' || !ACTIONS.has(parsed.action)) {
    return { status: 400, body: { ok: false, error: 'bad_action' } }
  }
  if (parsed.action === 'raise' && (!Number.isInteger(parsed.to) || parsed.to < 0)) {
    return { status: 400, body: { ok: false, error: 'bad_amount', action: 'raise' } }
  }
  return null
}

/** @returns {boolean} 这个请求已由信箱处理 */
export function handleActRequest(req, res) {
  const url = (req.url || '').split('?')[0]
  if (url !== '/api/act' && url !== '/api/act/result') return false

  const fromPage = req.headers['x-dz-act'] === '1'

  if (url === '/api/act' && req.method === 'GET') {
    if (!fromPage) {
      sendJson(res, 404, { ok: false, error: 'not_found' })
      return true
    }
    const clientHeader = req.headers['x-dz-client']
    const clientId = Array.isArray(clientHeader) ? clientHeader[0] : clientHeader
    const cmd = claimAct(clientId)
    if (!cmd) {
      res.writeHead(204)
      res.end()
      return true
    }
    sendJson(res, 200, cmd)
    return true
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'bad_action' })
    return true
  }

  void readBody(req).then((raw) => {
    let parsed
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad_action' })
      return
    }

    if (url === '/api/act/result') {
      if (!fromPage) {
        sendJson(res, 404, { ok: false, error: 'not_found' })
        return
      }
      const accepted = finishAct(parsed?.id, parsed)
      if (!accepted) {
        sendJson(res, 404, { ok: false, error: 'not_found' })
        return
      }
      res.writeHead(204)
      res.end()
      return
    }

    const invalid = validateAct(parsed)
    if (invalid) {
      sendJson(res, invalid.status, invalid.body)
      return
    }
    const command = { action: parsed.action }
    if (parsed.action === 'raise') command.to = parsed.to
    submitAct(command).then((result) => {
      if (!res.headersSent) sendJson(res, result.status, result.body)
    })
  }).catch(() => {
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: 'bad_action' })
  })

  return true
}
