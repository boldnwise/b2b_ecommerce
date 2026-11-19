'use strict'

process.env.SSO_S2S_SECRET = 'test-sso-s2s-secret-value-32chars!!'

jest.mock('../config/database')

const crypto = require('crypto')
const request = require('supertest')
const { Prisma } = require('@prisma/client')
const app = require('../app')
const { prisma } = require('../config/database')
const { MAX_SKEW_MS, NONCE_CLEANUP_MARGIN_MS } = require('../middleware/ssoS2sAuth')

const SECRET = process.env.SSO_S2S_SECRET
const PATH = '/api/sso/issue-ticket'
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function freshNonce() {
  return crypto.randomBytes(24).toString('base64url')
}

function sign(raw, timestamp = String(Date.now()), nonceValue = freshNonce()) {
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(`POST\n${PATH}\n${timestamp}\n${nonceValue}\n${raw}`, 'utf8')
    .digest('hex')
  return { timestamp, nonce: nonceValue, signature }
}

function postTicket(raw, options = {}) {
  const timestamp = options.timestamp || String(Date.now())
  const nonceValue = options.nonce === undefined ? freshNonce() : options.nonce
  const signed = options.signature
    ? { timestamp, nonce: nonceValue, signature: options.signature }
    : sign(raw, timestamp, nonceValue)
  const req = request(app)
    .post(PATH)
    .set('Content-Type', 'application/json')
    .set('X-SSO-Timestamp', signed.timestamp)
    .set('X-SSO-Signature', signed.signature)
  if (options.omitNonce !== true) req.set('X-SSO-Nonce', signed.nonce)
  return req.send(raw)
}

function payload(overrides = {}) {
  return JSON.stringify({
    authifyUserId: '1042',
    email: 'user@example.com',
    audience: 'b2b',
    ...overrides,
  })
}

let usedNonces

beforeEach(() => {
  usedNonces = new Set()
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma))
  prisma.user.findUnique.mockResolvedValue(null)
  prisma.user.create.mockImplementation(async ({ data }) => ({
    id: USER_ID,
    isActive: true,
    ...data,
  }))
  prisma.ssoTicket.create.mockImplementation(async ({ data }) => data)
  prisma.ssoNonce.deleteMany.mockResolvedValue({ count: 0 })
  prisma.ssoNonce.create.mockImplementation(async ({ data }) => {
    if (usedNonces.has(data.nonce)) {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['nonce'] } },
      )
    }
    usedNonces.add(data.nonce)
    return data
  })
  prisma.subscription.create.mockResolvedValue(null)
})

