/**
 * Centralised, typed access to Vite environment variables.
 *
 * Rules:
 *  - All env reads happen here. No other file should reference import.meta.env directly.
 *  - VITE_API_BASE_URL is REQUIRED in production builds (see vite.config.js).
 *  - In development, localhost:3001 is used as a safe fallback so engineers
 *    can run the frontend without touching .env at all.
 *
 * Naming:
 *  - VITE_API_BASE_URL   (preferred)
 *  - VITE_API_URL        (legacy alias — still accepted for backward compat)
 */

/**
 * Normalise API base URL from Vite env (build-time).
 * Handles common Vercel mistakes, e.g. pasting a whole .env line into the value field:
 *   VITE_API_BASE_URL=https://git-repo.onrender.com/api
 */
export function normalizeApiBaseUrl(raw, { isProd = import.meta.env.PROD } = {}) {
  let url = String(raw ?? '').trim()

  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim()
  }

  // Whole .env line pasted as the variable value (not as the variable name)
  url = url.replace(/^\/?VITE_API_(?:BASE_)?URL\s*=\s*/i, '').trim()

  if (!url) {
    return isProd ? '' : 'http://localhost:3001/api'
  }

  // Docker/nginx same-origin proxy
  if (url === '/api' || url.startsWith('/api/')) {
    return url === '/api' ? '/api' : url.replace(/\/+$/, '') || '/api'
  }

  if (/^https?:\/\//i.test(url)) {
    url = url.replace(/\/+$/, '')
    if (!/\/api$/i.test(url)) {
      url = `${url}/api`
    }
    return url
  }

  if (isProd) {
    throw new Error(
      '[env] VITE_API_BASE_URL must be an absolute https URL ending with /api. ' +
        'In Vercel, set Name = VITE_API_BASE_URL and Value = https://git-repo-az5t.onrender.com/api ' +
        '(do not paste "VITE_API_BASE_URL=" into the value field).',
    )
  }

  return url
}

const _rawApiUrl =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  ''

const apiBaseUrl = normalizeApiBaseUrl(_rawApiUrl)

/** True when production build will call the wrong host (missing or malformed URL). */
export const isMisconfiguredProductionApi =
  import.meta.env.PROD &&
  (!apiBaseUrl ||
    /VITE_API_/i.test(apiBaseUrl) ||
    (!apiBaseUrl.startsWith('http') && apiBaseUrl !== '/api'))

/**
 * Authify Main Portal frontend origin (VITE_AUTHIFY_FRONTEND_URL).
 * Returns '' when unset or not a safe absolute URL, so callers can hide the link.
 * Plain http is accepted only for localhost.
 */
export function normalizeAuthifyFrontendUrl(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return ''
  }

  const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost)) {
    return parsed.origin
  }
  return ''
}

/** Authify page that lists the user's apps; B2B is opened from there through SSO. */
export function authifyMyAppsUrl(frontendUrl) {
  return frontendUrl ? `${frontendUrl}/my-apps` : ''
}

const parsedTimeout = Number(import.meta.env.VITE_API_TIMEOUT)
const apiTimeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30_000

export const env = Object.freeze({
  apiBaseUrl,
  apiTimeout,
  appName: import.meta.env.VITE_APP_NAME || 'B2B Marketplace',
  /** Razorpay public key_id — fallback when API omits keyId; must match server RAZORPAY_KEY_ID */
  razorpayKeyId: import.meta.env.VITE_RAZORPAY_KEY_ID || '',
  authifyFrontendUrl: normalizeAuthifyFrontendUrl(import.meta.env.VITE_AUTHIFY_FRONTEND_URL),
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
})

/**
 * Returns the API server origin (scheme + host, no path).
 * Used for Razorpay and any absolute-URL construction.
 */
export function getApiOrigin() {
  if (env.apiBaseUrl.startsWith('/')) {
    return typeof window !== 'undefined' ? window.location.origin : ''
  }
  return env.apiBaseUrl.replace(/\/api\/?$/, '')
}
