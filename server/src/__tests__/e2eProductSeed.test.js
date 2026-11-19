'use strict'

const { PREMIUM_AUTOMATION_SELLER } = require('../../prisma/seed/constants.js')
const {
  seedAutomationSellerProducts,
  AUTOMATION_E2E_PRODUCT_COUNT,
} = require('../../prisma/seed/premium.js')

/** In-memory stand-in for the Product and InventoryLog tables used by the upsert. */
function fakePrisma() {
  const products = new Map()
  const logs = []
  let nextId = 1
  const deleteSpy = jest.fn()

  return {
    products,
    logs,
    deleteSpy,
    product: {
      upsert: jest.fn(async ({ where, update, create }) => {
        const key = `${where.sellerId_sku.sellerId}:${where.sellerId_sku.sku}`
        const existing = products.get(key)
        const row = existing
          ? { ...existing, ...update }
          : { id: `p${nextId++}`, ...create }
        products.set(key, row)
        return row
      }),
      deleteMany: deleteSpy,
      delete: deleteSpy,
    },
    inventoryLog: {
      findFirst: jest.fn(async ({ where }) =>
        logs.find((log) => log.productId === where.productId && log.reason === where.reason && log.note === where.note) || null),
      create: jest.fn(async ({ data }) => {
        logs.push(data)
        return data
      }),
      deleteMany: deleteSpy,
    },
  }
}

describe('E2E automation seller products (prisma/seed/premium.js)', () => {
  const seller = { id: 'seller-uuid', email: PREMIUM_AUTOMATION_SELLER.email }
  const users = { [PREMIUM_AUTOMATION_SELLER.email]: seller }

  test('creates active, owned listings and is idempotent across runs', async () => {
    const prisma = fakePrisma()

    const first = await seedAutomationSellerProducts(prisma, users)
    const second = await seedAutomationSellerProducts(prisma, users)

    expect(first).toHaveLength(AUTOMATION_E2E_PRODUCT_COUNT)
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id))
    expect(prisma.products.size).toBe(AUTOMATION_E2E_PRODUCT_COUNT)
    expect(prisma.logs).toHaveLength(AUTOMATION_E2E_PRODUCT_COUNT)
    expect(prisma.deleteSpy).not.toHaveBeenCalled()

    for (const product of prisma.products.values()) {
      expect(product.sellerId).toBe(seller.id)
      expect(product.isActive).toBe(true)
      expect(product.sku).toMatch(/^E2E-/)
      expect(product.name).toBeTruthy()
      expect(product.moq).toBeGreaterThanOrEqual(1)
    }
  })

  test('does nothing when the automation seller does not exist', async () => {
    const prisma = fakePrisma()

    await expect(seedAutomationSellerProducts(prisma, {})).resolves.toEqual([])
    expect(prisma.product.upsert).not.toHaveBeenCalled()
  })
})
