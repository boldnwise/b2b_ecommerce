'use strict'

const path = require('path')
const { spawnSync } = require('child_process')
const { validateMigrationEnv } = require('../../scripts/check-migration-env.js')

// Fake hosts/passwords only — nothing here can reach a real database.
const FAKE_PASSWORD = 'fakeMigrationPw987'
const RUNTIME_URL = `postgresql://app_user:${FAKE_PASSWORD}@db.invalid:5432/app?sslmode=require`
const DIRECT_URL = `postgresql://migrator:${FAKE_PASSWORD}@db.invalid:5432/app?sslmode=require`

describe('validateMigrationEnv', () => {
  test('accepts valid runtime and direct URLs', () => {
    expect(validateMigrationEnv({ DATABASE_URL: RUNTIME_URL, DIRECT_URL })).toEqual({ ok: true, errors: [] })
  })

  test('rejects a missing DIRECT_URL', () => {
    const result = validateMigrationEnv({ DATABASE_URL: RUNTIME_URL, DIRECT_URL: '' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('DIRECT_URL is not set.')
  })

  test('rejects a non-PostgreSQL DIRECT_URL', () => {
    const result = validateMigrationEnv({ DATABASE_URL: RUNTIME_URL, DIRECT_URL: 'mysql://u:p@db.invalid/app' })
    expect(result.errors).toContain('DIRECT_URL must use the postgresql:// scheme.')
  })

  test('rejects an unparseable DIRECT_URL', () => {
    const result = validateMigrationEnv({ DATABASE_URL: RUNTIME_URL, DIRECT_URL: 'not a url' })
    expect(result.errors).toContain('DIRECT_URL is not a valid URL.')
  })

  test('rejects .env.example placeholders', () => {
    const result = validateMigrationEnv({
      DATABASE_URL: RUNTIME_URL,
      DIRECT_URL: 'postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb',
    })
    expect(result.errors).toContain('DIRECT_URL still contains placeholder values from .env.example.')
  })

  test('rejects a pooled DIRECT_URL', () => {
    const result = validateMigrationEnv({
      DATABASE_URL: RUNTIME_URL,
      DIRECT_URL: `postgresql://migrator:${FAKE_PASSWORD}@ep-fake-pooler.region.example/app`,
    })
    expect(result.errors.some((e) => e.includes('non-pooled'))).toBe(true)
  })

  test('also requires DATABASE_URL', () => {
    const result = validateMigrationEnv({ DATABASE_URL: '', DIRECT_URL })
    expect(result.errors).toContain('DATABASE_URL is not set.')
  })

  test('error messages never contain URL values', () => {
    const result = validateMigrationEnv({
      DATABASE_URL: `mysql://app_user:${FAKE_PASSWORD}@db.invalid/app`,
      DIRECT_URL: `postgresql://migrator:${FAKE_PASSWORD}@ep-fake-pooler.region.example/app`,
    })
    expect(result.ok).toBe(false)
    for (const message of result.errors) {
      expect(message).not.toContain(FAKE_PASSWORD)
      expect(message).not.toContain('db.invalid')
    }
  })
})

describe('check-migration-env CLI', () => {
  const script = path.join(__dirname, '../../scripts/check-migration-env.js')

  // Both variables are always set (possibly to '') so dotenv cannot load real values.
  function runCli(vars) {
    return spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...vars },
      encoding: 'utf8',
    })
  }

  test('exits 1 without printing values when DIRECT_URL is missing', () => {
    const result = runCli({ DATABASE_URL: RUNTIME_URL, DIRECT_URL: '' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('DIRECT_URL is not set.')
    expect(result.stdout + result.stderr).not.toContain(FAKE_PASSWORD)
  })

  test('exits 0 with valid URLs without printing values', () => {
    const result = runCli({ DATABASE_URL: RUNTIME_URL, DIRECT_URL })
    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).not.toContain(FAKE_PASSWORD)
  })
})
