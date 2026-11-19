'use strict'

jest.mock('../config/database')

const AUTHIFY_ORIGIN = 'https://authify.example'
process.env.SSO_HANDOFF_ALLOWED_ORIGINS = AUTHIFY_ORIGIN

const crypto = require('crypto')
const { EventEmitter } = require('events')
const jwt = require('jsonwebtoken')
const pino = require('pino')
const request = require('supertest')
const app = require('../app')
const { prisma } = require('../config/database')
const logger = require('../config/logger')
const { createRequestLogger } = require('../middleware/requestLogger')
const { ticketHash } = require('../services/ssoTicketService')
const { HANDOFF_SUCCESS_PATH, HANDOFF_FAILURE_PATH } = require('../controllers/ssoController')
const { COOKIE_NAME, CSRF_COOKIE_NAME } = require('../config/cookies')
const env = require('../config/env')

const USER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'user@example.com',
  role: 'BUYER',
  companyName: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  portalUserId: null,
  isActive: true,
  deactivatedAt: null,
  buyerSubscriptionStatus: null,
  buyerSubscriptionPlan: null,
  buyerSubscriptionActivatedAt: null,
  sellerSubscriptionStatus: null,
  sellerSubscriptionPlan: null,
  sellerSubscriptionActivatedAt: null,
}

const SUCCESS_URL = new URL(HANDOFF_SUCCESS_PATH, env.clientUrls[0]).href
const FAILURE_URL = new URL(HANDOFF_FAILURE_PATH, env.clientUrls[0]).href
const tickets = new Map()

function rawTicket() {
  return crypto.randomBytes(32).toString('base64url')
}

function remember(ticket, overrides = {}) {
  const hash = ticketHash(ticket)
  tickets.set(hash, {
    ticketHash: hash,
    audience: 'b2b',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 30_000),
    user: USER,
    ...overrides,
  })
}

function cookieRow(res, name) {
  return (res.headers['set-cookie'] || []).find((row) => row.startsWith(`${name}=`)) || ''
}

function expectNoSession(res) {
  expect(cookieRow(res, COOKIE_NAME)).toBe('')
  expect(cookieRow(res, CSRF_COOKIE_NAME)).toBe('')
}

function postForm(ticket, extra = {}) {
  return request(app)
    .post('/sso/consume')
    .set('Origin', AUTHIFY_ORIGIN)
    .type('form')
    .send({ ticket, ...extra })
}

function sessionToken(claims = {}) {
  return jwt.sign(
    { sub: USER.id, email: USER.email, role: USER.role, ...claims },
    process.env.JWT_SECRET,
    { issuer: 'b2b-ecommerce-api', expiresIn: '1h' },
  )
}

function cookieValue(res, name) {
  return cookieRow(res, name).split(';')[0].slice(name.length + 1)
}

beforeEach(() => {
  tickets.clear()
  prisma.ssoTicket.updateMany.mockImplementation(async ({ where, data }) => {
    const row = tickets.get(where.ticketHash)
    if (!row) return { count: 0 }
    if (row.audience !== where.audience) return { count: 0 }
    if (row.consumedAt !== null || where.consumedAt !== null) return { count: 0 }
    const cutoff = where.expiresAt && where.expiresAt.gt
    if (!(cutoff instanceof Date) || !(row.expiresAt > cutoff)) return { count: 0 }
    row.consumedAt = data.consumedAt
    return { count: 1 }
  })
  prisma.ssoTicket.findUnique.mockImplementation(async ({ where }) => {
    const row = tickets.get(where.ticketHash)
    return row ? { user: row.user } : null
  })
})

