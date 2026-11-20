'use strict'

jest.mock('../config/database')
jest.mock('../utils/audit')

const { agent, cookieFor, makeToken, makeUser, makeSeller, IDS } = require('./helpers')
const { prisma } = require('../config/database')
const { hasActiveSubscription, PLANS_BY_TYPE } = require('../middleware/requireSubscription.js')
const { buildSubscriptionSummary } = require('../controllers/subscriptionController.js')
const { installSubscriptionRows, authUserBase } = require('./helpers/subscriptionEntitlementFixtures.js')

const BUYER = makeUser()
const SELLER = makeSeller()
const USER_B = makeUser({ id: IDS.OTHER_BUYER, email: 'other@test.com' })

const buyerToken = makeToken({ id: BUYER.id, email: BUYER.email, role: 'BUYER' })
const sellerToken = makeToken({ id: SELLER.id, email: SELLER.email, role: 'SELLER' })
const userBToken = makeToken({ id: USER_B.id, email: USER_B.email, role: 'BUYER' })

const minimalRfqBody = {
  productTitle: 'Steel rods',
  message: 'Need quote for project',
  deliveryLocation: 'Mumbai',
  expectedDeliveryDate: '2026-12-01',
  sellerIds: [IDS.SELLER],
}

beforeEach(() => {
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma))
  jest.clearAllMocks()
})

describe('buildSubscriptionSummary lifecycle', () => {
  const user = authUserBase(BUYER)

  test('K – active buyer and seller flags from ACTIVE rows', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
      {
        plan: 'SELLER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.hasBuyerSubscription).toBe(true)
    expect(summary.hasSellerSubscription).toBe(true)
  })

  test.each(['BOTH_MONTHLY', 'BOTH_ANNUAL', 'BOTH_LIFETIME'])(
    'C – a single active %s row grants buyer and seller flags',
    (plan) => {
      const now = new Date('2026-06-01T12:00:00Z')
      const subs = [
        {
          plan,
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: plan === 'BOTH_LIFETIME' ? null : new Date('2026-07-01'),
        },
      ]
      const summary = buildSubscriptionSummary(user, subs, now)
      expect(summary.hasBuyerSubscription).toBe(true)
      expect(summary.hasSellerSubscription).toBe(true)
      expect(summary.buyerSubscription.status).toBe('ACTIVE')
      expect(summary.sellerSubscription.status).toBe('ACTIVE')
    },
  )

  test('C – an expired BOTH row grants neither workspace', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const subs = [
      {
        plan: 'BOTH_MONTHLY',
        status: 'ACTIVE',
        startsAt: new Date('2026-06-01'),
        expiresAt: new Date('2026-06-29'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.hasBuyerSubscription).toBe(false)
    expect(summary.hasSellerSubscription).toBe(false)
    expect(summary.buyerSubscription.status).toBe('EXPIRED')
    expect(summary.sellerSubscription.status).toBe('EXPIRED')
  })

  test('D – expired by expiresAt reports EXPIRED and inactive flags', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-07-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.buyerSubscription.status).toBe('EXPIRED')
    expect(summary.hasBuyerSubscription).toBe(false)
  })

  test('E – CANCELLED status does not grant entitlement', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'CANCELLED',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.buyerSubscription.status).toBe('CANCELLED')
    expect(summary.hasBuyerSubscription).toBe(false)
  })

  test('G – future startsAt does not report active buyer entitlement', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-09-01'),
        expiresAt: new Date('2027-09-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.buyerSubscription.status).toBeNull()
    expect(summary.hasBuyerSubscription).toBe(false)
  })

  test('date boundary – expiresAt equal to now is EXPIRED', () => {
    const now = new Date('2026-07-01T12:00:00.000Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-07-01T12:00:00.000Z'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.hasBuyerSubscription).toBe(false)
    expect(summary.buyerSubscription.status).toBe('EXPIRED')
  })

  test('date boundary – startsAt equal to now grants ACTIVE entitlement', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-06-01T12:00:00.000Z'),
        expiresAt: new Date('2027-06-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.hasBuyerSubscription).toBe(true)
    expect(summary.buyerSubscription.status).toBe('ACTIVE')
  })

  test('F – EXPIRED status enum does not grant even with future expiresAt', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'EXPIRED',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.buyerSubscription.status).toBe('EXPIRED')
    expect(summary.hasBuyerSubscription).toBe(false)
  })

  test('H – newer active row wins when ordered newest-first (expired older ignored for flags)', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const subs = [
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-05-01'),
        expiresAt: new Date('2027-05-01'),
      },
      {
        plan: 'BUYER_MONTHLY',
        status: 'ACTIVE',
        startsAt: new Date('2025-01-01'),
        expiresAt: new Date('2025-02-01'),
      },
    ]
    const summary = buildSubscriptionSummary(user, subs, now)
    expect(summary.hasBuyerSubscription).toBe(true)
    expect(summary.buyerSubscription.plan).toBe('BUYER_ANNUAL')
  })
})

