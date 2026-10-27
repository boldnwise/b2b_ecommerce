const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../../.env') })

const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const {
  PASSWORDS,
  ADMIN,
  MANUAL_ONBOARDING_USERS,
  PREMIUM_AUTOMATION_BUYER,
  PREMIUM_AUTOMATION_SELLER,
  PREMIUM_AUTOMATION_USERS,
  PREMIUM_QA_BUYER,
  PREMIUM_QA_SELLER,
  PREMIUM_QA_SELLER_2,
  PREMIUM_QA_SELLER_3,
  PREMIUM_QA_USERS,
  PREMIUM_SUBSCRIPTION_SPECS,
  PLAN_AMOUNTS_PAISE,
  shouldSeedQaUsers,
  shouldSeedE2eProducts,
} = require('./constants.js')
const { runCleanup } = require('./cleanup.js')
const { shouldResetDatabase } = require('./env.js')
const { upsertUsers, upsertAddresses } = require('./users.js')
const { seedMasterCatalog } = require('./catalog.js')
const {
  seedPremiumSubscriptions,
  seedAutomationSellerProducts,
  AUTOMATION_E2E_PRODUCT_COUNT,
} = require('./premium.js')

const prisma = new PrismaClient()

async function countRows() {
  const [
    users,
    addresses,
    subscriptions,
    payments,
    products,
    inventoryLogs,
    orders,
    rfqGroups,
    quoteRequests,
    contactMessages,
    categoryRequests,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.address.count(),
    prisma.subscription.count(),
    prisma.payment.count(),
    prisma.product.count(),
    prisma.inventoryLog.count(),
    prisma.order.count(),
    prisma.rfqGroup.count(),
    prisma.quoteRequest.count(),
    prisma.contactMessage.count(),
    prisma.categoryRequest.count(),
  ])

  let catalog = { top_categories: 0, subcategories: 0, brands: 0, products: 0 }
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM catalog.categories WHERE parent_id IS NULL) AS top_categories,
        (SELECT COUNT(*)::int FROM catalog.categories WHERE parent_id IS NOT NULL) AS subcategories,
        (SELECT COUNT(*)::int FROM catalog.brands) AS brands,
        (SELECT COUNT(*)::int FROM catalog.products) AS products
    `)
    catalog = rows[0] || catalog
  } catch {
    // catalog schema optional until first seed
  }

  return {
    users,
    addresses,
    subscriptions,
    payments,
    products,
    inventoryLogs,
    orders,
    rfqGroups,
    quoteRequests,
    contactMessages,
    categoryRequests,
    catalog,
  }
}

async function refreshUsers(users) {
  const refreshed = await prisma.user.findMany({
    where: { email: { in: Object.keys(users) } },
  })
  for (const u of refreshed) {
    users[u.email] = u
  }
}

function portalUserIdFor(user) {
  return user.portalUserId ?? null
}

async function verifyManualOnboarding(users, checks, { freshReset = false } = {}) {
  for (const spec of MANUAL_ONBOARDING_USERS) {
    const u = users[spec.email]
    checks.push({
      name: `${spec.email} login`,
      ok: Boolean(u && await bcrypt.compare(spec.password, u.passwordHash)),
    })

    if (freshReset) {
      checks.push({
        name: `${spec.email} no portal user ID`,
        ok: !u?.portalUserId,
      })
      const subs = await prisma.subscription.count({
        where: { userId: u?.id, status: 'ACTIVE' },
      })
      checks.push({ name: `${spec.email} no subscription`, ok: subs === 0 })
    }
  }
}

async function verifyPremiumGroup(users, groupSpecs, checks, { expectProducts = false, productCountRange, freshReset = false } = {}) {
  for (const spec of groupSpecs) {
    const u = users[spec.email]
    checks.push({
      name: `${spec.email} login`,
      ok: Boolean(u && await bcrypt.compare(spec.password, u.passwordHash)),
    })
    checks.push({
      name: `${spec.email} portal user ID ${spec.memberId}`,
      ok: portalUserIdFor(u) === spec.memberId,
    })
    checks.push({
      name: `${spec.email} companyName is clean`,
      ok: u?.companyName === spec.companyName,
    })
    const sub = await prisma.subscription.findFirst({
      where: { userId: u?.id, status: 'ACTIVE' },
    })
    checks.push({
      name: `${spec.email} ACTIVE subscription`,
      ok: Boolean(sub),
    })
    const addr = await prisma.address.findFirst({
      where: { userId: u?.id, isDefault: true },
    })
    checks.push({
      name: `${spec.email} city ${spec.address.city}`,
      ok: addr?.city === spec.address.city,
    })

    if (spec.role === 'SELLER' && freshReset) {
      const productCount = await prisma.product.count({ where: { sellerId: u?.id } })
      if (expectProducts && productCountRange) {
        const { min, max } = productCountRange
        const countLabel = min === max ? `${min}` : `${min}–${max}`
        checks.push({
          name: `${spec.email} product count (${countLabel})`,
          ok: productCount >= min && productCount <= max,
        })
      } else {
        checks.push({
          name: `${spec.email} no products`,
          ok: productCount === 0,
        })
      }
    }
  }
}

async function verifyBootstrap(users, { freshReset = false } = {}) {
  const checks = []
  const seedQa = shouldSeedQaUsers()

  const admin = users[ADMIN.email]
  checks.push({
    name: 'Admin login',
    ok: Boolean(admin && await bcrypt.compare(PASSWORDS.admin, admin.passwordHash)),
  })

  await verifyManualOnboarding(users, checks, { freshReset })

  if (seedQa) {
    await verifyPremiumGroup(users, PREMIUM_AUTOMATION_USERS, checks, {
      expectProducts: shouldSeedE2eProducts(),
      productCountRange: {
        min: AUTOMATION_E2E_PRODUCT_COUNT,
        max: AUTOMATION_E2E_PRODUCT_COUNT,
      },
      freshReset,
    })
    await verifyPremiumGroup(users, PREMIUM_QA_USERS, checks, { freshReset })
  }

  const empty = await countRows()

  if (freshReset) {
    checks.push({ name: 'No orders/deals', ok: empty.orders === 0 })
    checks.push({ name: 'No RFQs/quotes', ok: empty.rfqGroups === 0 && empty.quoteRequests === 0 })
    checks.push({ name: 'No catalog browse products', ok: Number(empty.catalog.products) === 0 })

    if (seedQa) {
      checks.push({
        name: 'Premium subscriptions only (6)',
        ok: empty.subscriptions === 6 && empty.payments === 6,
      })
      if (shouldSeedE2eProducts()) {
        const automationSeller = users[PREMIUM_AUTOMATION_SELLER.email]
        const nonAutomationProducts = automationSeller?.id
          ? await prisma.product.count({ where: { sellerId: { not: automationSeller.id } } })
          : -1
        checks.push({
          name: `Automation seller products only (${AUTOMATION_E2E_PRODUCT_COUNT} total)`,
          ok:
            empty.products === AUTOMATION_E2E_PRODUCT_COUNT
            && nonAutomationProducts === 0,
        })
      } else {
        checks.push({
          name: 'No seller products (UAT-clean bootstrap)',
          ok: empty.products === 0,
        })
      }
    } else {
      checks.push({
        name: 'Production: no subscriptions or products',
        ok: empty.subscriptions === 0 && empty.payments === 0 && empty.products === 0,
      })
    }
  } else {
    checks.push({
      name: 'Safe seed: existing business data preserved',
      ok: true,
    })

    if (seedQa) {
      for (const spec of PREMIUM_SUBSCRIPTION_SPECS) {
        const u = users[spec.email]
        const sub = await prisma.subscription.findFirst({
          where: { userId: u?.id, status: 'ACTIVE' },
        })
        checks.push({
          name: `${spec.email} has ACTIVE subscription`,
          ok: Boolean(sub),
        })
      }
    }
  }

  return { checks, counts: empty, seedQa, freshReset }
}

function printReport(legacyRemoved, catalogStats, counts, verification) {
  const { checks, seedQa, freshReset } = verification
  const userTotal = seedQa ? 15 : 9

  console.log('')
  console.log(`=== Bootstrap report (${freshReset ? 'reset + seed' : 'safe seed'}) ===`)
  console.log('')
  console.log(`Users (${userTotal} total):`)
  console.log(`  Admin:                    ${ADMIN.email}`)
  console.log('  MANUAL_ONBOARDING:        buyer1–5@test.com, seller1@test.com, seller4–5@test.com (no subscription, no portal user ID)')
  if (seedQa) {
    console.log(`  PREMIUM_AUTOMATION buyer: ${PREMIUM_AUTOMATION_BUYER.email} (${PREMIUM_AUTOMATION_BUYER.memberId})`)
    console.log(
      `  PREMIUM_AUTOMATION seller:${PREMIUM_AUTOMATION_SELLER.email} (${PREMIUM_AUTOMATION_SELLER.memberId}, ${AUTOMATION_E2E_PRODUCT_COUNT} products)`,
    )
    console.log(`  PREMIUM_QA buyer:         ${PREMIUM_QA_BUYER.email} (${PREMIUM_QA_BUYER.memberId}, fresh account)`)
    console.log(`  PREMIUM_QA seller:        ${PREMIUM_QA_SELLER.email} (${PREMIUM_QA_SELLER.memberId}, fresh account)`)
    console.log(`  PREMIUM_QA seller 2:      ${PREMIUM_QA_SELLER_2.email} (${PREMIUM_QA_SELLER_2.memberId}, fresh account)`)
    console.log(`  PREMIUM_QA seller 3:      ${PREMIUM_QA_SELLER_3.email} (${PREMIUM_QA_SELLER_3.memberId}, fresh account)`)
  } else {
    console.log('  PREMIUM_* groups:         skipped (NODE_ENV=production, set SEED_QA=true to include)')
  }
  console.log('')
  if (legacyRemoved.removed) {
    console.log(`Legacy demo users removed: ${legacyRemoved.emails.join(', ')}`)
  }
  if (legacyRemoved.premiumRemoved) {
    console.log(`Premium QA users removed: ${legacyRemoved.premiumEmails.join(', ')}`)
  }
  console.log('')
  console.log('Row counts:')
  console.log(`  users:              ${counts.users}`)
  console.log(`  addresses:          ${counts.addresses}`)
  console.log(`  subscriptions:      ${counts.subscriptions}`)
  console.log(`  payments:           ${counts.payments}`)
  console.log(`  seller products:    ${counts.products}`)
  console.log(`  orders:             ${counts.orders}`)
  console.log(`  rfq_groups:         ${counts.rfqGroups}`)
  console.log(`  quote_requests:     ${counts.quoteRequests}`)
  console.log(`  catalog categories: ${counts.catalog.top_categories ?? catalogStats.topCategories} top / ${counts.catalog.subcategories ?? catalogStats.subcategories} sub`)
  console.log(`  catalog brands:     ${counts.catalog.brands ?? catalogStats.brands}`)
  console.log('')
  console.log('=== Login credentials ===')
  console.log(`  Admin:              ${ADMIN.email} / ${PASSWORDS.admin}`)
  console.log('  Onboarding flow:    buyer1–5@test.com, seller1@test.com, seller4–5@test.com / Buyer@123, Seller@123')
  if (seedQa) {
    console.log(`  Playwright / CI:    ${PREMIUM_AUTOMATION_BUYER.email} / ${PASSWORDS.buyer}`)
    console.log(`                      ${PREMIUM_AUTOMATION_SELLER.email} / ${PASSWORDS.seller}`)
    console.log(`  Manual QA (fresh):  ${PREMIUM_QA_BUYER.email} / ${PASSWORDS.buyer}`)
    console.log(`                      ${PREMIUM_QA_SELLER.email} / ${PASSWORDS.seller}`)
    console.log(`                      ${PREMIUM_QA_SELLER_2.email} / ${PASSWORDS.seller2}`)
    console.log(`                      ${PREMIUM_QA_SELLER_3.email} / ${PASSWORDS.seller3}`)
  }
  console.log('')
  console.log('Subscription plans (code — server/src/config/subscriptionPlans.js):')
  Object.entries(PLAN_AMOUNTS_PAISE).forEach(([plan, paise]) => {
    console.log(`  ${plan}: ₹${(paise / 100).toLocaleString('en-IN')}`)
  })
  console.log('')
  console.log('Verification:')
  for (const c of checks) {
    console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`)
  }
  console.log('')
  console.log('Notes:')
  if (freshReset) {
    console.log('  • RESET_DATABASE=true — transactional data was purged before seeding')
  } else {
    console.log('  • Safe seed — existing users, products, RFQs, orders, and QA data were preserved')
    console.log('  • To wipe and re-seed: npm run db:reset')
  }
  console.log('  • Portal User IDs live in portal_user_id column (Main Portal is source of truth)')
  console.log('  • MANUAL_ONBOARDING users test subscription purchase and onboarding flows')
  if (seedQa) {
    console.log('  • PREMIUM_AUTOMATION: Playwright/CI with seller catalog, no RFQs/orders')
    console.log('  • PREMIUM_QA: subscribed fresh accounts for daily manual workflow testing')
  }
}

