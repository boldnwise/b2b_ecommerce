'use strict'

const env = require('../config/env.js')
const { AppError } = require('../utils/AppError.js')
const { validateCsrf } = require('../utils/csrf.js')
const { COOKIE_NAME } = require('../config/cookies.js')

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const EXEMPT_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/subscriptions/webhook',
  '/api/health',
]

/**
 * The Authify browser handoff cannot carry B2B's CSRF token. Its handler
 * (ssoController.consumeBrowserHandoff) verifies the Origin header against
 * SSO_HANDOFF_ALLOWED_ORIGINS before touching the ticket. Exact match only.
 */
const ORIGIN_VERIFIED_PATHS = new Set(['/sso/consume'])

function csrfProtection(req, res, next) {
  if (!env.csrfProtectionEnabled) return next()
  if (SAFE_METHODS.has(req.method)) return next()

  const path = (req.originalUrl || req.url || '').split('?')[0]
  if (EXEMPT_PATHS.some((exempt) => path === exempt || path.endsWith(exempt))) {
    return next()
  }
  if (req.method === 'POST' && ORIGIN_VERIFIED_PATHS.has(path)) {
    return next()
  }

  // Let authenticate() return 401 for guests — CSRF only applies to cookie sessions.
  if (!req.cookies?.[COOKIE_NAME]) {
    return next()
  }

  if (!validateCsrf(req)) {
    return next(new AppError('Invalid or missing CSRF token', 403, 'CSRF_VALIDATION_FAILED'))
  }

  return next()
}

module.exports = { csrfProtection }
