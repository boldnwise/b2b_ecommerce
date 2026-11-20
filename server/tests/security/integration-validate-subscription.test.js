'use strict'

jest.mock('../../src/config/database')

const {
  agent,
  cookieFor,
  makeToken,
  makeUser,
  makeSeller,
  IDS,
} = require('../../src/__tests__/helpers')
const { prisma } = require('../../src/config/database')
const { installSubscriptionRows } = require('../../src/__tests__/helpers/subscriptionEntitlementFixtures.js')

const USER_A = makeUser({ id: IDS.BUYER, email: 'a@test.com', role: 'BUYER' })
const USER_B = makeUser({ id: IDS.OTHER_BUYER, email: 'b@test.com', role: 'BUYER' })

const tokenA = makeToken({ id: USER_A.id, email: USER_A.email, role: 'BUYER' })
const adminToken = makeToken({ id: IDS.ADMIN, email: 'admin@test.com', role: 'ADMIN' })

const userBSubsActive = [
  {
    id: 'sub-b-private',
    plan: 'BUYER_ANNUAL',
    status: 'ACTIVE',
    startsAt: new Date('2020-01-01'),
    expiresAt: new Date(Date.now() + 86400000),
  },
]

function userRecord(user, overrides = {}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyName: user.companyName ?? 'Co',
    createdAt: new Date('2024-01-01'),
    portalUserId: null,
    buyerSubscriptionStatus: overrides.buyerSubscriptionStatus ?? null,
    buyerSubscriptionPlan: overrides.buyerSubscriptionPlan ?? null,
    buyerSubscriptionActivatedAt: overrides.buyerSubscriptionActivatedAt ?? null,
    sellerSubscriptionStatus: overrides.sellerSubscriptionStatus ?? null,
    sellerSubscriptionPlan: overrides.sellerSubscriptionPlan ?? null,
    sellerSubscriptionActivatedAt: overrides.sellerSubscriptionActivatedAt ?? null,
    isActive: true,
    deactivatedAt: null,
  }
}

function isSubscriptionGateSelect(select) {
  return (
    select
    && select.role === true
    && select.isActive === true
    && !select.email
  )
}

function mockAuthLookup(extraUsers = {}) {
  const users = {
    [USER_A.id]: userRecord(USER_A),
    [USER_B.id]: userRecord(USER_B, {
      buyerSubscriptionStatus: 'ACTIVE',
      buyerSubscriptionPlan: 'BUYER_ANNUAL',
      buyerSubscriptionActivatedAt: new Date(),
    }),
    [IDS.ADMIN]: userRecord({ id: IDS.ADMIN, email: 'admin@test.com', role: 'ADMIN' }),
    ...extraUsers,
  }

  prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
    const base = users[where.id]
    if (!base) return null
    if (isSubscriptionGateSelect(select)) {
      return { role: base.role, isActive: base.isActive !== false }
    }
    return base
  })
}