describe('hasActiveSubscription service rules', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({ role: 'BUYER', isActive: true })
  })

  test('A – ACTIVE BUYER plan grants buyer entitlement only', async () => {
    const now = new Date('2026-06-15T12:00:00Z')
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-b',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(true)
    expect(await hasActiveSubscription(BUYER.id, 'SELLER')).toBe(false)
  })

  test('B – ACTIVE SELLER plan grants seller entitlement only', async () => {
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-s',
          userId: SELLER.id,
          plan: 'SELLER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ],
      { now: new Date() },
    )
    prisma.user.findUnique.mockResolvedValue({ role: 'SELLER', isActive: true })

    expect(await hasActiveSubscription(SELLER.id, 'SELLER')).toBe(true)
    expect(await hasActiveSubscription(SELLER.id, 'BUYER')).toBe(false)
  })

  test('C – BOTH bundle grants (buyer + seller rows)', async () => {
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-bb',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
        {
          id: 'sub-bs',
          userId: BUYER.id,
          plan: 'SELLER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ],
      { now: new Date('2026-06-01') },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(true)
    expect(await hasActiveSubscription(BUYER.id, 'SELLER')).toBe(true)
  })

  test('D/E – EXPIRED date and CANCELLED status deny access', async () => {
    const now = new Date('2026-08-01')
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-exp',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-07-01'),
        },
        {
          id: 'sub-can',
          userId: BUYER.id,
          plan: 'BUYER_MONTHLY',
          status: 'CANCELLED',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(false)
  })

  test('G – future startsAt denies current access', async () => {
    const now = new Date('2026-06-01')
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-future',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-12-01'),
          expiresAt: new Date('2027-12-01'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(false)
  })

  test('J – deactivated user denied even with ACTIVE subscription rows', async () => {
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-b',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2020-01-01'),
          expiresAt: null,
        },
      ],
      { now: new Date() },
    )
    prisma.user.findUnique.mockResolvedValue({ role: 'BUYER', isActive: false })

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(false)
  })

  test('date boundary – expiresAt one ms after now still active', async () => {
    const now = new Date('2026-07-01T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-edge',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-07-01T12:00:00.001Z'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(true)
    jest.useRealTimers()
  })

  test('date boundary – startsAt equal to now grants buyer entitlement', async () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-start-edge',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-06-01T12:00:00.000Z'),
          expiresAt: new Date('2027-06-01'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(true)
    jest.useRealTimers()
  })

  test('H – expired historical row plus valid newer row grants access', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    installSubscriptionRows(
      prisma,
      [
        {
          id: 'sub-old-exp',
          userId: BUYER.id,
          plan: 'BUYER_MONTHLY',
          status: 'ACTIVE',
          startsAt: new Date('2025-01-01'),
          expiresAt: new Date('2025-02-01'),
        },
        {
          id: 'sub-new',
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2026-01-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ],
      { now },
    )

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(true)
  })
})

