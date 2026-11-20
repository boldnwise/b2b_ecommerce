/**
 * Centralised CORS configuration.
 *
 * Security guarantees:
 *  - Never emits `Access-Control-Allow-Origin: *` — incompatible with credentials.
 *  - Requests without an `Origin` header (server-to-server, Postman, curl) are allowed.
 *  - Allowed origins come from env.corsAllowedOrigins (CLIENT_URL + CORS_ALLOWED_ORIGINS).
 *  - Allowed request headers come from env.corsAllowedHeaders (override via CORS_ALLOWED_HEADERS).
 *  - Wildcard patterns are supported in the origin allowlist only (e.g. https://*.vercel.app).
 *  - Unknown origins are rejected via callback(null, false) — no thrown 500 errors.
 *
 * Configure on Render:
 *   CLIENT_URL=https://git-repo-gilt.vercel.app
 *   CORS_ALLOWED_ORIGINS=https://git-repo-gilt.vercel.app,https://git-repo-*.vercel.app
 */

const env = require('./env.js')

/**
 * Check if the request origin matches an allowed pattern.
 * Supports exact matches and wildcards (e.g. "https://*.vercel.app").
 */
function matchOrigin(allowedPattern, origin) {
  if (allowedPattern === origin) return true

  if (allowedPattern.includes('*')) {
    const escaped = allowedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
    const regex = new RegExp(`^${escaped}$`, 'i')
    return regex.test(origin)
  }

  return false
}

/**
 * Express-compatible origin validator for the cors() package.
 *
 * @param {string|undefined} origin
 * @param {function(Error|null, boolean): void} callback
 */
function originValidator(origin, callback) {
  if (!origin) return callback(null, true)

  const isAllowed = env.corsAllowedOrigins.some((pattern) => matchOrigin(pattern, origin))
  if (isAllowed) {
    return callback(null, true)
  }

  if (env.isDev) {
    console.warn(
      `[CORS] Rejected origin: "${origin}"\n` +
      `       Allowed origins: ${env.corsAllowedOrigins.join(', ')}\n` +
      `       Add it to CLIENT_URL or CORS_ALLOWED_ORIGINS in server/.env`,
    )
  }

  return callback(null, false)
}

/** Ready-to-use options object for cors(). */
const corsOptions = Object.freeze({
  origin:         originValidator,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: env.corsAllowedHeaders,
  exposedHeaders: ['X-CSRF-Token'],
  maxAge:         600,
})

module.exports = corsOptions