describe('Integration POST /subscriptions/validate — IDOR boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthLookup()
  })

  test('I – User A cannot validate User B subscription (403 FORBIDDEN)', async () => {
    const res = await agent
      .post('/api/v1/integrations/subscriptions/validate')
      .set(cookieFor(tokenA))
      .send({ userId: USER_B.id, requiredType: 'BUYER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.data).toBeUndefined()
  })

  test('User A validating self returns own subscription data only', async () => {
    mockAuthLookup()
    prisma.subscription.findMany.mockResolvedValue([])
    prisma.subscription.findFirst.mockResolvedValue(null)

    const res = await agent
      .post('/api/v1/integrations/subscriptions/validate')
      .set(cookieFor(tokenA))
      .send({ userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.status).toBe(200)
    expect(res.body.data.userId).toBe(USER_A.id)
    expect(res.body.data.isValid).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBe('INACTIVE')
  })

  test('L – ADMIN may validate another user subscription', async () => {
    prisma.subscription.findMany.mockResolvedValue(userBSubsActive)
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-b-private' })

    const res = await agent
      .post('/api/v1/integrations/subscriptions/validate')
      .set(cookieFor(adminToken))
      .send({ userId: USER_B.id, requiredType: 'BUYER' })

    expect(res.status).toBe(200)
    expect(res.body.data.userId).toBe(USER_B.id)
    expect(res.body.data.isValid).toBe(true)
    expect(res.body.data.buyerSubscription.status).toBe('ACTIVE')
    expect(res.body.data.buyerSubscription.plan).toBe('BUYER_ANNUAL')
  })

  test('User B subscription data not returned to User A on forbidden attempt', async () => {
    const res = await agent
      .post('/api/v1/integrations/subscriptions/validate')
      .set(cookieFor(tokenA))
      .send({ userId: USER_B.id, requiredType: 'ANY' })

    expect(res.status).toBe(403)
    const body = JSON.stringify(res.body)
    expect(body).not.toContain('BUYER_ANNUAL')
    expect(body).not.toContain('sub-b-private')
  })
})

describe('Integration validate — entitlement lifecycle (SEC-03)', () => {
  const SELLER = makeSeller()
  const sellerToken = makeToken({ id: SELLER.id, email: SELLER.email, role: 'SELLER' })

  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthLookup({
      [SELLER.id]: userRecord(SELLER),
      [USER_A.id]: userRecord(USER_A, {
        buyerSubscriptionStatus: 'ACTIVE',
        buyerSubscriptionPlan: 'BUYER_ANNUAL',
      }),
    })
  })

  function postValidate(token, body) {
    return agent
      .post('/api/v1/integrations/subscriptions/validate')
      .set(cookieFor(token))
      .send(body)
  }

  test('active BUYER subscription with valid dates is entitled', async () => {
    const subs = [{
      id: 'sub-ok',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2020-01-01'),
      expiresAt: new Date(Date.now() + 86400000),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs)

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.status).toBe(200)
    expect(res.body.data.isValid).toBe(true)
    expect(res.body.data.status).toBe('ACTIVE')
  })

  test('future startsAt is not entitled even if denormalized status is ACTIVE', async () => {
    const subs = [{
      id: 'sub-fut',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2099-01-01'),
      expiresAt: new Date('2100-01-01'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs, { now: new Date() })

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.status).toBe(200)
    expect(res.body.data.isValid).toBe(false)
    expect(res.body.data.status).not.toBe('ACTIVE')
  })

  test('expired subscription is not entitled', async () => {
    const now = new Date('2026-08-01')
    jest.useFakeTimers().setSystemTime(now)
    const subs = [{
      id: 'sub-exp',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-07-01'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs, { now })

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.body.data.isValid).toBe(false)
    expect(res.body.data.isExpired).toBe(true)
    jest.useRealTimers()
  })

  test('expiresAt equal to now is not entitled', async () => {
    const now = new Date('2026-07-01T12:00:00.000Z')
    jest.useFakeTimers().setSystemTime(now)
    const subs = [{
      id: 'sub-edge',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-07-01T12:00:00.000Z'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs, { now })

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.body.data.isValid).toBe(false)
    jest.useRealTimers()
  })

  test('CANCELLED subscription is not entitled', async () => {
    const subs = [{
      id: 'sub-can',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'CANCELLED',
      startsAt: new Date('2020-01-01'),
      expiresAt: new Date('2099-01-01'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs)

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.body.data.isValid).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBe('CANCELLED')
  })

  test('no subscription rows → not entitled', async () => {
    prisma.subscription.findMany.mockResolvedValue([])
    installSubscriptionRows(prisma, [])

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.body.data.isValid).toBe(false)
  })

  test('SELLER requiredType uses seller entitlement only', async () => {
    const subs = [{
      id: 'sub-s',
      userId: SELLER.id,
      plan: 'SELLER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2020-01-01'),
      expiresAt: new Date('2099-01-01'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs)

    const res = await postValidate(sellerToken, { userId: SELLER.id, requiredType: 'SELLER' })

    expect(res.body.data.isValid).toBe(true)
    expect(res.body.data.planType).toBe('SELLER')
  })

  test('denormalized ACTIVE but expired row is not entitled', async () => {
    const subs = [{
      id: 'sub-stale-denorm',
      userId: USER_A.id,
      plan: 'BUYER_ANNUAL',
      status: 'ACTIVE',
      startsAt: new Date('2020-01-01'),
      expiresAt: new Date('2020-06-01'),
    }]
    prisma.subscription.findMany.mockResolvedValue(subs)
    installSubscriptionRows(prisma, subs, { now: new Date('2026-06-01') })

    const res = await postValidate(tokenA, { userId: USER_A.id, requiredType: 'BUYER' })

    expect(res.body.data.isValid).toBe(false)
    expect(res.body.data.buyerSubscription.status).toBe('EXPIRED')
  })
})

describe('Integration API production defaults (regression)', () => {
  test('J – production loads with integration API disabled by default', () => {
    jest.isolateModules(() => {
      const prev = process.env.NODE_ENV
      const prevSso = process.env.SSO_S2S_SECRET
      process.env.NODE_ENV = 'production'
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app'
      process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!'
      process.env.SSO_S2S_SECRET = 'test-sso-s2s-secret-at-least-32-characters'
      process.env.SSO_HANDOFF_ALLOWED_ORIGINS = 'https://portal.example.com'
      process.env.CLIENT_URL = 'https://app.example.com'
      process.env.RAZORPAY_KEY_ID = 'rzp_live_abc123'
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_value'
      process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_value'
      delete process.env.INTEGRATION_API_ENABLED
      delete process.env.INTEGRATION_S2S_SHARED_SECRET

      const env = require('../../src/config/env.js')
      expect(env.integrationApiEnabled).toBe(false)

      process.env.NODE_ENV = prev
      if (prevSso === undefined) delete process.env.SSO_S2S_SECRET
      else process.env.SSO_S2S_SECRET = prevSso
    })
  })
})
