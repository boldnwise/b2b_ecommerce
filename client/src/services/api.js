import axios from 'axios'
import { env, isMisconfiguredProductionApi } from '../constants/env.js'
import {
  ApiErrorType,
  classifyError,
  isCanceledError,
  logApiFailure,
} from '../utils/apiError.js'

if (isMisconfiguredProductionApi) {
  console.error(
    '[api] Misconfigured: set Vercel env Name=VITE_API_BASE_URL, Value=https://your-service.onrender.com/api, then redeploy.',
  )
}

/**
 * Central Axios instance. ALL HTTP traffic in the app MUST go through this
 * module so auth, error handling and base-URL concerns stay in one place.
 *
 * Authentication is cookie-based (httpOnly). The browser attaches `auth_token`
 * when `withCredentials: true`. The CSRF token is kept in memory from the
 * `X-CSRF-Token` response header, because the API host cookie is not readable
 * from the frontend origin.
 */
export const api = axios.create({
  baseURL: env.apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: env.apiTimeout,
  withCredentials: true,
})

/**
 * Callback the auth bridge registers to clear Redux state when the server
 * tells us the token is no longer valid. Defaults to a no-op so `api` is
 * safe to use from non-React contexts (e.g. tests).
 */
let onUnauthorized = () => {}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = typeof fn === 'function' ? fn : () => {}
}

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

let csrfToken = ''
let sessionRefreshes = 0
let sessionWaiters = []
let csrfResync = null
let csrfEpoch = 0

function requestPath(url) {
  const raw = String(url || '')
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname
  } catch {
    /* Relative API paths are the normal case. */
  }
  return raw.split('?')[0]
}

function isCsrfIssuingRequest(config) {
  const method = String(config?.method || 'get').toLowerCase()
  const path = requestPath(config?.url)
  if (method === 'get' && /(^|\/)auth\/me$/.test(path)) return true
  if (method === 'post' && /(^|\/)auth\/login$/.test(path)) return true
  return false
}

function isLogoutRequest(config) {
  const method = String(config?.method || 'get').toLowerCase()
  return method === 'post' && /(^|\/)auth\/logout$/.test(requestPath(config?.url))
}

function beginSessionRefresh(config) {
  sessionRefreshes += 1
  config.csrfEpoch = csrfEpoch
}

function invalidateCsrfSession() {
  csrfEpoch += 1
  csrfToken = ''
}

function releaseSessionWaiters() {
  if (sessionRefreshes > 0) return
  const pending = sessionWaiters
  sessionWaiters = []
  pending.forEach((release) => release())
}

function endSessionRefresh(nextToken, replace) {
  if (replace) {
    csrfToken = typeof nextToken === 'string' ? nextToken : ''
  } else if (typeof nextToken === 'string' && nextToken) {
    csrfToken = nextToken
  }
  sessionRefreshes = Math.max(0, sessionRefreshes - 1)
  releaseSessionWaiters()
}

function readIssuedToken(response) {
  const headers = response?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') {
    const fromGetter = headers.get('x-csrf-token')
    if (typeof fromGetter === 'string' && fromGetter) return fromGetter
  }
  const value = headers['x-csrf-token'] || headers['X-CSRF-Token']
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

async function waitForSessionRefresh() {
  while (sessionRefreshes > 0) {
    await new Promise((resolve) => {
      sessionWaiters.push(resolve)
    })
  }
}

function isCsrfValidationFailed(error) {
  return error?.response?.status === 403
    && error?.response?.data?.error?.code === 'CSRF_VALIDATION_FAILED'
}

/**
 * One shared GET /api/auth/me after CSRF rejection. Updates memory only.
 * The failed mutation is not sent again.
 */
function resyncCsrfToken() {
  if (csrfResync) return csrfResync
  const epoch = csrfEpoch
  let current
  current = api.get('/auth/me')
    .then((res) => {
      if (epoch !== csrfEpoch) return
      const token = readIssuedToken(res)
      csrfToken = token || ''
    })
    .catch(() => {
      if (epoch !== csrfEpoch) return
      csrfToken = ''
    })
    .finally(() => {
      if (csrfResync === current) csrfResync = null
    })
  csrfResync = current
  return current
}

/** Test hook. Clears the in-memory CSRF token and any session-refresh waiters. */
export function resetCsrfState() {
  csrfToken = ''
  sessionRefreshes = 0
  csrfEpoch += 1
  csrfResync = null
  releaseSessionWaiters()
}

api.interceptors.request.use(async (config) => {
  if (isCsrfIssuingRequest(config)) {
    beginSessionRefresh(config)
    config.csrfSession = true
    return config
  }

  const method = String(config.method || 'get').toLowerCase()
  if (!MUTATING_METHODS.has(method)) return config

  await waitForSessionRefresh()
  if (csrfToken) {
    config.headers = config.headers || {}
    config.headers['X-CSRF-Token'] = csrfToken
  }
  return config
})

api.interceptors.response.use(
  (res) => {
    if (res?.config?.csrfSession) {
      const stillCurrent = res.config.csrfEpoch === csrfEpoch
      endSessionRefresh(stillCurrent ? readIssuedToken(res) : '', stillCurrent)
    } else if (isLogoutRequest(res?.config)) {
      invalidateCsrfSession()
    }
    return res
  },
  (error) => {
    if (error?.config?.csrfSession) {
      endSessionRefresh('', false)
    }
    if (isCanceledError(error)) return Promise.reject(error)

    const resync = isCsrfValidationFailed(error) && !error.config?.csrfSession
      ? resyncCsrfToken()
      : null

    logApiFailure(error)

    const type = classifyError(error)

    // Only fire the session-expired handler for authenticated routes.
    // Auth endpoints (login / register) legitimately return 401 for wrong
    // credentials — treating those as "session expired" would be misleading
    // and would spuriously dispatch logout().
    const url = error?.config?.url || ''
    // /auth/me 401 is handled by initializeAuth — avoid "session expired" loop on boot.
    const isAuthEndpoint = /\/auth\/(login|register|me|logout)/.test(url)

    if (type === ApiErrorType.UNAUTHORIZED && !isAuthEndpoint) {
      try {
        onUnauthorized()
      } catch {
        /* handler should not block rejection */
      }
    }

    if (!resync) return Promise.reject(error)
    return resync.then(() => Promise.reject(error), () => Promise.reject(error))
  },
)

export {
  ApiErrorType,
  classifyError,
  getErrorMessage,
  normalizeApiError,
} from '../utils/apiError.js'
