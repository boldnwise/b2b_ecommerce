'use strict'

jest.mock('../config/database')

const { prisma } = require('../config/database')
const { resolveCreateTargets, createQuoteRequests } = require('../services/rfqCreateService')

const SELLER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BUYER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOTH_ID = '44444444-4444-4444-8444-444444444444'
const INACTIVE_ID = '55555555-5555-4555-8555-555555555555'
const MISSING_ID = '66666666-6666-4666-8666-666666666666'
const ADMIN_ID = '77777777-7777-4777-8777-777777777777'
const OWNER_ID = '88888888-8888-4888-8888-888888888888'
const PRODUCT_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PRODUCT_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function installAccounts(users, subscriptions) {
  prisma.user.findMany.mockImplementation(async ({ where }) => {
    const ids = where?.id?.in || []
    return users.filter((user) => ids.includes(user.id))
  })
  prisma.user.findUnique.mockImplementation(async ({ where }) => (
    users.find((user) => user.id === where.id) || null
  ))
  prisma.subscription.findFirst.mockImplementation(async ({ where }) => {
    const plans = where?.plan?.in || []
    const match = subscriptions.find((sub) => (
      sub.userId === where.userId
      && sub.status === 'ACTIVE'
      && plans.includes(sub.plan)
      && (sub.expiresAt == null || sub.expiresAt > new Date())
    ))
    return match || null
  })
}

function installProducts(products) {
  prisma.product.findMany.mockImplementation(async ({ where }) => {
    const ids = where?.id?.in || []
    return products.filter((product) => ids.includes(product.id) && product.isActive !== false)
  })
}

