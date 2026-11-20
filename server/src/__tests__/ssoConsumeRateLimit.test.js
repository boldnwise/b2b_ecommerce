'use strict'

jest.mock('../config/database')

const AUTHIFY_ORIGIN = 'https://authify.example'
process.env.SSO_HANDOFF_ALLOWED_ORIGINS = AUTHIFY_ORIGIN

const crypto = require('crypto')
const request = require('supertest')
const { prisma } = require('../config/database')

const LIMIT = 50

function rawTicket() {
  return crypto.randomBytes(32).toString('base64url')
}

function postHandoff(app) {
  return request(app)
    .post('/sso/consume')
    .set('Origin', AUTHIFY_ORIGIN)
    .type('form')
    .send({ ticket: rawTicket() })
}

function postConsumeTicket(app) {
  return request(app).post('/api/sso/consume-ticket').send({ ticket: rawTicket() })
}

let app
const realWarn = console.warn

beforeAll(() => {
  // The handoff Origin is intentionally outside CORS; skip that dev warning for each request.
  jest.spyOn(console, 'warn').mockImplementation((message, ...rest) => {
    if (String(message).startsWith('[CORS] Rejected origin')) return
    realWarn(message, ...rest)
  })
})

afterAll(() => {
  console.warn.mockRestore()
})

beforeEach(() => {
  jest.resetModules()
  jest.doMock('../config/database', () => ({ prisma }))
  app = require('../app')
  prisma.ssoTicket.updateMany.mockResolvedValue({ count: 0 })
})

describe('SSO consume rate limiting', () => {
  test('POST /sso/consume returns 429 after the auth limit and stops reading tickets', async () => {
    const first = await postHandoff(app)
    expect(first.status).toBe(303)
    expect(first.headers['ratelimit-limit']).toBe(String(LIMIT))

    for (let i = 1; i < LIMIT; i += 1) {
      const res = await postHandoff(app)
      expect(res.status).toBe(303)
    }
    prisma.ssoTicket.updateMany.mockClear()

    const blocked = await postHandoff(app)

    expect(blocked.status).toBe(429)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('POST /api/sso/consume-ticket returns 429 after the auth limit', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await postConsumeTicket(app)
      expect(res.status).toBe(401)
    }
    prisma.ssoTicket.updateMany.mockClear()

    const blocked = await postConsumeTicket(app)

    expect(blocked.status).toBe(429)
    expect(prisma.ssoTicket.updateMany).not.toHaveBeenCalled()
  })

  test('both consume routes share one budget that is separate from admin login', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      await (i % 2 === 0 ? postHandoff(app) : postConsumeTicket(app))
    }

    expect((await postConsumeTicket(app)).status).toBe(429)
    expect((await postHandoff(app)).status).toBe(429)

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'not-a-real-password' })
    expect(login.status).not.toBe(429)
  })
})
