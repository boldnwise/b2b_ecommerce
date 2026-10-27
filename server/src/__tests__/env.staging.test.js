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
  })
})
