'use strict'

describe('Staging environment (NODE_ENV=production, APP_ENV=staging)', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long!',
    CLIENT_URL: 'https://app.staging.example.com',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    SSO_S2S_SECRET: 'test-sso-s2s-secret-value-32chars!!',
    SSO_HANDOFF_ALLOWED_ORIGINS: 'https://app-staging.example.com',
  }

  function loadEnv(overrides = {}) {
    jest.resetModules()
    Object.assign(process.env, baseEnv, overrides)
    // eslint-disable-next-line global-require
    return require('../../src/config/env.js')
  }

  afterEach(() => {
    jest.resetModules()
    process.env.NODE_ENV = 'test'
    delete process.env.APP_ENV
  })

  test('starts without Razorpay credentials', () => {
    const env = loadEnv()
    expect(env.isProd).toBe(true)
    expect(env.isStaging).toBe(true)
    expect(env.appEnv).toBe('staging')
    expect(env.razorpayKeyId).toBe('')
    expect(env.razorpayKeySecret).toBe('')
    expect(env.ssoIssueEnabled).toBe(true)
    expect(env.ssoHandoffAllowedOrigins).toEqual(['https://app-staging.example.com'])
  })

  test('throws when staging omits SSO_HANDOFF_ALLOWED_ORIGINS', () => {
    expect(() => loadEnv({ SSO_HANDOFF_ALLOWED_ORIGINS: '' })).toThrow(/SSO_HANDOFF_ALLOWED_ORIGINS/)
  })

  test('throws when staging omits SSO_S2S_SECRET', () => {
    expect(() => loadEnv({ SSO_S2S_SECRET: '' })).toThrow(
      /SSO_S2S_SECRET must be at least 32 characters/,
    )
  })

  test('starts with Razorpay test keys without requiring live keys', () => {
    const env = loadEnv({
      RAZORPAY_KEY_ID: 'rzp_test_staging',
      RAZORPAY_KEY_SECRET: 'test_secret',
      RAZORPAY_WEBHOOK_SECRET: '',
    })
    expect(env.isStaging).toBe(true)
    expect(env.razorpayKeyId).toBe('rzp_test_staging')
  })

  test('rejects invalid APP_ENV when NODE_ENV=production', () => {
    expect(() => loadEnv({ APP_ENV: 'qa' })).toThrow(/APP_ENV must be "staging" or "production"/)
  })
})

describe('Production APP_ENV=production Razorpay guards', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long!',
    CLIENT_URL: 'https://app.example.com',
    SSO_S2S_SECRET: 'test-sso-s2s-secret-value-32chars!!',
    SSO_HANDOFF_ALLOWED_ORIGINS: 'https://app-staging.example.com',
  }

  function loadEnv(overrides = {}) {
    jest.resetModules()
    Object.assign(process.env, baseEnv, overrides)
    // eslint-disable-next-line global-require
    return require('../../src/config/env.js')
  }

  afterEach(() => {
    jest.resetModules()
    process.env.NODE_ENV = 'test'
    delete process.env.APP_ENV
  })

  test('default APP_ENV requires live Razorpay when unset', () => {
    expect(() => loadEnv({ RAZORPAY_KEY_ID: 'rzp_test_abc' })).toThrow(/live RAZORPAY_KEY_ID/)
  })

  test('APP_ENV=production requires live Razorpay explicitly', () => {
    expect(() => loadEnv({
      APP_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
    })).toThrow(/live RAZORPAY_KEY_ID/)
  })

  test('APP_ENV=production loads with live Razorpay config', () => {
    const env = loadEnv({
      APP_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      RAZORPAY_KEY_SECRET: 'live_secret_value',
      RAZORPAY_WEBHOOK_SECRET: 'webhook_secret_value',
    })
    expect(env.isStaging).toBe(false)
    expect(env.appEnv).toBe('production')
    expect(env.ssoIssueEnabled).toBe(true)
  })
})

describe('Local development SSO configuration', () => {
  afterEach(() => {
    jest.resetModules()
    process.env.NODE_ENV = 'test'
    delete process.env.APP_ENV
  })

  test('starts without SSO_S2S_SECRET and leaves the issue endpoint disabled', () => {
    jest.resetModules()
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app'
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!'
    delete process.env.SSO_S2S_SECRET
    delete process.env.APP_ENV
    // eslint-disable-next-line global-require
    const env = require('../../src/config/env.js')
    expect(env.isProd).toBe(false)
    expect(env.ssoS2sSecret).toBe('')
    expect(env.ssoIssueEnabled).toBe(false)
  })
})