async function main() {
  const seedQa = shouldSeedQaUsers()
  const freshReset = shouldResetDatabase()

  console.log(
    `[bootstrap] ${freshReset ? 'Reset + seed' : 'Safe seed (non-destructive)'}`
    + `${seedQa ? ' + QA testing groups' : ' (QA groups skipped)'}`,
  )

  let legacyRemoved = { removed: 0, emails: [], premiumRemoved: 0, premiumEmails: [] }
  if (freshReset) {
    legacyRemoved = await runCleanup(prisma)
    console.log('[bootstrap] Transactional data purged (RESET_DATABASE=true)')
  } else {
    console.log('[bootstrap] Skipping cleanup — existing business data preserved')
  }

  const users = await upsertUsers(prisma, { preserveExistingState: !freshReset })
  console.log(`[bootstrap] Login accounts upserted (${Object.keys(users).length} users)`)

  await upsertAddresses(prisma, users)
  console.log('[bootstrap] Addresses upserted')

  if (seedQa) {
    await seedPremiumSubscriptions(prisma, users)
    console.log('[bootstrap] Premium subscriptions upserted (automation + QA)')

    if (shouldSeedE2eProducts()) {
      const automationProducts = await seedAutomationSellerProducts(prisma, users)
      console.log(`[bootstrap] Automation seller products upserted (${automationProducts.length})`)
    } else {
      console.log('[bootstrap] Automation seller products skipped (set SEED_E2E_PRODUCTS=true for CI catalog)')
    }

    await refreshUsers(users)
  }

  const catalogStats = await seedMasterCatalog(prisma)
  console.log('[bootstrap] Master catalog taxonomy upserted')

  const verification = await verifyBootstrap(users, { freshReset })
  printReport(legacyRemoved, catalogStats, verification.counts, verification)

  const failed = verification.checks.filter((c) => !c.ok)
  if (failed.length) {
    console.error(`[bootstrap] Verification failed: ${failed.length} check(s)`)
    process.exitCode = 1
  } else {
    console.log(`[bootstrap] Done — idempotent (${freshReset ? 'reset' : 'safe'} seed)`)
  }
}

main()
  .catch((err) => {
    console.error('[bootstrap] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
