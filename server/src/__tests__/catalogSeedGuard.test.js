const {
  SEED_OPERATIONS,
  SeedRefusedError,
  assertSeedAllowed,
  assertCleanupAllowed,
} = require('../../prisma/seed/env.js')

describe('catalog seed guard (prisma/seed/env.js)', () => {
  const envSnapshot = { ...process.env }

  afterEach(() => {
    process.env.NODE_ENV = envSnapshot.NODE_ENV
    process.env.ALLOW_PRODUCTION_RESET = envSnapshot.ALLOW_PRODUCTION_RESET
  })

  it('exports SEED_OPERATIONS including DESTRUCTIVE', () => {
    expect(SEED_OPERATIONS.DESTRUCTIVE).toBe('destructive')
    expect(Object.keys(SEED_OPERATIONS).sort()).toEqual([
      'DEMO_ACCOUNTS',
      'DESTRUCTIVE',
      'REFERENCE_DATA',
    ])
  })

  it('allows DESTRUCTIVE seed in test and development', () => {
    process.env.NODE_ENV = 'test'
    expect(() =>
      assertSeedAllowed(SEED_OPERATIONS.DESTRUCTIVE, {
        context: 'catalog sample seed (TRUNCATE)',
      }),
    ).not.toThrow()

    process.env.NODE_ENV = 'development'
    expect(() => assertSeedAllowed(SEED_OPERATIONS.DESTRUCTIVE)).not.toThrow()
  })

  it('refuses DESTRUCTIVE seed when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production'
    expect(() =>
      assertSeedAllowed(SEED_OPERATIONS.DESTRUCTIVE, {
        context: 'catalog sample seed (TRUNCATE)',
      }),
    ).toThrow(SeedRefusedError)
    expect(() =>
      assertSeedAllowed(SEED_OPERATIONS.DESTRUCTIVE, {
        context: 'catalog sample seed (TRUNCATE)',
      }),
    ).toThrow(/Refusing catalog sample seed \(TRUNCATE\) when NODE_ENV=production/)
  })

  it('rejects unknown seed operations', () => {
    process.env.NODE_ENV = 'test'
    expect(() => assertSeedAllowed('not-a-real-operation')).toThrow(SeedRefusedError)
    expect(() => assertSeedAllowed('not-a-real-operation')).toThrow(/Unknown seed operation/)
  })

  it('preserves assertCleanupAllowed production block without ALLOW_PRODUCTION_RESET', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ALLOW_PRODUCTION_RESET
    expect(() => assertCleanupAllowed('database cleanup')).toThrow(
      /Production database cleanup is blocked/,
    )
  })
})
