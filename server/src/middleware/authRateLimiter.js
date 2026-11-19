const rateLimit = require('express-rate-limit')

/**
 * Per-IP limit for sign-in endpoints: 50 requests per 15 minutes.
 * Each call returns an independent counter, so SSO handoffs do not use up the
 * admin password-login budget.
 */
function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  })
}

/** Shared by POST /sso/consume and POST /api/sso/consume-ticket. */
const ssoConsumeLimiter = createAuthLimiter()

module.exports = { createAuthLimiter, ssoConsumeLimiter }
