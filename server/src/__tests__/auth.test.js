'use strict'

/**
 * Auth API integration tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes tested:
 *   POST  /api/auth/register
 *   POST  /api/auth/login
 *   GET   /api/auth/me
 *   POST  /api/auth/logout
 *
 * Prisma is mocked via src/config/__mocks__/database.js so no real DB is hit.
 */

jest.mock('../config/database')
jest.mock('../utils/audit')

const jwt = require('jsonwebtoken')
const env = require('../config/env.js')

const { agent, makeToken, makeUser, IDS } = require('./helpers')
const { prisma } = require('../config/database')
const { hashPassword } = require('../utils/password')

// ── Shared test user ──────────────────────────────────────────────────────────

// passwordHash is populated in beforeAll once bcrypt has run
let BUYER_PASSWORD_HASH

const BUYER = makeUser({
  id:          IDS.BUYER,
  email:       'buyer@example.com',
  role:        'BUYER',
  companyName: 'Acme Buyers Ltd',
})

const SELLER = makeUser({
  id:          IDS.SELLER,
  email:       'seller@example.com',
  role:        'SELLER',
  companyName: 'Acme Sellers Ltd',
})

const ADMIN = makeUser({
  id:          IDS.ADMIN,
  email:       'admin@example.com',
  role:        'ADMIN',
  companyName: null,
})

beforeAll(async () => {
  BUYER_PASSWORD_HASH = await hashPassword('CorrectPassword1!')
})

