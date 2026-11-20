'use strict'

jest.mock('../../src/config/database')
jest.mock('../../src/utils/audit')
jest.mock('../../src/config/env.js', () => ({
  nodeEnv: 'production',
  isProd: true,
  isDev: false,
  allowDummyDealPayments: false,
  port: 3001,
  databaseUrl: 'postgresql://test',
  jwtSecret: process.env.JWT_SECRET || 'test-secret-for-jest-only',
  jwtExpiresIn: '7d',
  cookieMaxAge: 604800000,
  corsAllowedOrigins: ['https://app.example.com'],
  corsAllowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'X-Requested-With'],
  clientUrls: ['https://app.example.com'],
  useCrossSiteCookies: true,
  razorpayKeyId: '',
  razorpayKeySecret: '',
  mainPortalProfileEnabled: false,
}))

const { agent, cookieFor, makeToken, IDS } = require('../../src/__tests__/helpers')
const { prisma } = require('../../src/config/database')

const buyerToken = makeToken({ id: IDS.BUYER, role: 'BUYER' })

beforeEach(() => {
  jest.clearAllMocks()
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma))
  prisma.$queryRaw.mockResolvedValue([])
  prisma.user.findUnique.mockResolvedValue({
    id: IDS.BUYER,
    role: 'BUYER',
    email: 'buyer@test.com',
    companyName: 'Buyer Co',
    buyerSubscriptionPlan: 'BUYER_LIFETIME',
    buyerSubscriptionStatus: 'ACTIVE',
    sellerSubscriptionPlan: null,
    sellerSubscriptionStatus: null,
  })
  prisma.subscription.findMany.mockResolvedValue([
    { plan: 'BUYER_LIFETIME', status: 'ACTIVE', startsAt: new Date(), expiresAt: null },
  ])
})

describe('Deal payment production guard', () => {
  test('503 – dummy deal payment rejected in production', async () => {
    const res = await agent
      .post(`/api/v1/deals/${IDS.DEAL}/pay`)
      .set(cookieFor(buyerToken))

    expect(res.status).toBe(503)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