describe('protected HTTP routes — entitlement enforcement', () => {
  function mockAuth(user) {
    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === user.id) return authUserBase(user)
      return null
    })
  }

  test('A/C – buyer with buyer+ seller subs passes buyer RFQ gate', async () => {
    mockAuth(BUYER)
    installSubscriptionRows(prisma, [
      {
        userId: BUYER.id,
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
      {
        userId: BUYER.id,
        plan: 'SELLER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    ])

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.body.error?.code).not.toBe('SUBSCRIPTION_REQUIRED')
  })

  test('B – active seller can pass seller product gate', async () => {
    mockAuth(SELLER)
    installSubscriptionRows(prisma, [
      {
        userId: SELLER.id,
        plan: 'SELLER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    ])

    const res = await agent
      .post('/api/products')
      .set(cookieFor(sellerToken))
      .field('name', 'Widget')
      .field('sku', 'SKU-100')
      .field('price', '50')
      .field('moq', '1')

    expect(res.body.error?.code).not.toBe('SUBSCRIPTION_REQUIRED')
  })

  test('E4 – expired seller subscription denied on seller product gate', async () => {
    mockAuth(SELLER)
    installSubscriptionRows(
      prisma,
      [
        {
          userId: SELLER.id,
          plan: 'SELLER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2025-01-01'),
          expiresAt: new Date('2025-06-01'),
        },
      ],
      { now: new Date('2026-06-01') },
    )

    const res = await agent
      .post('/api/products')
      .set(cookieFor(sellerToken))
      .field('name', 'Widget')
      .field('sku', 'SKU-200')
      .field('price', '50')
      .field('moq', '1')

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('D – expired subscription denied on buyer RFQ (SUBSCRIPTION_REQUIRED)', async () => {
    mockAuth(BUYER)
    installSubscriptionRows(
      prisma,
      [
        {
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2025-01-01'),
          expiresAt: new Date('2025-06-01'),
        },
      ],
      { now: new Date('2026-06-01') },
    )

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('E – CANCELLED subscription denied on buyer RFQ', async () => {
    mockAuth(BUYER)
    installSubscriptionRows(prisma, [
      {
        userId: BUYER.id,
        plan: 'BUYER_ANNUAL',
        status: 'CANCELLED',
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    ])

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('G – future startsAt denied on buyer RFQ', async () => {
    mockAuth(BUYER)
    installSubscriptionRows(
      prisma,
      [
        {
          userId: BUYER.id,
          plan: 'BUYER_ANNUAL',
          status: 'ACTIVE',
          startsAt: new Date('2099-01-01'),
          expiresAt: new Date('2100-01-01'),
        },
      ],
      { now: new Date() },
    )

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('J – deactivated user blocked before subscription (ACCOUNT_DEACTIVATED)', async () => {
    mockAuth({ ...BUYER, isActive: false })
    installSubscriptionRows(prisma, [
      {
        userId: BUYER.id,
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2020-01-01'),
        expiresAt: null,
      },
    ])

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED')
  })

  test('M – User B cannot use User A subscription (no rows for B)', async () => {
    mockAuth(USER_B)
    installSubscriptionRows(prisma, [
      {
        userId: BUYER.id,
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2020-01-01'),
        expiresAt: null,
      },
    ])

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(userBToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('L – backend ignores entitlement without DB rows (simulates no localStorage authority)', async () => {
    mockAuth(BUYER)
    installSubscriptionRows(prisma, [])

    const res = await agent
      .post('/api/quote-requests')
      .set(cookieFor(buyerToken))
      .send(minimalRfqBody)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SUBSCRIPTION_REQUIRED')
  })
})

describe('GET /api/subscriptions/status lifecycle (K)', () => {
  test('reports expired and no entitlement for past expiresAt', async () => {
    const now = new Date('2026-08-01T12:00:00Z')
    jest.useFakeTimers().setSystemTime(now)

    const subs = [
      {
        id: 'sub-1',
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-07-01'),
      },
    ]

    prisma.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === BUYER.id) return authUserBase(BUYER)
      return null
    })
    prisma.subscription.findMany.mockResolvedValue(subs)
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
    prisma.user.update.mockImplementation(async ({ data }) => ({ ...authUserBase(BUYER), ...data }))

    const res = await agent.get('/api/subscriptions/status').set(cookieFor(buyerToken))

    expect(res.status).toBe(200)
    expect(res.body.data.hasBuyerSubscription).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBe('EXPIRED')

    jest.useRealTimers()
  })

  test('no subscription rows → false flags', async () => {
    prisma.user.findUnique.mockResolvedValue(authUserBase(BUYER))
    prisma.subscription.findMany.mockResolvedValue([])
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 })

    const res = await agent.get('/api/subscriptions/status').set(cookieFor(buyerToken))

    expect(res.status).toBe(200)
    expect(res.body.data.hasBuyerSubscription).toBe(false)
    expect(res.body.data.hasSellerSubscription).toBe(false)
  })

  test('CANCELLED row → inactive flags on status endpoint', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    jest.useFakeTimers().setSystemTime(now)

    prisma.user.findUnique.mockResolvedValue(authUserBase(BUYER))
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-can',
        plan: 'BUYER_ANNUAL',
        status: 'CANCELLED',
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
      },
    ])
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
    prisma.user.update.mockImplementation(async ({ data }) => ({ ...authUserBase(BUYER), ...data }))

    const res = await agent.get('/api/subscriptions/status').set(cookieFor(buyerToken))

    expect(res.status).toBe(200)
    expect(res.body.data.hasBuyerSubscription).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBe('CANCELLED')

    jest.useRealTimers()
  })

  test('future startsAt → no entitlement on status endpoint', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    jest.useFakeTimers().setSystemTime(now)

    prisma.user.findUnique.mockResolvedValue(authUserBase(BUYER))
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-fut',
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-12-01'),
        expiresAt: new Date('2027-12-01'),
      },
    ])
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
    prisma.user.update.mockImplementation(async ({ data }) => ({ ...authUserBase(BUYER), ...data }))

    const res = await agent.get('/api/subscriptions/status').set(cookieFor(buyerToken))

    expect(res.status).toBe(200)
    expect(res.body.data.hasBuyerSubscription).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBeNull()

    jest.useRealTimers()
  })
})

describe('deal workspace capability aligns with startsAt', () => {
  test('G – future startsAt denies buyer deal capability (regression)', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    jest.useFakeTimers().setSystemTime(now)

    prisma.user.findUnique.mockResolvedValue(authUserBase(BUYER))
    prisma.subscription.findMany.mockResolvedValue([
      {
        plan: 'BUYER_ANNUAL',
        status: 'ACTIVE',
        startsAt: new Date('2026-12-01'),
        expiresAt: new Date('2027-12-01'),
      },
    ])

    const { assertBuyerDealCapability } = require('../services/dealAccessService.js')

    await expect(assertBuyerDealCapability({ id: BUYER.id, role: 'BUYER' })).rejects.toMatchObject({
      code: 'SUBSCRIPTION_REQUIRED',
    })

    jest.useRealTimers()
  })
})

describe('I – payment linkage without entitlement', () => {
  test('PENDING payment alone does not satisfy hasActiveSubscription', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'BUYER', isActive: true })
    installSubscriptionRows(prisma, [])
    prisma.payment.findFirst.mockResolvedValue({
      userId: BUYER.id,
      status: 'PENDING',
      razorpayOrderId: 'rzp_pending_only',
    })

    expect(await hasActiveSubscription(BUYER.id, 'BUYER')).toBe(false)
    expect(PLANS_BY_TYPE.BUYER.length).toBeGreaterThan(0)
  })
})