beforeEach(() => {
  jest.clearAllMocks()
  // Restore $transaction default behaviour after each reset
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma))
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  test.each([
    ['BUYER', { email: 'new@example.com', password: 'StrongPass1!', role: 'BUYER', companyName: 'New Co' }],
    ['SELLER', { email: 'new@example.com', password: 'StrongPass1!', role: 'SELLER' }],
    ['ADMIN', { email: 'admin@example.com', password: 'StrongPass1!', role: 'ADMIN' }],
    ['empty body', {}],
  ])('403 – %s registration is refused without creating a user or session', async (_label, body) => {
    const res = await agent.post('/api/auth/register').send(body)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('REGISTRATION_DISABLED')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
    const setCookie = res.headers['set-cookie'] ?? []
    expect(setCookie.some((c) => c.startsWith('auth_token='))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('200 – admin credentials set auth cookie and return user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...ADMIN,
      passwordHash: BUYER_PASSWORD_HASH,
    })

    const res = await agent.post('/api/auth/login').send({
      email:    ADMIN.email,
      password: 'CorrectPassword1!',
    })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.email).toBe(ADMIN.email)
    const setCookie = res.headers['set-cookie'] ?? []
    expect(setCookie.some((c) => c.startsWith('auth_token='))).toBe(true)
    const authToken = setCookie.find((c) => c.startsWith('auth_token=')).split(';')[0].slice('auth_token='.length)
    expect(jwt.decode(authToken).authMethod).toBe('password')
    const csrfCookie = setCookie.find((cookie) => cookie.startsWith('csrf_token='))
    const csrfValue = csrfCookie?.split(';')[0].slice('csrf_token='.length)
    expect(csrfValue).toBeTruthy()
    expect(res.headers['x-csrf-token']).toBe(csrfValue)
    expect(csrfCookie.toLowerCase()).not.toContain('httponly')
    // Password hash must never appear in the response body
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
  })

  test.each([
    ['BUYER', BUYER],
    ['SELLER', SELLER],
  ])('403 – %s with the correct password must use Authify and gets no session', async (_role, user) => {
    prisma.user.findUnique.mockResolvedValue({ ...user, passwordHash: BUYER_PASSWORD_HASH })

    const res = await agent.post('/api/auth/login').send({
      email:    user.email,
      password: 'CorrectPassword1!',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SSO_REQUIRED')
    const setCookie = res.headers['set-cookie'] ?? []
    expect(setCookie.some((c) => c.startsWith('auth_token='))).toBe(false)
    expect(setCookie.some((c) => c.startsWith('csrf_token='))).toBe(false)
  })

  test('401 – unknown email returns INVALID_CREDENTIALS', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    const res = await agent.post('/api/auth/login').send({
      email:    'ghost@example.com',
      password: 'AnyPassword1!',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  test('401 – correct email but wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...BUYER,
      passwordHash: BUYER_PASSWORD_HASH,
    })

    const res = await agent.post('/api/auth/login').send({
      email:    'buyer@example.com',
      password: 'WrongPassword99!',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  test('400 – missing password field', async () => {
    const res = await agent.post('/api/auth/login').send({
      email: 'buyer@example.com',
    })

    expect(res.status).toBe(400)
  })

  test('403 – deactivated user cannot login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...BUYER,
      passwordHash: BUYER_PASSWORD_HASH,
      isActive: false,
    })

    const res = await agent.post('/api/auth/login').send({
      email: 'buyer@example.com',
      password: 'CorrectPassword1!',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
  })

  test('200 – login Set-Cookie includes HttpOnly auth_token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...ADMIN,
      passwordHash: BUYER_PASSWORD_HASH,
    })

    const res = await agent.post('/api/auth/login').send({
      email: ADMIN.email,
      password: 'CorrectPassword1!',
    })

    const setCookie = (res.headers['set-cookie'] ?? []).join(';')
    expect(setCookie).toMatch(/auth_token=/)
    expect(setCookie.toLowerCase()).toMatch(/httponly/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  test('200 – valid cookie returns authenticated user', async () => {
    prisma.user.findUnique.mockResolvedValue(BUYER)

    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(BUYER.id)
    expect(res.body.data.user.email).toBe(BUYER.email)
    const csrfCookie = (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('csrf_token='))
    const csrfValue = csrfCookie?.split(';')[0].slice('csrf_token='.length)
    expect(res.headers['x-csrf-token']).toBe(csrfValue)
  })

  test('401 – no token returns UNAUTHORIZED', async () => {
    const res = await agent.get('/api/auth/me')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  test('401 – tampered / invalid token returns INVALID_TOKEN', async () => {
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', 'auth_token=not.a.valid.jwt')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  test('401 – expired JWT is rejected', async () => {
    const token = jwt.sign(
      { sub: BUYER.id, email: BUYER.email, role: BUYER.role },
      env.jwtSecret,
      { expiresIn: '-1s', issuer: 'b2b-ecommerce-api', algorithm: 'HS256' },
    )

    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  test('401 – valid token but user deleted from DB', async () => {
    prisma.user.findUnique.mockResolvedValue(null) // user no longer exists

    const token = makeToken({ id: 'deleted-user-id', email: 'gone@example.com', role: 'BUYER' })
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('USER_NOT_FOUND')
  })

  test('401 – Authorization: Bearer header also accepted', async () => {
    prisma.user.findUnique.mockResolvedValue(BUYER)

    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const res = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(BUYER.id)
  })

  test('403 – deactivated user cannot use protected /auth/me', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...BUYER, isActive: false })

    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Session origin policy: buyers and sellers need an SSO session
// ─────────────────────────────────────────────────────────────────────────────

describe('session origin policy', () => {
  async function me(user, tokenOptions) {
    prisma.user.findUnique.mockResolvedValue(user)
    const token = makeToken({ id: user.id, email: user.email, role: user.role, ...tokenOptions })
    return agent.get('/api/auth/me').set('Cookie', `auth_token=${token}`)
  }

  test.each([
    ['BUYER password session', BUYER, { authMethod: 'password' }],
    ['SELLER password session', SELLER, { authMethod: 'password' }],
    ['BUYER session from before the policy', BUYER, { authMethod: null }],
    ['SELLER session from before the policy', SELLER, { authMethod: null }],
  ])('401 – %s is rejected and its cookie is cleared', async (_label, user, tokenOptions) => {
    const res = await me(user, tokenOptions)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SESSION_REQUIRED')
    const setCookie = (res.headers['set-cookie'] ?? []).join(';')
    expect(setCookie).toMatch(/auth_token=;/)
  })

  test.each([
    ['BUYER SSO session', BUYER, { authMethod: 'sso' }],
    ['SELLER SSO session', SELLER, { authMethod: 'sso' }],
    ['ADMIN password session', ADMIN, { authMethod: 'password' }],
    ['ADMIN session from before the policy', ADMIN, { authMethod: null }],
  ])('200 – %s is accepted', async (_label, user, tokenOptions) => {
    const res = await me(user, tokenOptions)

    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(user.id)
  })

  test('401 – an SSO session for a user who is now an admin is rejected', async () => {
    const res = await me(ADMIN, { authMethod: 'sso' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('ADMIN_LOGIN_REQUIRED')
    expect((res.headers['set-cookie'] ?? []).join(';')).toMatch(/auth_token=;/)
  })

  test('401 – a demoted admin password session is rejected', async () => {
    const res = await me(BUYER, { authMethod: 'password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SESSION_REQUIRED')
  })

  test('401 – the current database role decides, not the role in the token', async () => {
    const res = await me(BUYER, { role: 'ADMIN', authMethod: 'password' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SESSION_REQUIRED')
  })

  test('403 – a buyer SSO session cannot use admin APIs', async () => {
    prisma.user.findUnique.mockResolvedValue(BUYER)
    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: 'BUYER' })

    const res = await agent.get('/api/admin/buyers').set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('401 – a buyer password session cannot reach admin APIs', async () => {
    prisma.user.findUnique.mockResolvedValue(BUYER)
    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: 'BUYER', authMethod: 'password' })

    const res = await agent.get('/api/admin/buyers').set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SESSION_REQUIRED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('200 – clears auth cookie (no auth required)', async () => {
    const res = await agent.post('/api/auth/logout')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // Set-Cookie should clear the cookie (Max-Age=0 or Expires in the past)
    const setCookie = (res.headers['set-cookie'] ?? []).join(';')
    expect(setCookie).toMatch(/auth_token=;/)
  })

  test('200 – logout succeeds even without a session cookie', async () => {
    const res = await agent.post('/api/auth/logout')

    expect(res.status).toBe(200)
  })

  test('logout clears auth_token and does not clear csrf_token', async () => {
    const res = await agent.post('/api/auth/logout')
    const setCookie = res.headers['set-cookie'] ?? []

    expect(setCookie.some((cookie) => cookie.startsWith('auth_token='))).toBe(true)
    expect(setCookie.some((cookie) => cookie.startsWith('csrf_token='))).toBe(false)
  })
})

function cookieRow(res, name) {
  return (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith(`${name}=`)) || ''
}

function cookieValue(res, name) {
  const row = cookieRow(res, name)
  return row ? row.split(';')[0].slice(name.length + 1) : ''
}

function cookieMaxAge(res, name) {
  const match = cookieRow(res, name).match(/Max-Age=(\d+)/i)
  return match ? match[1] : null
}

describe('stable CSRF token', () => {
  const VALID_CSRF = 'a'.repeat(64)

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(BUYER)
  })

  test('generates a token when the cookie is missing and matches the header and auth maxAge', async () => {
    const token = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const res = await agent.get('/api/auth/me').set('Cookie', `auth_token=${token}`)

    expect(res.status).toBe(200)
    expect(res.headers['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/)
    expect(cookieValue(res, 'csrf_token')).toBe(res.headers['x-csrf-token'])
    expect(cookieMaxAge(res, 'csrf_token')).toBeTruthy()
  })

  test('login sets csrf_token with the same Max-Age as auth_token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...ADMIN,
      passwordHash: BUYER_PASSWORD_HASH,
    })

    const res = await agent.post('/api/auth/login').send({
      email: ADMIN.email,
      password: 'CorrectPassword1!',
    })

    expect(res.status).toBe(200)
    expect(cookieValue(res, 'csrf_token')).toBe(res.headers['x-csrf-token'])
    expect(cookieMaxAge(res, 'csrf_token')).toBe(cookieMaxAge(res, 'auth_token'))
    expect(cookieRow(res, 'auth_token').toLowerCase()).toContain('httponly')
    expect(cookieRow(res, 'csrf_token').toLowerCase()).not.toContain('httponly')
  })

  test('reuses a valid csrf cookie on login and /auth/me', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...ADMIN,
      passwordHash: BUYER_PASSWORD_HASH,
    })
    const loggedIn = await agent
      .post('/api/auth/login')
      .set('Cookie', `csrf_token=${VALID_CSRF}`)
      .send({ email: ADMIN.email, password: 'CorrectPassword1!' })

    expect(loggedIn.status).toBe(200)
    expect(loggedIn.headers['x-csrf-token']).toBe(VALID_CSRF)
    expect(cookieValue(loggedIn, 'csrf_token')).toBe(VALID_CSRF)
    expect(cookieMaxAge(loggedIn, 'csrf_token')).toBe(cookieMaxAge(loggedIn, 'auth_token'))

    prisma.user.findUnique.mockResolvedValue(BUYER)
    const authToken = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const me = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authToken}; csrf_token=${VALID_CSRF}`)

    expect(me.status).toBe(200)
    expect(me.headers['x-csrf-token']).toBe(VALID_CSRF)
    expect(cookieValue(me, 'csrf_token')).toBe(VALID_CSRF)
    expect(cookieMaxAge(me, 'csrf_token')).toBe(cookieMaxAge(loggedIn, 'csrf_token'))
  })

  test('generates a new token when the cookie is not 64 lowercase hex characters', async () => {
    const authToken = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authToken}; csrf_token=not-a-valid-token`)

    expect(res.headers['x-csrf-token']).toMatch(/^[a-f0-9]{64}$/)
    expect(res.headers['x-csrf-token']).not.toBe('not-a-valid-token')
    expect(cookieValue(res, 'csrf_token')).toBe(res.headers['x-csrf-token'])
  })

  test('two sessions with the same cookie receive that cookie and do not replace it', async () => {
    const authToken = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const first = await agent.get('/api/auth/me').set('Cookie', `auth_token=${authToken}`)
    const shared = first.headers['x-csrf-token']

    const second = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authToken}; csrf_token=${shared}`)

    expect(second.headers['x-csrf-token']).toBe(shared)
    expect(cookieValue(second, 'csrf_token')).toBe(shared)
    expect(cookieMaxAge(second, 'csrf_token')).toBe(cookieMaxAge(first, 'csrf_token'))
  })

  test('concurrent /auth/me calls reuse an existing cookie', async () => {
    const authToken = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const cookie = `auth_token=${authToken}; csrf_token=${VALID_CSRF}`
    const [first, second] = await Promise.all([
      agent.get('/api/auth/me').set('Cookie', cookie),
      agent.get('/api/auth/me').set('Cookie', cookie),
    ])

    expect(first.headers['x-csrf-token']).toBe(VALID_CSRF)
    expect(second.headers['x-csrf-token']).toBe(VALID_CSRF)
    expect(cookieValue(first, 'csrf_token')).toBe(VALID_CSRF)
    expect(cookieValue(second, 'csrf_token')).toBe(VALID_CSRF)
    expect(cookieMaxAge(first, 'csrf_token')).toBeTruthy()
    expect(cookieMaxAge(second, 'csrf_token')).toBe(cookieMaxAge(first, 'csrf_token'))
  })

  test('concurrent first issuance can differ, and a later /auth/me returns the surviving cookie', async () => {
    const authToken = makeToken({ id: BUYER.id, email: BUYER.email, role: BUYER.role })
    const [first, second] = await Promise.all([
      agent.get('/api/auth/me').set('Cookie', `auth_token=${authToken}`),
      agent.get('/api/auth/me').set('Cookie', `auth_token=${authToken}`),
    ])

    expect(cookieValue(first, 'csrf_token')).toBe(first.headers['x-csrf-token'])
    expect(cookieValue(second, 'csrf_token')).toBe(second.headers['x-csrf-token'])

    const surviving = second.headers['x-csrf-token']
    const recovery = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authToken}; csrf_token=${surviving}`)

    expect(recovery.headers['x-csrf-token']).toBe(surviving)
    expect(cookieValue(recovery, 'csrf_token')).toBe(surviving)
    expect(cookieMaxAge(recovery, 'csrf_token')).toBeTruthy()
  })
})

