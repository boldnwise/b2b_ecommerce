/** Shared environment guards for seed / cleanup / reset scripts. */

const SEED_OPERATIONS = Object.freeze({
  DEMO_ACCOUNTS: 'demo-accounts',
  DESTRUCTIVE: 'destructive',
  REFERENCE_DATA: 'reference-data',
})

class SeedRefusedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SeedRefusedError'
    this.code = 'SEED_REFUSED'
  }
}

function isTruthyEnv(name) {
  const value = process.env[name]
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

function shouldResetDatabase() {
  return isTruthyEnv('RESET_DATABASE')
}

/**
 * Throws SeedRefusedError unless `operation` is permitted for the current NODE_ENV.
 * Destructive catalog/demo seeding is refused when NODE_ENV=production.
 */
function assertSeedAllowed(operation, { context } = {}) {
  if (!Object.values(SEED_OPERATIONS).includes(operation)) {
    throw new SeedRefusedError(`Unknown seed operation: ${operation}`)
  }

  if (process.env.NODE_ENV === 'production') {
    const label = context || operation
    throw new SeedRefusedError(
      `Refusing ${label} when NODE_ENV=production. `
      + 'Catalog and demo seeding are development/CI only.',
    )
  }
}

function assertCleanupAllowed(context = 'database cleanup') {
  if (process.env.NODE_ENV === 'production' && !isTruthyEnv('ALLOW_PRODUCTION_RESET')) {
    throw new Error(
      `Production ${context} is blocked. Set ALLOW_PRODUCTION_RESET=true to override (dangerous).`,
    )
  }
}

module.exports = {
  SEED_OPERATIONS,
  SeedRefusedError,
  isTruthyEnv,
  shouldResetDatabase,
  assertSeedAllowed,
  assertCleanupAllowed,
}
