'use strict'

describe('RFQ storage environment validation', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long!',
  }

  function loadEnv(overrides = {}) {
    jest.resetModules()
    Object.assign(process.env, baseEnv, overrides)
    // eslint-disable-next-line global-require
    return require('../config/env.js')
  }

  afterEach(() => {
    jest.resetModules()
    process.env.NODE_ENV = 'test'
    delete process.env.RFQ_STORAGE_DRIVER
    delete process.env.RFQ_S3_BUCKET
    delete process.env.AWS_REGION
    delete process.env.RFQ_S3_PREFIX
  })

  test('defaults to local driver', () => {
    const env = loadEnv()
    expect(env.rfqStorageDriver).toBe('local')
  })

  test('throws when RFQ_STORAGE_DRIVER=s3 without bucket', () => {
    expect(() => loadEnv({
      RFQ_STORAGE_DRIVER: 's3',
      AWS_REGION: 'ap-south-1',
      RFQ_S3_BUCKET: '',
    })).toThrow(/RFQ_S3_BUCKET is required/)
  })

  test('throws when RFQ_STORAGE_DRIVER=s3 without region', () => {
    expect(() => loadEnv({
      RFQ_STORAGE_DRIVER: 's3',
      RFQ_S3_BUCKET: 'my-bucket',
      AWS_REGION: '',
    })).toThrow(/AWS_REGION is required/)
  })

  test('loads when RFQ_STORAGE_DRIVER=s3 with bucket and region', () => {
    const env = loadEnv({
      RFQ_STORAGE_DRIVER: 's3',
      RFQ_S3_BUCKET: 'my-private-bucket',
      AWS_REGION: 'ap-south-1',
      RFQ_S3_PREFIX: 'attachments/',
    })
    expect(env.rfqStorageDriver).toBe('s3')
    expect(env.rfqS3Bucket).toBe('my-private-bucket')
    expect(env.rfqS3Prefix).toBe('attachments/')
  })

  test('rejects invalid RFQ_STORAGE_DRIVER', () => {
    expect(() => loadEnv({ RFQ_STORAGE_DRIVER: 'gcs' })).toThrow(/must be "local" or "s3"/)
  })
})