describe('POST /sso/consume', () => {
  test('consumes a URL-encoded form and redirects to the fixed portal path', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await postForm(ticket, { next: 'https://evil.example/phish' })

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(SUCCESS_URL)
    expect(res.headers.location).not.toContain('evil.example')
    expect(res.headers.location).not.toContain(ticket)
    expect(cookieRow(res, COOKIE_NAME).toLowerCase()).toContain('httponly')
    expect(cookieRow(res, CSRF_COOKIE_NAME)).not.toBe('')
    const sessionJwt = cookieRow(res, COOKIE_NAME).split(';')[0].slice(`${COOKIE_NAME}=`.length)
    expect(jwt.decode(sessionJwt).authMethod).toBe('sso')
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('redirects a missing ticket to login and sets no cookies', async () => {
    const res = await request(app).post('/sso/consume').type('form').send({})

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('redirects a malformed ticket to login and sets no cookies', async () => {
    const res = await postForm('not-a-ticket')

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('rejects a query-string ticket even when the form body is valid', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post(`/sso/consume?ticket=${ticket}&redirect=https://evil.example`)
      .type('form')
      .send({ ticket })

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expect(res.headers.location).not.toContain(ticket)
    expect(res.headers.location).not.toContain('evil.example')
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('redirects an expired ticket to login and sets no cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { expiresAt: new Date(Date.now() - 1000) })

    const res = await postForm(ticket)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
  })

  test('redirects an already consumed ticket to login and sets no cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { consumedAt: new Date() })

    const res = await postForm(ticket)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
  })

  test('redirects an inactive user to login and sets no cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { user: { ...USER, isActive: false } })

    const res = await postForm(ticket)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
  })

  test('does not consume a non-form content type', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post('/sso/consume')
      .set('Content-Type', 'text/plain')
      .send(`ticket=${ticket}`)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('allows a first-time handoff when no auth cookie is present', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await postForm(ticket)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(SUCCESS_URL)
    expect(cookieRow(res, COOKIE_NAME)).not.toBe('')
  })

  test('replaces an existing B2B session when the handoff comes from Authify', async () => {
    const ticket = rawTicket()
    const nextUser = { ...USER, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'next@example.com' }
    remember(ticket, { user: nextUser })
    const oldCsrf = 'a'.repeat(64)

    const res = await request(app)
      .post('/sso/consume')
      .set('Origin', AUTHIFY_ORIGIN)
      .set('Cookie', [`auth_token=${sessionToken({ authMethod: 'sso' })}`, `${CSRF_COOKIE_NAME}=${oldCsrf}`])
      .type('form')
      .send({ ticket })

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(SUCCESS_URL)
    const claims = jwt.decode(cookieValue(res, COOKIE_NAME))
    expect(claims.sub).toBe(nextUser.id)
    expect(claims.authMethod).toBe('sso')
    const newCsrf = cookieValue(res, CSRF_COOKIE_NAME)
    expect(newCsrf).not.toBe('')
    expect(newCsrf).not.toBe(oldCsrf)
  })

  test.each([
    ['a missing Origin', null],
    ['an opaque "null" Origin', 'null'],
    ['an untrusted Origin', 'https://evil.example'],
    ['a look-alike Origin', 'https://authify.example.evil.example'],
    ['the B2B frontend Origin', 'http://localhost:5173'],
  ])('refuses %s without consuming the ticket, with or without a session', async (_label, origin) => {
    for (const cookie of [null, `auth_token=${sessionToken({ authMethod: 'sso' })}`]) {
      const ticket = rawTicket()
      remember(ticket)
      let req = request(app).post('/sso/consume')
      if (origin) req = req.set('Origin', origin)
      if (cookie) req = req.set('Cookie', cookie)

      const res = await req.type('form').send({ ticket })

      expect(res.status).toBe(303)
      expect(res.headers.location).toBe(FAILURE_URL)
      expectNoSession(res)
      expect(tickets.get(ticketHash(ticket)).consumedAt).toBeNull()
    }
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('refuses a ticket whose user became an admin, without a session', async () => {
    const ticket = rawTicket()
    remember(ticket, { user: { ...USER, role: 'ADMIN' } })

    const res = await postForm(ticket)

    expect(res.status).toBe(303)
    expect(res.headers.location).toBe(FAILURE_URL)
    expectNoSession(res)
  })

  test('JSON consume still requires CSRF when a session cookie is present', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post('/api/sso/consume-ticket')
      .set('Origin', AUTHIFY_ORIGIN)
      .set('Cookie', `auth_token=${sessionToken({ authMethod: 'sso' })}`)
      .send({ ticket })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED')
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('a trailing-slash path does not bypass the token CSRF check', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post('/sso/consume/')
      .set('Origin', AUTHIFY_ORIGIN)
      .set('Cookie', `auth_token=${sessionToken({ authMethod: 'sso' })}`)
      .type('form')
      .send({ ticket })

    expect(res.status).toBe(403)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('keeps the existing JSON consume endpoint', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post('/api/sso/consume-ticket')
      .send({ ticket })

    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(USER.id)
    expect(cookieRow(res, COOKIE_NAME)).not.toBe('')
  })

  test('does not write the form ticket or session JWT into the access log', async () => {
    const ticket = rawTicket()
    const sessionJwt = jwt.sign(
      { sub: USER.id, email: USER.email, role: USER.role },
      process.env.JWT_SECRET,
      { issuer: 'b2b-ecommerce-api', algorithm: 'HS256' },
    )
    const lines = []
    const log = pino({ level: 'info', redact: logger.LOG_REDACT }, {
      write(chunk) {
        lines.push(chunk.toString())
        return true
      },
    })
    const middleware = createRequestLogger(log)
    const req = {
      method: 'POST',
      url: `/sso/consume/${ticket}?ticket=${ticket}`,
      originalUrl: `/sso/consume/${ticket}?ticket=${ticket}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { ticket },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1 },
    }
    const res = new EventEmitter()
    res.statusCode = 303
    res.setHeader = () => {}
    res.getHeader = () => undefined
    res.getHeaders = () => ({
      location: SUCCESS_URL,
      'set-cookie': [`auth_token=${sessionJwt}; Path=/; HttpOnly`],
    })
    middleware(req, res, () => {})
    res.emit('finish')

    const output = lines.join('')
    expect(output).not.toContain(ticket)
    expect(output).not.toContain(sessionJwt)
    expect(output).toContain('[REDACTED]')
  })
})
