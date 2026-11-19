'use strict'

jest.mock('../config/database')

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
const {
  COOKIE_NAME,
  CSRF_COOKIE_NAME,
  authCookieOptions,
  csrfCookieOptions,
} = require('../config/cookies')

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
  return hash
}

function cookiesOf(res) {
  return res.headers['set-cookie'] || []
}

function cookieRow(res, name) {
  return cookiesOf(res).find((row) => row.startsWith(`${name}=`)) || ''
}

function expectNoSession(res) {
  expect(cookieRow(res, COOKIE_NAME)).toBe('')
  expect(cookieRow(res, CSRF_COOKIE_NAME)).toBe('')
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

describe('POST /api/sso/consume-ticket', () => {
  test('consumes a valid ticket and sets the existing session cookies', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.id).toBe(USER.id)
    expect(res.body.data.user.role).toBe('BUYER')
    expect(JSON.stringify(res.body)).not.toContain(ticket)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.subscription.create).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()

    const auth = cookieRow(res, COOKIE_NAME)
    const csrf = cookieRow(res, CSRF_COOKIE_NAME)
    const token = auth.split(';')[0].slice(`${COOKIE_NAME}=`.length)
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'b2b-ecommerce-api',
      algorithms: ['HS256'],
    })
    expect(decoded.sub).toBe(USER.id)
    expect(decoded.email).toBe(USER.email)
    expect(decoded.role).toBe(USER.role)
    expect(decoded.authMethod).toBe('sso')
    expect(decoded.iss).toBe('b2b-ecommerce-api')

    const authOptions = authCookieOptions()
    const csrfOptions = csrfCookieOptions()
    expect(auth.toLowerCase()).toContain('httponly')
    expect(auth.toLowerCase()).toContain('path=/')
    expect(auth.toLowerCase()).toContain(`samesite=${authOptions.sameSite}`)
    expect(csrf.toLowerCase()).not.toContain('httponly')
    expect(csrf.toLowerCase()).toContain('path=/')
    expect(csrf.toLowerCase()).toContain(`samesite=${csrfOptions.sameSite}`)
    expect(csrf.split(';')[0].slice(`${CSRF_COOKIE_NAME}=`.length)).toBe(res.headers['x-csrf-token'])
    if (authOptions.secure) expect(auth.toLowerCase()).toContain('secure')
    if (csrfOptions.secure) expect(csrf.toLowerCase()).toContain('secure')
    if (authOptions.partitioned) expect(auth.toLowerCase()).toContain('partitioned')
  })

  test('rejects a missing ticket without setting cookies', async () => {
    const res = await request(app).post('/api/sso/consume-ticket').send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('rejects a malformed ticket without setting cookies', async () => {
    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket: 'not-a-ticket' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('rejects a ticket supplied in the query string', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const res = await request(app)
      .post(`/api/sso/consume-ticket?ticket=${ticket}`)
      .send({ ticket })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expectNoSession(res)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('rejects an unknown ticket without setting cookies', async () => {
    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket: rawTicket() })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_TICKET_INVALID')
    expect(res.body.error.message).toBe('SSO ticket is invalid')
    expectNoSession(res)
  })

  test('rejects an expired ticket without setting cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { expiresAt: new Date(Date.now() - 1000) })

    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_TICKET_INVALID')
    expectNoSession(res)
    expect(prisma.ssoTicket.findUnique).not.toHaveBeenCalled()
  })

  test('rejects a ticket for a different audience without setting cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { audience: 'portal' })

    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_TICKET_INVALID')
    expectNoSession(res)
  })

  test('rejects an already consumed ticket without setting cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { consumedAt: new Date() })

    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_TICKET_INVALID')
    expectNoSession(res)
    expect(prisma.ssoTicket.findUnique).not.toHaveBeenCalled()
  })

  test('rejects an inactive user without setting cookies', async () => {
    const ticket = rawTicket()
    remember(ticket, { user: { ...USER, isActive: false } })

    const res = await request(app).post('/api/sso/consume-ticket').send({ ticket })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
    expectNoSession(res)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  test('lets exactly one of two concurrent requests consume the same ticket', async () => {
    const ticket = rawTicket()
    remember(ticket)

    const [first, second] = await Promise.all([
      request(app).post('/api/sso/consume-ticket').send({ ticket }),
      request(app).post('/api/sso/consume-ticket').send({ ticket }),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 401])
    const winner = first.status === 200 ? first : second
    const loser = first.status === 200 ? second : first
    expect(loser.body.error.code).toBe('SSO_TICKET_INVALID')
    expect(cookieRow(winner, COOKIE_NAME)).not.toBe('')
    expectNoSession(loser)
    expect(prisma.ssoTicket.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  test('does not write the raw ticket or session JWT into the access log', async () => {
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
      url: `/api/sso/consume-ticket?ticket=${ticket}`,
      originalUrl: `/api/sso/consume-ticket/${ticket}?ticket=${ticket}`,
      headers: {},
      body: { ticket },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1 },
    }
    const res = new EventEmitter()
    res.statusCode = 200
    res.setHeader = () => {}
    res.getHeader = () => undefined
    res.getHeaders = () => ({ 'set-cookie': [`auth_token=${sessionJwt}; Path=/; HttpOnly`] })
    middleware(req, res, () => {})
    res.emit('finish')

    const output = lines.join('')
    expect(output).not.toContain(ticket)
    expect(output).not.toContain(sessionJwt)
    expect(output).toContain('[REDACTED]')
  })
})
