'use strict'

jest.mock('../../src/config/database')

jest.mock('../../src/services/shopCategoryDbService.js', () => ({
  fetchActiveCategoryTree: jest.fn(async () => [
    { id: 'electronics', label: 'Electronics', slug: 'electronics', children: [] },
  ]),
  ensureDefaultCategories: jest.fn(),
  buildTree: jest.fn(),
}))

jest.mock('../../src/config/env.js', () => ({
  nodeEnv: 'production',
  isProd: true,
  isDev: false,
  port: 3001,
  databaseUrl: 'postgresql://test',
  jwtSecret: process.env.JWT_SECRET || 'test-secret-for-jest-only',
  jwtExpiresIn: '7d',
  cookieMaxAge: 604800000,
  corsAllowedOrigins: [
    'https://git-repo-gilt.vercel.app',
    'https://git-repo-*.vercel.app',
  ],
  corsAllowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Cache-Control',
    'X-Requested-With',
    'X-CSRF-Token',
  ],
  clientUrls: [
    'https://git-repo-gilt.vercel.app',
    'https://git-repo-*.vercel.app',
  ],
  useCrossSiteCookies: true,
  razorpayKeyId: 'rzp_live_testmock',
  razorpayKeySecret: 'live_secret_mock',
  razorpayWebhookSecret: 'webhook_secret_mock',
  integrationApiEnabled: false,
  integrationAllowDevNegotiationStub: false,
  integrationNegotiationVerifyUrl: '',
  integrationS2sSharedSecret: '',
  csrfProtectionEnabled: true,
  sentryDsn: '',
  mainPortalProfileEnabled: false,
  allowDummyDealPayments: false,
}))

const { agent } = require('../../src/__tests__/helpers')
const { prisma } = require('../../src/config/database')

beforeEach(() => {
  prisma.$queryRaw.mockResolvedValue([{ ok: 1 }])
})

const ORIGIN = 'https://git-repo-gilt.vercel.app'

describe('Production CORS headers', () => {
  test('OPTIONS preflight allows Cache-Control request header', async () => {
    const res = await agent
      .options('/api/shop-categories')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'cache-control')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-methods']).toContain('GET')
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('cache-control')
  })

  test('OPTIONS preflight allows Authorization request header', async () => {
    const res = await agent
      .options('/api/health')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type')

    expect(res.status).toBe(204)
    const allowed = res.headers['access-control-allow-headers'].toLowerCase()
    expect(allowed).toContain('authorization')
    expect(allowed).toContain('content-type')
  })

  test('GET /api/shop-categories returns ACAO with Cache-Control request header', async () => {
    const res = await agent
      .get('/api/shop-categories')
      .set('Origin', ORIGIN)
      .set('Cache-Control', 'no-cache')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data.tree)).toBe(true)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  test('GET /api/health returns ACAO for production Vercel origin', async () => {
    const res = await agent
      .get('/api/health')
      .set('Origin', ORIGIN)

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(String(res.headers['access-control-expose-headers']).toLowerCase()).toContain('x-csrf-token')
  })

  test('404 responses include ACAO for allowed origin', async () => {
    const res = await agent
      .get('/api/does-not-exist-route')
      .set('Origin', ORIGIN)

    expect(res.status).toBe(404)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.body.error?.code).toBe('NOT_FOUND')
  })

  test('Vercel preview origin matches wildcard allowlist pattern', async () => {
    const preview = 'https://git-repo-git-main-shalini-guptas-projects.vercel.app'
    const res = await agent
      .get('/api/health')
      .set('Origin', preview)

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(preview)
  })

  test('unknown origin is rejected without HTTP 500', async () => {
    const res = await agent
      .get('/api/health')
      .set('Origin', 'https://evil.com')

    expect(res.status).not.toBe(500)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
