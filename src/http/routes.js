/**
 * Same-origin HTTP API for the settings page.
 *
 * The browser cannot call Host services directly, so the page reads and mutates
 * state through these two routes. The browser connection's admission decides
 * who may call them; without `connection` (or `webServer`) the plugin simply
 * registers no API, and the page reports that it is unavailable.
 */
const MAX_BODY = 64 * 1024

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid JSON body')
  return parsed
}

/**
 * Register `GET/POST /emotion-profiles/api`.
 * @returns {boolean} whether the routes were registered
 */
export function registerRoutes(ctx, service, { logger = null } = {}) {
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : null
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : null
  if (!webServer || typeof webServer.register !== 'function') return false
  if (!connection || typeof connection.admit !== 'function') return false

  const admitted = (req) => {
    try {
      const outcome = connection.admit({ headers: req.headers })
      return !(outcome && 'rejection' in outcome)
    } catch {
      return false
    }
  }

  const handler = async (req, res) => {
    if (!admitted(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return sendJson(res, 200, { ok: true, ...service.snapshot() })
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })

      const body = await readJsonBody(req)
      const action = typeof body.action === 'string' ? body.action : ''

      switch (action) {
        case 'switch': {
          await service.switchProfile(body.profile, 'settings')
          return sendJson(res, 200, { ok: true, ...service.snapshot() })
        }
        case 'create': {
          const profile = await service.createProfile(body.profile && typeof body.profile === 'object' ? body.profile : body)
          return sendJson(res, 200, { ok: true, created: profile.id, ...service.snapshot() })
        }
        case 'settings': {
          service.updateSettings(body.settings && typeof body.settings === 'object' ? body.settings : {})
          return sendJson(res, 200, { ok: true, ...service.snapshot() })
        }
        case 'export': {
          const result = await service.exportConsolidation()
          return sendJson(res, 200, { ok: true, export: result, ...service.snapshot() })
        }
        case 'refresh': {
          return sendJson(res, 200, { ok: true, ...service.snapshot() })
        }
        default:
          return sendJson(res, 400, { ok: false, error: `unknown action: ${action}` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.debug?.(`settings API failed: ${message}`)
      return sendJson(res, 400, { ok: false, error: message })
    }
  }

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/emotion-profiles/api',
      handler,
    }),
  )
  return true
}