describe('POST /api/sso/issue-ticket', () => {
  test('accepts a valid S2S request and stores only the ticket hash', async () => {
    const raw = payload()
    const res = await postTicket(raw)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.expiresInSeconds).toBe(45)
    expect(res.body.data.ticket).toEqual(expect.any(String))
    expect(res.body.data.ticket).not.toMatch(/^[0-9a-f]{64}$/)

    const stored = prisma.ssoTicket.create.mock.calls[0][0].data
    const expectedHash = crypto.createHash('sha256').update(res.body.data.ticket, 'utf8').digest('hex')
    expect(stored.ticketHash).toBe(expectedHash)
    expect(stored.ticketHash).not.toBe(res.body.data.ticket)
    expect(stored.audience).toBe('b2b')
    expect(stored.userId).toBe(USER_ID)
    expect(stored.consumedAt).toBeNull()
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(44_000)
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThan(46_000)
    expect(JSON.stringify(res.body)).not.toContain(stored.ticketHash)
  })

  test('rejects a request with no signature', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-SSO-Timestamp', String(Date.now()))
      .send(payload())

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SIGNATURE_MISSING')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  test('rejects an invalid HMAC signature', async () => {
    const raw = payload()
    const signed = sign(raw)
    const res = await postTicket(raw, {
      timestamp: signed.timestamp,
      nonce: signed.nonce,
      signature: 'a'.repeat(64),
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_SIGNATURE_INVALID')
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  test('rejects a timestamp outside the 60 second window', async () => {
    const raw = payload()
    const timestamp = String(Date.now() - 61_000)
    const res = await postTicket(raw, { timestamp })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_TIMESTAMP_EXPIRED')
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('rejects a non-canonical authifyUserId', async () => {
    const raw = payload({ authifyUserId: '01042' })
    const res = await postTicket(raw)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  // client/tests/global-setup.js relies on this to check the secret without writing.
  test('a signed empty body is rejected before any nonce or ticket write', async () => {
    const res = await postTicket('{}')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(prisma.ssoNonce.create).not.toHaveBeenCalled()
    expect(prisma.ssoNonce.deleteMany).not.toHaveBeenCalled()
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  test('creates a buyer with no subscription for a new Authify user', async () => {
    const res = await postTicket(payload())

    expect(res.status).toBe(201)
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    const created = prisma.user.create.mock.calls[0][0].data
    expect(created).toMatchObject({
      email: 'user@example.com',
      role: 'BUYER',
      isActive: true,
      authifyUserId: '1042',
    })
    expect(typeof created.passwordHash).toBe('string')
    expect(created.passwordHash.length).toBeGreaterThan(20)
    expect(created.passwordHash).not.toBe('1042')
    expect(created.portalUserId).toBeUndefined()
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('issues a ticket for an existing linked active user without creating another account', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.authifyUserId === '1042') {
        return { id: USER_ID, email: 'linked@example.com', role: 'SELLER', isActive: true, authifyUserId: '1042' }
      }
      return null
    })

    const res = await postTicket(payload({ email: 'different@example.com' }))

    expect(res.status).toBe(201)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.ssoTicket.create.mock.calls[0][0].data.userId).toBe(USER_ID)
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('rejects an inactive linked user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      role: 'BUYER',
      isActive: false,
      authifyUserId: '1042',
    })

    const res = await postTicket(payload())

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('refuses a linked admin account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      role: 'ADMIN',
      isActive: true,
      authifyUserId: '1042',
    })

    const res = await postTicket(payload())

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SSO_ADMIN_NOT_ALLOWED')
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('returns 409 when the email belongs to an unlinked account and does not create a duplicate', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.email === 'user@example.com') {
        return { id: USER_ID, email: 'user@example.com', role: 'BUYER', isActive: true, authifyUserId: null }
      }
      return null
    })

    const res = await postTicket(payload())

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ACCOUNT_LINK_REQUIRED')
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  test('maps a unique email collision during create to ACCOUNT_LINK_REQUIRED', async () => {
    prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['email'] } },
    ))

    const res = await postTicket(payload())

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ACCOUNT_LINK_REQUIRED')
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('rejects replay of the same signed request and nonce', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      role: 'BUYER',
      isActive: true,
      authifyUserId: '1042',
    })
    const raw = payload()
    const signed = sign(raw)

    const first = await postTicket(raw, signed)
    const second = await postTicket(raw, signed)

    expect(first.status).toBe(201)
    expect(second.status).toBe(401)
    expect(second.body.error.code).toBe('SSO_NONCE_REUSED')
    expect(prisma.ssoTicket.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoNonce.create).toHaveBeenCalledTimes(2)
    const stored = prisma.ssoNonce.create.mock.calls[0][0].data
    expect(stored.nonce).toBe(signed.nonce)
    expect(stored.expiresAt.getTime()).toBe(
      Number(signed.timestamp) + MAX_SKEW_MS + NONCE_CLEANUP_MARGIN_MS,
    )
  })

  test('accepts only one of two concurrent requests that share a nonce', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      role: 'BUYER',
      isActive: true,
      authifyUserId: '1042',
    })
    const raw = payload()
    const signed = sign(raw)

    const [first, second] = await Promise.all([
      postTicket(raw, signed),
      postTicket(raw, signed),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 401])
    const rejected = [first, second].find((res) => res.status === 401)
    expect(rejected.body.error.code).toBe('SSO_NONCE_REUSED')
    expect(prisma.ssoTicket.create).toHaveBeenCalledTimes(1)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  test('recovers when another request creates the same Authify user first', async () => {
    let lookups = 0
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.authifyUserId !== '1042') return null
      lookups += 1
      if (lookups === 1) return null
      return {
        id: USER_ID,
        email: 'user@example.com',
        role: 'BUYER',
        isActive: true,
        authifyUserId: '1042',
      }
    })
    prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['authifyUserId'] } },
    ))

    const res = await postTicket(payload())

    expect(res.status).toBe(201)
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.create.mock.calls[0][0].data.userId).toBe(USER_ID)
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('returns 403 when race recovery finds an inactive user', async () => {
    let lookups = 0
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.authifyUserId !== '1042') return null
      lookups += 1
      if (lookups === 1) return null
      return {
        id: USER_ID,
        email: 'user@example.com',
        role: 'BUYER',
        isActive: false,
        authifyUserId: '1042',
      }
    })
    prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['authifyUserId'] } },
    ))

    const res = await postTicket(payload())

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('returns a controlled error when the raced user cannot be re-read', async () => {
    prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['authifyUserId'] } },
    ))

    const res = await postTicket(payload())

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SSO_USER_CONFLICT')
    expect(prisma.user.create).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })

  test('issues one ticket each for two concurrent first-time requests with different nonces', async () => {
    let createsStarted = 0
    let releaseFirst
    const firstCanFinish = new Promise((resolve) => {
      releaseFirst = resolve
    })
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.authifyUserId === '1042' && createsStarted >= 2) {
        return {
          id: USER_ID,
          email: 'user@example.com',
          role: 'BUYER',
          isActive: true,
          authifyUserId: '1042',
        }
      }
      return null
    })
    prisma.user.create.mockImplementation(async ({ data }) => {
      createsStarted += 1
      if (createsStarted === 1) {
        await firstCanFinish
        return { id: USER_ID, isActive: true, ...data }
      }
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.3.0', meta: { target: ['authifyUserId'] } },
      )
    })

    const pending = Promise.all([postTicket(payload()), postTicket(payload())])
    await new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (createsStarted >= 2) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 3000) {
          clearInterval(timer)
          reject(new Error('the two creates did not overlap'))
        }
      }, 10)
    })
    releaseFirst()

    const [first, second] = await pending
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(prisma.user.create).toHaveBeenCalledTimes(2)
    expect(prisma.ssoTicket.create).toHaveBeenCalledTimes(2)
    expect(prisma.subscription.create).not.toHaveBeenCalled()
  })

  test('rejects a missing nonce', async () => {
    const raw = payload()
    const res = await postTicket(raw, { omitNonce: true, signature: 'ab'.repeat(32) })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_NONCE_MISSING')
    expect(prisma.ssoNonce.create).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  test('rejects an invalid nonce', async () => {
    const raw = payload()
    const res = await postTicket(raw, { nonce: 'short', signature: 'ab'.repeat(32) })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('SSO_NONCE_INVALID')
    expect(prisma.ssoNonce.create).not.toHaveBeenCalled()
    expect(prisma.ssoTicket.create).not.toHaveBeenCalled()
  })
})
