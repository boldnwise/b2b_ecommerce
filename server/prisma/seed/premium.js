const {
  CATALOG,
  PREMIUM_AUTOMATION_SELLER,
  PREMIUM_SUBSCRIPTION_SPECS,
  PLAN_AMOUNTS_PAISE,
  shouldSeedQaUsers,
} = require('./constants.js')
const { money, buildProductImages, buildDescription } = require('./helpers.js')

const SUBSCRIPTION_ACTIVATED_AT = new Date('2026-01-01T00:00:00.000Z')

async function syncSubscriptionIdentity(prisma, userId, spec, plan) {
  const subscriptionData =
    spec.role === 'BUYER'
      ? {
          buyerSubscriptionStatus: 'ACTIVE',
          buyerSubscriptionPlan: plan,
          buyerSubscriptionActivatedAt: SUBSCRIPTION_ACTIVATED_AT,
        }
      : {
          sellerSubscriptionStatus: 'ACTIVE',
          sellerSubscriptionPlan: plan,
          sellerSubscriptionActivatedAt: SUBSCRIPTION_ACTIVATED_AT,
        }

  await prisma.user.update({
    where: { id: userId },
    data: {
      portalUserId: spec.memberId,
      ...subscriptionData,
    },
  })
}

async function upsertPremiumSubscription(prisma, userId, spec, userSpec) {
  let subscription = await prisma.subscription.findFirst({
    where: { userId, plan: spec.plan, status: 'ACTIVE' },
  })

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        userId,
        plan: spec.plan,
        status: 'ACTIVE',
        expiresAt: null,
      },
    })
  } else {
    subscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', expiresAt: null },
    })
  }

  const amountPaise = PLAN_AMOUNTS_PAISE[spec.plan] || 999900
  await prisma.payment.upsert({
    where: { razorpayOrderId: spec.paymentKey },
    update: {
      userId,
      subscriptionId: subscription.id,
      plan: spec.plan,
      amountPaise,
      status: 'PAID',
      razorpayPaymentId: `${spec.paymentKey}_pay`,
      razorpaySignature: `${spec.paymentKey}_sig`,
    },
    create: {
      userId,
      subscriptionId: subscription.id,
      razorpayOrderId: spec.paymentKey,
      razorpayPaymentId: `${spec.paymentKey}_pay`,
      razorpaySignature: `${spec.paymentKey}_sig`,
      plan: spec.plan,
      amountPaise,
      status: 'PAID',
    },
  })

  await syncSubscriptionIdentity(prisma, userId, userSpec, spec.plan)
  return subscription
}

async function seedPremiumSubscriptions(prisma, users) {
  if (!shouldSeedQaUsers()) return []

  const { PREMIUM_USERS } = require('./constants.js')
  const results = []
  for (const spec of PREMIUM_SUBSCRIPTION_SPECS) {
    const user = users[spec.email]
    const userSpec = PREMIUM_USERS.find((u) => u.email === spec.email)
    if (!user || !userSpec) continue
    results.push(await upsertPremiumSubscription(prisma, user.id, spec, userSpec))
  }
  return results
}

