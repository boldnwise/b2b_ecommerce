'use strict'

const { z } = require('zod')
const env = require('../config/env.js')
const { asyncHandler } = require('../utils/asyncHandler.js')
const { AppError } = require('../utils/AppError.js')
const { assertSsoSignature } = require('../middleware/ssoS2sAuth.js')
const { consumeSsoNonce } = require('../services/ssoNonceService.js')
const { issueSsoTicket, consumeSsoTicket } = require('../services/ssoTicketService.js')
const { setAuthCookie, issueCsrfCookie } = require('./authController.js')
const { serializeUser } = require('../utils/serializeUser.js')
const { AUTH_METHODS } = require('../utils/jwt.js')
const logger = require('../config/logger.js')

function ssoSessionClaims(user) {
  return { sub: user.id, email: user.email, role: user.role, authMethod: AUTH_METHODS.SSO }
}

const consumeTicketBody = z.object({
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict()

/** Fixed frontend paths. Request fields cannot change these. */
const HANDOFF_SUCCESS_PATH = '/portal'
const HANDOFF_FAILURE_PATH = '/login'

const consumeFormBody = z.object({
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

const issueTicketBody = z.object({
  authifyUserId: z.string().regex(/^[1-9]\d{0,31}$/),
  email: z.string().trim().email().max(255),
  audience: z.literal('b2b'),
}).strict()

const issueTicket = asyncHandler(async (req, res) => {
  assertSsoSignature(req)

  let payload
  try {
    payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '')
  } catch {
    throw new AppError('Invalid JSON', 400, 'VALIDATION_ERROR')
  }

  const parsed = issueTicketBody.safeParse(payload)
  if (!parsed.success) {
    throw new AppError('Invalid SSO payload', 400, 'VALIDATION_ERROR')
  }

  await consumeSsoNonce({
    nonce: String(req.get('x-sso-nonce') || ''),
    timestamp: String(req.get('x-sso-timestamp') || ''),
  })

  const data = await issueSsoTicket({
    authifyUserId: parsed.data.authifyUserId,
    email: parsed.data.email,
  })

  res.status(201).json({
    success: true,
    data,
  })
})

const consumeTicket = asyncHandler(async (req, res) => {
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'ticket')) {
    throw new AppError('SSO ticket must be sent in the request body', 400, 'VALIDATION_ERROR')
  }

  const parsed = consumeTicketBody.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('Invalid SSO ticket', 400, 'VALIDATION_ERROR')
  }

  const user = await consumeSsoTicket(parsed.data.ticket)
  setAuthCookie(res, ssoSessionClaims(user))
  issueCsrfCookie(req, res, { rotate: true })

  res.status(200).json({
    success: true,
    data: { user: serializeUser(user) },
  })
})

function trustedFrontendUrl(pathname) {
  if (pathname !== HANDOFF_SUCCESS_PATH && pathname !== HANDOFF_FAILURE_PATH) {
    throw new AppError('SSO handoff is not configured', 503, 'SSO_NOT_CONFIGURED')
  }
  let base
  try {
    base = new URL(env.clientUrls[0])
  } catch {
    throw new AppError('SSO handoff is not configured', 503, 'SSO_NOT_CONFIGURED')
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new AppError('SSO handoff is not configured', 503, 'SSO_NOT_CONFIGURED')
  }
  return new URL(pathname, `${base.origin}/`).href
}

function formContentType(req) {
  return String(req.get('content-type') || '').split(';')[0].trim().toLowerCase()
}

/**
 * The browser must report an allowlisted Authify frontend origin. A missing or
 * opaque ("null") Origin is refused, so a page on any other site cannot submit a ticket.
 */
function isTrustedHandoffOrigin(req) {
  const origin = req.get('origin')
  if (!origin || origin === 'null') return false
  return env.ssoHandoffAllowedOrigins.includes(origin)
}

/**
 * Top-level browser POST from the Authify frontend. The token-based CSRF check
 * does not apply here (Authify cannot read B2B's CSRF cookie); the Origin
 * allowlist replaces it and runs before the ticket is read, with or without an
 * existing B2B session. A trusted handoff replaces any current session.
 */
const consumeBrowserHandoff = asyncHandler(async (req, res) => {
  const failureUrl = trustedFrontendUrl(HANDOFF_FAILURE_PATH)
  if (!isTrustedHandoffOrigin(req)) {
    logger.warn({ requestId: req.id, code: 'SSO_ORIGIN_REJECTED' }, 'SSO handoff from an untrusted origin')
    res.redirect(303, failureUrl)
    return
  }
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'ticket')) {
    res.redirect(303, failureUrl)
    return
  }
  if (formContentType(req) !== 'application/x-www-form-urlencoded') {
    res.redirect(303, failureUrl)
    return
  }

  const parsed = consumeFormBody.safeParse(req.body)
  if (!parsed.success) {
    res.redirect(303, failureUrl)
    return
  }

  try {
    const user = await consumeSsoTicket(parsed.data.ticket)
    setAuthCookie(res, ssoSessionClaims(user))
    issueCsrfCookie(req, res, { rotate: true })
    res.redirect(303, trustedFrontendUrl(HANDOFF_SUCCESS_PATH))
  } catch (error) {
    if (res.headersSent) throw error
    if (error instanceof AppError) {
      res.redirect(303, failureUrl)
      return
    }
    throw error
  }
})

module.exports = {
  issueTicket,
  consumeTicket,
  consumeBrowserHandoff,
  HANDOFF_SUCCESS_PATH,
  HANDOFF_FAILURE_PATH,
}
