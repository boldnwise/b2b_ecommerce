/**
 * Pino logger — single shared instance for the entire application.
 *
 * Development  → pretty-printed, human-readable, colorized (pino-pretty).
 * Production   → newline-delimited JSON, one object per line; pipe through
 *                `pino-pretty` locally or ship to your log aggregator
 *                (Datadog, Loki, CloudWatch, etc.) as-is.
 *
 * Sensitive fields are redacted at the transport layer so they never appear
 * in log files regardless of which module emits them.
 */

const pino = require('pino')
const env  = require('./env.js')

const REDACT_CENSOR = '[REDACTED]'

/** Header names compared after lowercasing, so X-SSO-Signature and x-sso-signature match. */
const REDACTED_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-sso-signature',
  'x-sso-nonce',
  'x-sso-timestamp',
])

const LOG_REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'req.headers["x-sso-signature"]',
    'req.headers["x-sso-nonce"]',
    'req.headers["x-sso-timestamp"]',
    'req.body.ticket',
    'req.body.password',
    'res.headers["set-cookie"]',
    'req.body.passwordHash',
    'req.body.razorpaySignature',
    'req.body.razorpayKeySecret',
  ],
  censor: REDACT_CENSOR,
}

/** Remove a raw SSO ticket from a logged URL without changing other requests. */
function redactSensitiveUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url
  const qIndex = url.indexOf('?')
  const path = qIndex === -1 ? url : url.slice(0, qIndex)
  const query = qIndex === -1 ? '' : url.slice(qIndex + 1)
  const safePath = path.startsWith('/api/sso/') || path.startsWith('/sso/')
    ? path.replace(/\/[A-Za-z0-9_-]{43}(?=\/|$)/g, '/[REDACTED]')
    : path
  if (!query) return safePath
  const params = new URLSearchParams(query)
  let redactedQuery = false
  for (const key of [...params.keys()]) {
    if (key.toLowerCase() === 'ticket') {
      params.set(key, REDACT_CENSOR)
      redactedQuery = true
    }
  }
  if (!redactedQuery && safePath === path) return url
  const next = params.toString()
  return next ? `${safePath}?${next}` : safePath
}

/**
 * Copy headers and replace sensitive values.
 * The copy keeps the live request headers available to authentication.
 */
function sanitizeLoggedHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers
  const sanitized = {}
  for (const key of Object.keys(headers)) {
    sanitized[key] = REDACTED_HEADER_NAMES.has(String(key).toLowerCase())
      ? REDACT_CENSOR
      : headers[key]
  }
  return sanitized
}

// Silence all output during automated tests and avoid spawning the
// pino-pretty worker thread, which Jest cannot tear down cleanly.
const isTest = process.env.NODE_ENV === 'test'

const logger = pino(
  {
    level: isTest ? 'silent' : (env.isDev ? 'debug' : 'info'),

    // Static fields appended to every log line
    base: { service: 'b2b-api', env: env.nodeEnv },

    // ISO timestamp on every line
    timestamp: pino.stdTimeFunctions.isoTime,

    // Redact sensitive values so they are never written to any log sink.
    // Paths use a dotted-key syntax; wildcards cover nested objects.
    // Hyphenated header names need bracket notation. The request serializer
    // also redacts these headers case-insensitively before this pass.
    redact: LOG_REDACT,
  },
  !isTest && env.isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize:      true,
          ignore:        'pid,hostname,service,env',
          translateTime: 'SYS:HH:MM:ss.l',
          messageFormat: '{msg}',
        },
      })
    : undefined,
)

module.exports = logger
module.exports.LOG_REDACT = LOG_REDACT
module.exports.REDACT_CENSOR = REDACT_CENSOR
module.exports.sanitizeLoggedHeaders = sanitizeLoggedHeaders
module.exports.redactSensitiveUrl = redactSensitiveUrl
