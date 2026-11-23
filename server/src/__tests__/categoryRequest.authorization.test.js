'use strict'

jest.mock('../config/database')

const { agent, cookieFor, makeToken, makeUser, makeSeller, IDS } = require('./helpers')
const { prisma } = require('../config/database')

const BUYER = makeUser()
const SELLER = makeSeller()
const ADMIN = makeUser({ id: IDS.ADMIN, email: 'admin@test.com', role: 'ADMIN' })

const buyerToken = makeToken({ id: BUYER.id, email: BUYER.email, role: 'BUYER' })
const sellerToken = makeToken({ id: SELLER.id, email: SELLER.email, role: 'SELLER' })
const adminToken = makeToken({ id: ADMIN.id, email: ADMIN.email, role: 'ADMIN' })

function authRecord(user) {
  return { ...user, isActive: true }
}

function mockUserLookup(users) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    const match = users.find((u) => u.id === where.id)
    return match ? authRecord(match) : null
  })
}

/**
 * Apply the same active-window filter the seller workspace query sends.
 * An expired row does not match expiresAt > now.
 */
function mockSellerSubscription({ plan, expiresAt }) {
  prisma.subscription.findFirst.mockImplementation(async ({ where }) => {
    const plans = where.plan?.in || []
    if (!plans.includes(plan) || where.status !== 'ACTIVE') return null
    const now = where.startsAt?.lte instanceof Date ? where.startsAt.lte : null
    const allowsLifetime = Array.isArray(where.OR) && where.OR.some((clause) => clause.expiresAt === null)
    const futureClause = Array.isArray(where.OR)
      ? where.OR.find((clause) => clause.expiresAt?.gt instanceof Date)
      : null
    if (!now || !allowsLifetime || !futureClause) return null
    if (expiresAt == null || expiresAt.getTime() > now.getTime()) {
      return { id: 'sub-seller-monthly' }
    }
    return null
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('SEC-01 — category-request route authorization', () => {
  test('BUYER without a seller subscription cannot create a category request (403 FORBIDDEN)', async () => {
    mockUserLookup([BUYER])
    prisma.subscription.findFirst.mockResolvedValue(null)

    const res = await agent
      .post('/api/category-requests')
      .set(cookieFor(buyerToken))
      .send({ categoryName: 'New Category' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(prisma.categoryRequest.create).not.toHaveBeenCalled()
  })

  test('BUYER with an active SELLER_MONTHLY subscription can create a category request', async () => {
    mockUserLookup([BUYER])
    mockSellerSubscription({
      plan: 'SELLER_MONTHLY',
      expiresAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    })
    prisma.categoryRequest.findFirst.mockResolvedValue(null)
    prisma.categoryRequest.create.mockResolvedValue({
      id: 'req-buyer-seller',
      sellerId: BUYER.id,
      categoryName: 'Industrial Metals',
      requestType: 'CATEGORY',
      status: 'PENDING',
    })

    const res = await agent
      .post('/api/category-requests')
      .set(cookieFor(buyerToken))
      .send({ categoryName: 'Industrial Metals' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: BUYER.id,
          status: 'ACTIVE',
          plan: expect.objectContaining({
            in: expect.arrayContaining(['SELLER_MONTHLY']),
          }),
        }),
      }),
    )
    expect(prisma.categoryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: BUYER.id }),
      }),
    )
  })

  test('BUYER with an expired seller subscription cannot create a category request (403 FORBIDDEN)', async () => {
    mockUserLookup([BUYER])
    mockSellerSubscription({
      plan: 'SELLER_MONTHLY',
      expiresAt: new Date(Date.now() - 60 * 1000),
    })

    const res = await agent
      .post('/api/category-requests')
      .set(cookieFor(buyerToken))
      .send({ categoryName: 'Expired Plan' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(prisma.categoryRequest.create).not.toHaveBeenCalled()
  })

  test('BUYER without a seller subscription cannot list category requests (403 FORBIDDEN)', async () => {
    mockUserLookup([BUYER])
    prisma.subscription.findFirst.mockResolvedValue(null)

    const res = await agent.get('/api/category-requests').set(cookieFor(buyerToken))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(prisma.categoryRequest.findMany).not.toHaveBeenCalled()
  })

  test('unauthenticated request receives 401', async () => {
    const res = await agent.post('/api/category-requests').send({ categoryName: 'X' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  test('SELLER can create a category request', async () => {
    mockUserLookup([SELLER])
    prisma.categoryRequest.findFirst.mockResolvedValue(null)
    prisma.categoryRequest.create.mockResolvedValue({
      id: 'req-1',
      sellerId: SELLER.id,
      categoryName: 'Industrial Metals',
      requestType: 'CATEGORY',
      status: 'PENDING',
    })

    const res = await agent
      .post('/api/category-requests')
      .set(cookieFor(sellerToken))
      .send({ categoryName: 'Industrial Metals' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
    expect(prisma.categoryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: SELLER.id }),
      }),
    )
  })

  test('ADMIN can create a category request (sellerId = admin user id)', async () => {
    mockUserLookup([ADMIN])
    prisma.categoryRequest.findFirst.mockResolvedValue(null)
    prisma.categoryRequest.create.mockResolvedValue({
      id: 'req-admin',
      sellerId: ADMIN.id,
      categoryName: 'Admin Requested Cat',
      requestType: 'CATEGORY',
      status: 'PENDING',
    })

    const res = await agent
      .post('/api/category-requests')
      .set(cookieFor(adminToken))
      .send({ categoryName: 'Admin Requested Cat' })

    expect(res.status).toBe(201)
    expect(prisma.categoryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: ADMIN.id }),
      }),
    )
  })

  test('SELLER can list own category requests', async () => {
    mockUserLookup([SELLER])
    prisma.categoryRequest.findMany.mockResolvedValue([])

    const res = await agent.get('/api/category-requests').set(cookieFor(sellerToken))

    expect(res.status).toBe(200)
    expect(prisma.categoryRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: SELLER.id },
      }),
    )
  })

  test('missing CSRF header keeps the existing CSRF rejection', async () => {
    const res = await agent
      .post('/api/category-requests')
      .set('Cookie', `auth_token=${buyerToken}; csrf_token=${process.env.TEST_CSRF_TOKEN}`)
      .send({ categoryName: 'No CSRF' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED')
    expect(prisma.categoryRequest.create).not.toHaveBeenCalled()
  })

  test('mismatched CSRF header keeps the existing CSRF rejection', async () => {
    const res = await agent
      .post('/api/category-requests')
      .set('Cookie', `auth_token=${buyerToken}; csrf_token=${process.env.TEST_CSRF_TOKEN}`)
      .set('X-CSRF-Token', 'different-csrf-token')
      .send({ categoryName: 'Bad CSRF' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED')
    expect(prisma.categoryRequest.create).not.toHaveBeenCalled()
  })
})
