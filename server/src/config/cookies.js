/**
 * Auth cookie options for httpOnly JWT cookies.
 *
 * Vercel (frontend) + Render (API) are different sites. Browsers only store
 * cross-site Set-Cookie when sameSite is "none" and secure is true.
 *
 * useCrossSiteCookies is derived from CLIENT_URL (HTTPS, non-localhost), so
 * production cookie settings apply even if NODE_ENV was not set on Render.
 */

const env = require('./env.js')

const COOKIE_NAME = 'auth_token'
const CSRF_COOKIE_NAME = 'csrf_token'

function authCookieOptions() {
  const crossSite = env.useCrossSiteCookies

  return {
    httpOnly: true,
    secure: crossSite || env.nodeEnv === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: env.cookieMaxAge,
    path: '/',
    // Helps Chrome store cross-site cookies (Vercel → Render).
    ...(crossSite ? { partitioned: true } : {}),
  }
}

/** Options for clearCookie — must match set options (except maxAge). */
function clearAuthCookieOptions() {
  const { maxAge, ...rest } = authCookieOptions()
  return rest
}

function csrfCookieOptions() {
  const crossSite = env.useCrossSiteCookies

  return {
    httpOnly: false,
    secure: crossSite || env.nodeEnv === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: env.cookieMaxAge,
    path: '/',
    ...(crossSite ? { partitioned: true } : {}),
  }
}

module.exports = {
  COOKIE_NAME,
  CSRF_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
  csrfCookieOptions,
}
