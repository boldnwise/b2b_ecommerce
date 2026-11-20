/**
 * HTTP request logger middleware (pino-http).
 *
 * What this does:
 *  - Assigns a unique request ID to every inbound request (`req.id`).
 *  - Echoes the ID back in the `X-Request-Id` response header so clients can
 *    correlate their logs with server logs.
 *  - Logs one structured line per request after the response finishes:
 *      method, url, statusCode, responseTime, requestId, userId
 *  - Log level follows the response status:
 *      <400 → info   |   4xx → warn   |   5xx / err → error
 *  - Health-check hits are silenced to avoid noise in log aggregators.
 */

const crypto   = require('crypto')
const pinoHttp = require('pino-http')
const logger   = require('../config/logger.js')
const { sanitizeLoggedHeaders, redactSensitiveUrl } = require('../config/logger.js')

/**
 * pino-http serializes the request before writing the access log.
 * Replace its header object with a copy so secret values never reach the sink
 * and the incoming request headers stay unchanged.
 */
function redactSerializedRequest(serializedReq) {
  if (!serializedReq || typeof serializedReq !== 'object') return serializedReq
  return {
    ...serializedReq,
    url: redactSensitiveUrl(serializedReq.url),
    headers: sanitizeLoggedHeaders(serializedReq.headers),
  }
}

function redactSerializedResponse(serializedRes) {
  if (!serializedRes || typeof serializedRes !== 'object') return serializedRes
  return {
    ...serializedRes,
    headers: sanitizeLoggedHeaders(serializedRes.headers),
  }
}

const SILENT_PATHS = new Set(['/api/health', '/api/catalog/health'])

function createRequestLogger(baseLogger = logger) {
  return pinoHttp({
    logger: baseLogger,
    serializers: {
      req: redactSerializedRequest,
      res: redactSerializedResponse,
    },

    // ── Request ID ───────────────────────────────────────────────────────────
    // Accept a caller-supplied ID (useful for distributed tracing with upstream
    // services) or mint a fresh UUID.  Always echo the final ID back.
    genReqId(req, res) {
      const incoming = req.headers['x-request-id']
      const id =
        typeof incoming === 'string' && incoming.trim()
          ? incoming.trim().slice(0, 128)
          : crypto.randomUUID()
      res.setHeader('X-Request-Id', id)
      return id
    },

    // ── Log level by HTTP status ─────────────────────────────────────────────
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },

    // ── Message format ───────────────────────────────────────────────────────
    customSuccessMessage(req, res) {
      return `${req.method} ${redactSensitiveUrl(req.originalUrl || req.url || '')} ${res.statusCode}`
    },
    customErrorMessage(req, res, err) {
      const url = redactSensitiveUrl(req.originalUrl || req.url || '')
      return `${req.method} ${url} ${res.statusCode} — ${err?.message ?? 'unknown error'}`
    },

    // ── Suppress health-check noise ──────────────────────────────────────────
    autoLogging: {
      ignore(req) {
        return SILENT_PATHS.has(req.url)
      },
    },

    // ── Extra fields on every request log ────────────────────────────────────
    // userId / userRole are populated by authenticate middleware which runs after
    // the request logger; they will be present on the *response* log line because
    // pino-http calls customProps just before writing (after the route ran).
    customProps(req) {
      return {
        requestId: req.id,
        userId: req.user?.id ?? undefined,
        userRole: req.user?.role ?? undefined,
      }
    },
  })
}

const requestLogger = createRequestLogger()

module.exports = requestLogger
module.exports.createRequestLogger = createRequestLogger
module.exports.redactSerializedRequest = redactSerializedRequest
module.exports.redactSerializedResponse = redactSerializedResponse