describe('RFQ seller eligibility', () => {
  test('accepts an active user whose role is SELLER', async () => {
    installAccounts(
      [{ id: SELLER_ID, role: 'SELLER', isActive: true }],
      [],
    )

    const targets = await resolveCreateTargets({ sellerIds: [SELLER_ID] })

    expect(targets).toEqual([
      { productId: null, sellerId: SELLER_ID, moq: 1 },
    ])
  })

  test('accepts an active BUYER with an active SELLER subscription', async () => {
    installAccounts(
      [{ id: BOTH_ID, role: 'BUYER', isActive: true }],
      [{ userId: BOTH_ID, plan: 'SELLER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )

    const targets = await resolveCreateTargets({ sellerIds: [BOTH_ID] })

    expect(targets.map((target) => target.sellerId)).toEqual([BOTH_ID])
  })

  test('rejects an active BUYER without a SELLER subscription', async () => {
    installAccounts(
      [{ id: BUYER_ID, role: 'BUYER', isActive: true }],
      [{ userId: BUYER_ID, plan: 'BUYER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )

    await expect(resolveCreateTargets({ sellerIds: [BUYER_ID] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'One or more sellerIds are invalid',
    })
  })

  test('rejects an inactive user even with a SELLER subscription', async () => {
    installAccounts(
      [{ id: INACTIVE_ID, role: 'BUYER', isActive: false }],
      [{ userId: INACTIVE_ID, plan: 'SELLER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )

    await expect(resolveCreateTargets({ sellerIds: [INACTIVE_ID] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  })

  test('rejects a seller id that does not match a user', async () => {
    installAccounts([], [])

    await expect(resolveCreateTargets({ sellerIds: [MISSING_ID] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  })

  test('rejects an active ADMIN as a quotation target', async () => {
    installAccounts(
      [{ id: ADMIN_ID, role: 'ADMIN', isActive: true }],
      [{ userId: ADMIN_ID, plan: 'SELLER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )

    await expect(resolveCreateTargets({ sellerIds: [ADMIN_ID] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'One or more sellerIds are invalid',
    })
  })

  test('rejects an OWNER role as a quotation target', async () => {
    installAccounts(
      [{ id: OWNER_ID, role: 'OWNER', isActive: true }],
      [{ userId: OWNER_ID, plan: 'SELLER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )

    await expect(resolveCreateTargets({ sellerIds: [OWNER_ID] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'One or more sellerIds are invalid',
    })
  })
})

describe('RFQ self-quotation', () => {
  const bothAccount = { id: BOTH_ID, role: 'BUYER', isActive: true }
  const bothSellerSubscription = {
    userId: BOTH_ID,
    plan: 'BOTH_MONTHLY',
    status: 'ACTIVE',
    expiresAt: null,
  }

  beforeEach(() => {
    installAccounts([bothAccount, { id: SELLER_ID, role: 'SELLER', isActive: true }], [bothSellerSubscription])
  })

  test('rejects a BOTH account that lists itself in sellerIds', async () => {
    await expect(resolveCreateTargets(
      { sellerIds: [SELLER_ID, BOTH_ID] },
      { buyerId: BOTH_ID },
    )).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'You cannot send an RFQ to your own seller account',
    })
  })

  test('rejects a BOTH account requesting a quote on its own listing', async () => {
    installProducts([{ id: PRODUCT_A, sellerId: BOTH_ID, moq: 1, isActive: true }])

    await expect(resolveCreateTargets(
      { productEntries: [{ productId: PRODUCT_A }] },
      { buyerId: BOTH_ID },
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' })
  })

  test('rejects a BOTH account using its own productId', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: PRODUCT_A, sellerId: BOTH_ID, moq: 1, name: 'Own listing', isActive: true,
    })

    await expect(resolveCreateTargets(
      { productId: PRODUCT_A },
      { buyerId: BOTH_ID },
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' })
  })

  test('createQuoteRequests never writes a self-targeted RFQ', async () => {
    await expect(createQuoteRequests({
      buyerId: BOTH_ID,
      body: { sellerIds: [BOTH_ID] },
      attachments: [],
      expectedDeliveryDate: new Date(),
      targetPrice: null,
      quantity: 1,
      productTitle: 'Self RFQ',
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  test('still lets a BOTH account send an RFQ to another seller', async () => {
    const targets = await resolveCreateTargets({ sellerIds: [SELLER_ID] }, { buyerId: BOTH_ID })

    expect(targets.map((target) => target.sellerId)).toEqual([SELLER_ID])
  })

  test('still lets another buyer target the BOTH account as a seller', async () => {
    const targets = await resolveCreateTargets({ sellerIds: [BOTH_ID] }, { buyerId: BUYER_ID })

    expect(targets.map((target) => target.sellerId)).toEqual([BOTH_ID])
  })
})

describe('RFQ productEntries seller eligibility', () => {
  const sellerSubscription = {
    userId: BOTH_ID,
    plan: 'SELLER_MONTHLY',
    status: 'ACTIVE',
    expiresAt: null,
  }

  test('accepts multiple listings owned by different eligible sellers', async () => {
    installAccounts(
      [
        { id: SELLER_ID, role: 'SELLER', isActive: true },
        { id: BOTH_ID, role: 'BUYER', isActive: true },
      ],
      [sellerSubscription],
    )
    installProducts([
      { id: PRODUCT_A, sellerId: SELLER_ID, moq: 2, isActive: true },
      { id: PRODUCT_B, sellerId: BOTH_ID, moq: 4, isActive: true },
    ])

    const targets = await resolveCreateTargets({
      productEntries: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }],
    })

    expect(targets).toEqual([
      { productId: PRODUCT_A, sellerId: SELLER_ID, moq: 2 },
      { productId: PRODUCT_B, sellerId: BOTH_ID, moq: 4 },
    ])
    expect(prisma.quoteRequest.create).not.toHaveBeenCalled()
  })

  test('rejects a listing set that includes a buyer-only owner', async () => {
    installAccounts(
      [
        { id: SELLER_ID, role: 'SELLER', isActive: true },
        { id: BUYER_ID, role: 'BUYER', isActive: true },
      ],
      [{ userId: BUYER_ID, plan: 'BUYER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )
    installProducts([
      { id: PRODUCT_A, sellerId: SELLER_ID, moq: 1, isActive: true },
      { id: PRODUCT_B, sellerId: BUYER_ID, moq: 1, isActive: true },
    ])

    await expect(resolveCreateTargets({
      productEntries: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'One or more sellerIds are invalid',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  test('rejects a listing owned by an inactive seller', async () => {
    installAccounts(
      [{ id: INACTIVE_ID, role: 'SELLER', isActive: false }],
      [{ userId: INACTIVE_ID, plan: 'SELLER_MONTHLY', status: 'ACTIVE', expiresAt: null }],
    )
    installProducts([
      { id: PRODUCT_A, sellerId: INACTIVE_ID, moq: 1, isActive: true },
    ])

    await expect(resolveCreateTargets({
      productEntries: [{ productId: PRODUCT_A }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'One or more sellerIds are invalid',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  test('validates a repeated eligible seller before applying the one-seller rule', async () => {
    installAccounts(
      [{ id: BOTH_ID, role: 'BUYER', isActive: true }],
      [sellerSubscription],
    )
    installProducts([
      { id: PRODUCT_A, sellerId: BOTH_ID, moq: 1, isActive: true },
      { id: PRODUCT_B, sellerId: BOTH_ID, moq: 3, isActive: true },
    ])

    await expect(resolveCreateTargets({
      productEntries: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }],
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Duplicate seller in productEntries is not allowed',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
