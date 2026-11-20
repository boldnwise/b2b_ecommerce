'use strict'

const crypto = require('crypto')
const env = require('../config/env.js')
const { AppError } = require('../utils/AppError.js')

/** Exact path the Main Portal must include in the HMAC. Query strings are not signed. */
const SSO_ISSUE_PATH = '/api/sso/issue-ticket'
const MAX_SKEW_MS = 60_000
/** Keep a nonce until the timestamp can no longer be accepted, plus this margin. */
const NONCE_CLEANUP_MARGIN_MS = 30_000
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

/**
 * Canonical string: METHOD, path, timestamp, nonce, and the exact raw body.
 * Timestamp is Unix epoch milliseconds, used exactly as sent.
 */
function ssoCanonicalString(method, path, timestamp, nonce, rawBody) {
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${rawBody}`
}

function ssoSignatureHex(secret, method, path, timestamp, nonce, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(ssoCanonicalString(method, path, timestamp, nonce, rawBody), 'utf8')
    .digest('hex')
}

function requestPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0]
}

function rawBodyText(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (typeof req.body === 'string') return req.body
  return ''
}

/**
 * Rejects the request unless the HMAC matches SSO_S2S_SECRET.
 * Does not log the secret, signature, nonce, or body.
 */
function assertSsoSignature(req) {
  if (!env.ssoIssueEnabled) {
    throw new AppError('SSO is not configured', 503, 'SSO_NOT_CONFIGURED')
  }

  const timestamp = String(req.get('x-sso-timestamp') || '')
  const nonce = String(req.get('x-sso-nonce') || '')
  const signature = String(req.get('x-sso-signature') || '')
  if (!timestamp || !signature) {
    throw new AppError('Missing SSO signature', 401, 'SSO_SIGNATURE_MISSING')
  }
  if (!/^\d{1,16}$/.test(timestamp)) {
    throw new AppError('Invalid SSO timestamp', 401, 'SSO_TIMESTAMP_INVALID')
  }

  const skew = Math.abs(Date.now() - Number(timestamp))
  if (!Number.isFinite(skew) || skew > MAX_SKEW_MS) {
    throw new AppError('SSO timestamp is outside the allowed window', 401, 'SSO_TIMESTAMP_EXPIRED')
  }
  if (!nonce) {
    throw new AppError('Missing SSO nonce', 401, 'SSO_NONCE_MISSING')
  }
  if (!NONCE_PATTERN.test(nonce)) {
    throw new AppError('Invalid SSO nonce', 401, 'SSO_NONCE_INVALID')
  }

  const path = requestPath(req)
  if (req.method !== 'POST' || path !== SSO_ISSUE_PATH) {
    throw new AppError('Invalid SSO signature', 401, 'SSO_SIGNATURE_INVALID')
  }
  if (!/^[0-9a-fA-F]+$/.test(signature)) {
    throw new AppError('Invalid SSO signature', 401, 'SSO_SIGNATURE_INVALID')
  }

  const expected = ssoSignatureHex(
    env.ssoS2sSecret,
    'POST',
    SSO_ISSUE_PATH,
    timestamp,
    nonce,
    rawBodyText(req),
  )
  const provided = Buffer.from(signature.toLowerCase(), 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    throw new AppError('Invalid SSO signature', 401, 'SSO_SIGNATURE_INVALID')
  }
}

module.exports = {
  SSO_ISSUE_PATH,
  MAX_SKEW_MS,
  NONCE_CLEANUP_MARGIN_MS,
  NONCE_PATTERN,
  ssoCanonicalString,
  ssoSignatureHex,
  assertSsoSignature,
}