/** 20 seller listings — automation seller only, upserted after each bootstrap purge */
function buildAutomationProductSpecs(sellerId) {
  const picks = [
    // Electronics / Mobiles
    { cat: CATALOG[0], sub: 'Smartphones', brand: 'Samsung', noun: 'Galaxy S24 5G', sku: 'E2E-MOB-001', price: 74990, moq: 5, uom: 'PCS' },
    { cat: CATALOG[0], sub: 'Smartphones', brand: 'Apple', noun: 'iPhone 15 Pro', sku: 'E2E-MOB-002', price: 119900, moq: 2, uom: 'PCS' },
    { cat: CATALOG[0], sub: 'Power Banks', brand: 'Samsung', noun: 'Fast Charging Power Bank', sku: 'E2E-MOB-003', price: 2990, moq: 10, uom: 'PCS' },
    { cat: CATALOG[0], sub: 'Smartphones', brand: 'Apple', noun: 'iPhone 14 Pro', sku: 'E2E-MOB-004', price: 99900, moq: 2, uom: 'PCS' },
    
    // Computers / Laptops
    { cat: CATALOG[1], sub: 'Laptops', brand: 'Dell', noun: 'XPS 13 Laptop', sku: 'E2E-CMP-001', price: 89990, moq: 2, uom: 'PCS' },
    { cat: CATALOG[1], sub: 'Laptops', brand: 'Apple', noun: 'MacBook Air M3', sku: 'E2E-CMP-002', price: 114900, moq: 2, uom: 'PCS' },
    { cat: CATALOG[1], sub: 'Monitors', brand: 'Dell', noun: '27-inch 4K Monitor', sku: 'E2E-CMP-003', price: 24990, moq: 5, uom: 'PCS' },
    { cat: CATALOG[1], sub: 'Laptops', brand: 'Apple', noun: 'MacBook Pro M3', sku: 'E2E-CMP-004', price: 169900, moq: 1, uom: 'PCS' },
    
    // Home & Kitchen
    { cat: CATALOG[5], sub: 'Cookware & Dining', brand: 'Prestige', noun: 'Non-stick Cookware Set', sku: 'E2E-HOM-001', price: 3490, moq: 8, uom: 'SET' },
    { cat: CATALOG[5], sub: 'Cookware & Dining', brand: 'Prestige', noun: 'Pressure Cooker 5L', sku: 'E2E-HOM-002', price: 2190, moq: 10, uom: 'PCS' },
    { cat: CATALOG[5], sub: 'Cookware & Dining', brand: 'Prestige', noun: 'Induction Cooktop', sku: 'E2E-HOM-003', price: 2890, moq: 5, uom: 'PCS' },
    { cat: CATALOG[5], sub: 'Cookware & Dining', brand: 'Prestige', noun: 'Electric Kettle 1.5L', sku: 'E2E-HOM-004', price: 1290, moq: 15, uom: 'PCS' },
    
    // Sports & Fitness
    { cat: CATALOG[6], sub: 'Fitness Equipment', brand: 'Nike', noun: 'Training Dumbbells Pair', sku: 'E2E-SPT-001', price: 4990, moq: 6, uom: 'PAIR' },
    { cat: CATALOG[6], sub: 'Fitness Equipment', brand: 'Nike', noun: 'Resistance Bands Set', sku: 'E2E-SPT-002', price: 1290, moq: 12, uom: 'SET' },
    { cat: CATALOG[6], sub: 'Fitness Equipment', brand: 'Nike', noun: 'Sports Gym Bag', sku: 'E2E-SPT-003', price: 1990, moq: 8, uom: 'PCS' },
    { cat: CATALOG[6], sub: 'Fitness Equipment', brand: 'Nike', noun: 'Exercise Yoga Mat', sku: 'E2E-SPT-004', price: 1490, moq: 10, uom: 'PCS' },
    
    // Industrial Supplies
    { cat: CATALOG[9], sub: 'Industrial Supplies', brand: 'Bosch', noun: 'Cordless Drill Driver', sku: 'E2E-IND-001', price: 5490, moq: 5, uom: 'PCS' },
    { cat: CATALOG[9], sub: 'Industrial Supplies', brand: 'Bosch', noun: 'Angle Grinder 4-inch', sku: 'E2E-IND-002', price: 2990, moq: 8, uom: 'PCS' },
    { cat: CATALOG[9], sub: 'Industrial Supplies', brand: 'Bosch', noun: 'Screwdriver Bits Set 46pc', sku: 'E2E-IND-003', price: 1190, moq: 15, uom: 'SET' },
    { cat: CATALOG[9], sub: 'Industrial Supplies', brand: 'Bosch', noun: 'Cutting Wheel 10-pack', sku: 'E2E-IND-004', price: 890, moq: 25, uom: 'PACK' },
  ]

  return picks.map((p, index) => ({
    sellerId,
    sku: p.sku,
    name: `${p.brand} ${p.noun} — ${p.sub}`,
    description: buildDescription(p.cat.name, p.sub, p.brand, p.noun),
    price: p.price,
    moq: p.moq,
    uom: p.uom,
    currency: 'INR',
    isActive: true,
    trackInventory: true,
    stockQty: 100 + index * 15,
    images: buildProductImages(`e2e-${p.sku.toLowerCase()}`, `${p.sku}.jpg`),
  }))
}

async function upsertAutomationProduct(prisma, spec) {
  const product = await prisma.product.upsert({
    where: {
      sellerId_sku: { sellerId: spec.sellerId, sku: spec.sku },
    },
    update: {
      name: spec.name,
      description: spec.description,
      price: money(spec.price),
      moq: spec.moq,
      uom: spec.uom,
      currency: spec.currency,
      isActive: spec.isActive,
      trackInventory: spec.trackInventory,
      stockQty: spec.stockQty,
      images: spec.images,
    },
    create: {
      sellerId: spec.sellerId,
      sku: spec.sku,
      name: spec.name,
      description: spec.description,
      price: money(spec.price),
      moq: spec.moq,
      uom: spec.uom,
      currency: spec.currency,
      isActive: spec.isActive,
      trackInventory: spec.trackInventory,
      stockQty: spec.stockQty,
      reservedQty: 0,
      images: spec.images,
    },
  })

  const existingLog = await prisma.inventoryLog.findFirst({
    where: {
      productId: product.id,
      reason: 'RESTOCK',
      note: 'Automation bootstrap opening stock',
    },
  })

  if (!existingLog && product.trackInventory && product.stockQty > 0) {
    await prisma.inventoryLog.create({
      data: {
        productId: product.id,
        delta: product.stockQty,
        reason: 'RESTOCK',
        performedBy: product.sellerId,
        note: 'Automation bootstrap opening stock',
      },
    })
  }

  return product
}

async function seedAutomationSellerProducts(prisma, users) {
  if (!shouldSeedQaUsers()) return []

  const seller = users[PREMIUM_AUTOMATION_SELLER.email]
  if (!seller) return []

  const specs = buildAutomationProductSpecs(seller.id)
  const products = []
  for (const spec of specs) {
    products.push(await upsertAutomationProduct(prisma, spec))
  }
  return products
}

/** Derived from buildAutomationProductSpecs — keep verification in sync with seed SKUs */
const AUTOMATION_E2E_PRODUCT_COUNT = buildAutomationProductSpecs('').length

module.exports = {
  seedPremiumSubscriptions,
  seedAutomationSellerProducts,
  buildAutomationProductSpecs,
  AUTOMATION_E2E_PRODUCT_COUNT,
  upsertPremiumSubscription,
  syncSubscriptionIdentity,
}
