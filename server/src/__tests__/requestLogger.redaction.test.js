'use strict'

const { EventEmitter } = require('events')
const pino = require('pino')
const logger = require('../config/logger')
const { createRequestLogger } = require('../middleware/requestLogger')

const SIGNATURE = 'sig-SECRET-value'
const NONCE = 'nonce-SECRET-value'
const TIMESTAMP = '1760000000000'
const AUTH = 'Bearer AUTH-SECRET'
const COOKIE = 'auth_token=COOKIE-SECRET'

function captureLogger() {
  const lines = []
  const stream = {
    write(chunk) {
      lines.push(chunk.toString())
      return true
    },
  }
  const log = pino({ level: 'info', redact: logger.LOG_REDACT }, stream)
  return { log, lines }
}

function mockResponse() {
  const res = new EventEmitter()
  res.statusCode = 201
  res.setHeader = () => {}
  res.getHeader = () => undefined
  res.getHeaders = () => ({})
  return res
}

function finishRequest(middleware, req) {
  const res = mockResponse()
  middleware(req, res, () => {})
  res.emit('finish')
  return res
}

describe('request log redaction', () => {
  test('redacts SSO, authorization, and cookie headers in the serialized access log', () => {
    const { log, lines } = captureLogger()
    const middleware = createRequestLogger(log)
    const req = {
      method: 'POST',
      url: '/api/sso/issue-ticket',
      headers: {
        'X-SSO-Signature': SIGNATURE,
        'X-Sso-Nonce': NONCE,
        'X-SSO-Timestamp': TIMESTAMP,
        Authorization: AUTH,
        Cookie: COOKIE,
        'user-agent': 'security-test',
      },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1 },
    }

    finishRequest(middleware, req)

    const output = lines.join('')
    expect(output).not.toContain(SIGNATURE)
    expect(output).not.toContain(NONCE)
    expect(output).not.toContain(TIMESTAMP)
    expect(output).not.toContain(AUTH)
    expect(output).not.toContain('AUTH-SECRET')
    expect(output).not.toContain(COOKIE)
    expect(output).not.toContain('COOKIE-SECRET')
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('security-test')
    expect(output).toContain('/api/sso/issue-ticket')

    const logged = JSON.parse(output)
    expect(logged.req.headers['X-SSO-Signature']).toBe('[REDACTED]')
    expect(logged.req.headers['X-Sso-Nonce']).toBe('[REDACTED]')
    expect(logged.req.headers['X-SSO-Timestamp']).toBe('[REDACTED]')
    expect(logged.req.headers.Authorization).toBe('[REDACTED]')
    expect(logged.req.headers.Cookie).toBe('[REDACTED]')

    expect(req.headers['X-SSO-Signature']).toBe(SIGNATURE)
    expect(req.headers['X-Sso-Nonce']).toBe(NONCE)
    expect(req.headers['X-SSO-Timestamp']).toBe(TIMESTAMP)
    expect(req.headers.Authorization).toBe(AUTH)
    expect(req.headers.Cookie).toBe(COOKIE)
  })

  test('shared logger redaction still censors lowercase authorization, cookie, and SSO headers', () => {
    const { log, lines } = captureLogger()
    log.info({
      req: {
        headers: {
          authorization: AUTH,
          cookie: COOKIE,
          'x-sso-signature': SIGNATURE,
          'x-sso-nonce': NONCE,
          'x-sso-timestamp': TIMESTAMP,
          'user-agent': 'security-test',
        },
      },
    }, 'direct log')

    const output = lines.join('')
    expect(output).not.toContain(SIGNATURE)
    expect(output).not.toContain(NONCE)
    expect(output).not.toContain(TIMESTAMP)
    expect(output).not.toContain('AUTH-SECRET')
    expect(output).not.toContain('COOKIE-SECRET')
    expect(output).toContain('[REDACTED]')
    expect(output).toContain('security-test')
  })
})
