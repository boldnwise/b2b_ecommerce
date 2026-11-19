'use strict'

describe('Production environment guards', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long!',
    CLIENT_URL: 'https://app.example.com',
    RAZORPAY_KEY_SECRET: 'live_secret_value',
    RAZORPAY_WEBHOOK_SECRET: 'webhook_secret_value',
    SSO_S2S_SECRET: 'test-sso-s2s-secret-value-32chars!!',
    SSO_HANDOFF_ALLOWED_ORIGINS: 'https://portal.example.com',
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
  })

  test('throws when production uses Razorpay test key id', () => {
    expect(() => loadEnv({ RAZORPAY_KEY_ID: 'rzp_test_abc123' })).toThrow(/live RAZORPAY_KEY_ID/)
  })

  test('throws when production omits Razorpay key id and secret', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      RAZORPAY_WEBHOOK_SECRET: '',
    })).toThrow(/live RAZORPAY_KEY_ID/)
  })

  test('throws when production omits webhook secret', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      RAZORPAY_WEBHOOK_SECRET: '',
    })).toThrow(/RAZORPAY_WEBHOOK_SECRET/)
  })

  test('loads when production has live Razorpay config', () => {
    const env = loadEnv({ RAZORPAY_KEY_ID: 'rzp_live_abc123' })
    expect(env.isProd).toBe(true)
    expect(env.razorpayKeyId).toBe('rzp_live_abc123')
    expect(env.ssoIssueEnabled).toBe(true)
  })

  test('throws when production omits SSO_S2S_SECRET', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      SSO_S2S_SECRET: '',
    })).toThrow(/SSO_S2S_SECRET must be at least 32 characters/)
  })

  test('loads the SSO handoff origin allowlist as exact origins', () => {
    const env = loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      SSO_HANDOFF_ALLOWED_ORIGINS: 'https://portal.example.com/, https://portal.example.com',
    })
    expect(env.ssoHandoffAllowedOrigins).toEqual(['https://portal.example.com'])
  })

  test('throws when production omits SSO_HANDOFF_ALLOWED_ORIGINS', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      SSO_HANDOFF_ALLOWED_ORIGINS: '',
    })).toThrow(/SSO_HANDOFF_ALLOWED_ORIGINS must list the Authify frontend origin/)
  })

  test.each([
    'http://portal.example.com',
    'https://localhost:5173',
    'https://*.example.com',
    'not a url',
  ])('throws when production SSO_HANDOFF_ALLOWED_ORIGINS contains %s', (origin) => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      SSO_HANDOFF_ALLOWED_ORIGINS: origin,
    })).toThrow(/SSO_HANDOFF_ALLOWED_ORIGINS/)
  })

  test('throws when production SSO_S2S_SECRET repeats JWT_SECRET', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      SSO_S2S_SECRET: baseEnv.JWT_SECRET,
    })).toThrow(/distinct from JWT_SECRET/)
  })

  test('throws when production JWT_SECRET is too short', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      JWT_SECRET: 'short',
    })).toThrow(/JWT_SECRET must be at least 32/)
  })

  test('throws when production JWT_SECRET uses placeholder text', () => {
    expect(() => loadEnv({
      RAZORPAY_KEY_ID: 'rzp_live_abc123',
      JWT_SECRET: 'replace-with-a-long-random-secret-at-least-32-chars',
    })).toThrow(/placeholder or example/)
  })
})
