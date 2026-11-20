/**
 * Upsert the Playwright catalog listings (E2E-* SKUs) for the PREMIUM_AUTOMATION seller
 * without running the full seed. Same upsert as the CI bootstrap (seedAutomationSellerProducts):
 * keyed on (sellerId, sku), so repeated runs update the same rows. Never deletes anything.
 *
 * Local test databases only. DATABASE_URL must be set in the shell (server/.env is not
 * used), point at localhost, and name a database containing "test".
 *
 * Usage: npm run db:seed:e2e-products
 */
const path = require('path')

const explicitDatabaseUrl = process.env.DATABASE_URL
require('dotenv').config({ path: path.join(__dirname, '../../.env') })

const { PrismaClient } = require('@prisma/client')
const { PREMIUM_AUTOMATION_SELLER, shouldSeedQaUsers } = require('./constants.js')
const { SEED_OPERATIONS, assertSeedAllowed } = require('./env.js')
const { seedAutomationSellerProducts, AUTOMATION_E2E_PRODUCT_COUNT } = require('./premium.js')

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const SELLER_PLAN_PREFIXES = ['SELLER_', 'BOTH_']

function assertLocalTestDatabase(value) {
  if (!value) {
    throw new Error('Set DATABASE_URL in this shell to the local test database. server/.env is not used.')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.')
  }
  const database = url.pathname.replace(/^\//, '')
  if (!LOCAL_DB_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      `Refusing host "${url.hostname}", database "${database}". `
        + 'E2E products are only upserted into a local database whose name contains "test".',
    )
  }
}

async function findAutomationSeller(prisma) {
  const seller = await prisma.user.findUnique({ where: { email: PREMIUM_AUTOMATION_SELLER.email } })
  const missing = []
  if (!seller) missing.push('account')
  if (seller && seller.role !== 'SELLER') missing.push('SELLER role')
  if (seller && seller.portalUserId !== PREMIUM_AUTOMATION_SELLER.memberId) {
    missing.push(`portal user ID ${PREMIUM_AUTOMATION_SELLER.memberId}`)
  }
  if (seller) {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: seller.id, status: 'ACTIVE' },
      select: { plan: true },
    })
    if (!subscriptions.some((s) => SELLER_PLAN_PREFIXES.some((prefix) => s.plan.startsWith(prefix)))) {
      missing.push('ACTIVE seller subscription')
    }
  }
  if (missing.length) {
    throw new Error(
      `${PREMIUM_AUTOMATION_SELLER.email} is missing: ${missing.join(', ')}. `
        + 'Run the safe seed first (npm run db:seed).',
    )
  }
  return seller
}

async function main() {
  assertSeedAllowed(SEED_OPERATIONS.DEMO_ACCOUNTS, { context: 'E2E product upsert' })
  assertLocalTestDatabase(explicitDatabaseUrl)
  if (!shouldSeedQaUsers()) {
    throw new Error('QA seed groups are disabled in this environment.')
  }

  const prisma = new PrismaClient()
  try {
    const seller = await findAutomationSeller(prisma)
    const products = await seedAutomationSellerProducts(prisma, {
      [PREMIUM_AUTOMATION_SELLER.email]: seller,
    })

    const listed = await prisma.product.count({
      where: { sellerId: seller.id, isActive: true, sku: { startsWith: 'E2E-' } },
    })
    console.log(`[e2e-products] Upserted ${products.length} products for ${seller.email} (${seller.portalUserId})`)
    console.log(`[e2e-products] Active E2E-* listings for this seller: ${listed}`)
    if (listed < AUTOMATION_E2E_PRODUCT_COUNT) {
      throw new Error(`Expected ${AUTOMATION_E2E_PRODUCT_COUNT} active E2E listings, found ${listed}.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('[e2e-products] failed:', err.message)
  process.exitCode = 1
})
