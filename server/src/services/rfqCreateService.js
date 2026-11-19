'use strict'

const { Prisma } = require('@prisma/client')
const crypto = require('crypto')
const { prisma } = require('../config/database.js')
const { AppError } = require('../utils/AppError.js')
const { hasActiveSubscription } = require('../middleware/requireSubscription.js')
const { allocateRfqNumber } = require('./rfqNumberService.js')
const { emitRfqNotification, RFQ_EVENT_TYPES } = require('./rfqNotificationService.js')

const QUOTE_INCLUDE = {
  buyer: true,
  seller: true,
  product: { select: { id: true, name: true, sku: true } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      createdAt: true,
    },
  },
}

function cleanText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, maxLength) : null
}

/**
 * A quotation target must be an active account that can act as a seller.
 * Role SELLER qualifies on its own. A BUYER qualifies only with an active
 * seller subscription, the same plans used by seller workspace access.
 * Every other role, including ADMIN, is never a quotation target.
 */
async function isEligibleSeller(user) {
  if (!user || user.isActive === false) return false
  if (user.role === 'SELLER') return true
  if (user.role !== 'BUYER') return false
  return hasActiveSubscription(user.id, 'SELLER')
}

/** A BOTH account must not send an RFQ to its own seller workspace. */
function assertNotSelfTargeted(buyerId, sellerIds) {
  if (buyerId && sellerIds.includes(buyerId)) {
    throw new AppError('You cannot send an RFQ to your own seller account', 400, 'VALIDATION_ERROR')
  }
}

async function assertEligibleSellers(sellerIds) {
  const users = await prisma.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, role: true, isActive: true },
  })
  const byId = new Map(users.map((user) => [user.id, user]))

  for (const sellerId of sellerIds) {
    if (!(await isEligibleSeller(byId.get(sellerId)))) {
      throw new AppError('One or more sellerIds are invalid', 400, 'VALIDATION_ERROR')
    }
  }
}

async function resolveCreateTargets(body, { buyerId } = {}) {
  if (Array.isArray(body.productEntries) && body.productEntries.length) {
    const productIds = body.productEntries.map((entry) => entry.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, sellerId: true, moq: true, name: true },
    })
    if (products.length !== productIds.length) {
      throw new AppError('One or more product listings are invalid or inactive', 400, 'VALIDATION_ERROR')
    }
    const sellerIds = products.map((product) => product.sellerId)
    assertNotSelfTargeted(buyerId, sellerIds)
    await assertEligibleSellers([...new Set(sellerIds)])
    if (new Set(sellerIds).size !== sellerIds.length) {
      throw new AppError('Duplicate seller in productEntries is not allowed', 400, 'VALIDATION_ERROR')
    }
    return products.map((product) => ({
      productId: product.id,
      sellerId: product.sellerId,
      moq: product.moq,
    }))
  }

  let product = null
  if (body.productId) {
    product = await prisma.product.findUnique({
      where: { id: String(body.productId) },
      select: { id: true, sellerId: true, moq: true, name: true, isActive: true },
    })
    if (!product || !product.isActive) {
      throw new AppError('Product not found', 404, 'NOT_FOUND')
    }
  }

  const sellerIds = []
  if (Array.isArray(body.sellerIds) && body.sellerIds.length) {
    sellerIds.push(...[...new Set(body.sellerIds)])
  } else if (body.sellerId) {
    sellerIds.push(body.sellerId)
  } else if (product?.sellerId) {
    sellerIds.push(product.sellerId)
  }

  if (!sellerIds.length) {
    throw new AppError('At least one seller or product listing is required', 400, 'VALIDATION_ERROR')
  }

  assertNotSelfTargeted(buyerId, sellerIds)
  await assertEligibleSellers(sellerIds)

  return sellerIds.map((sellerId) => ({
    productId: product?.id ?? null,
    sellerId,
    moq: product?.moq ?? 1,
  }))
}

function assertQuantityMeetsMoq(quantity, targets) {
  const highestMoq = targets.reduce((max, target) => Math.max(max, target.moq || 1), 1)
  if (quantity < highestMoq) {
    throw new AppError(`Quantity must be at least MOQ (${highestMoq})`, 400, 'BELOW_MOQ')
  }
}

async function createQuoteRequests({
  buyerId,
  body,
  attachments,
  expectedDeliveryDate,
  targetPrice,
  quantity,
  productTitle,
}) {
  const targets = await resolveCreateTargets(body, { buyerId })
  assertQuantityMeetsMoq(quantity, targets)

  const rfqGroupId = crypto.randomUUID()
  const sharedData = {
    rfqGroupId,
    buyerId,
    catalogProductId: cleanText(body.catalogProductId, 64),
    productTitle,
    productCategory: cleanText(body.productCategory, 200),
    brandName: cleanText(body.brandName, 200),
    quantity,
    targetPrice,
    message: cleanText(body.message, 1000),
    deliveryLocation: cleanText(body.deliveryLocation, 500),
    expectedDeliveryDate,
    attachments,
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const rfqNumber = await allocateRfqNumber(tx)
      await tx.rfqGroup.create({
        data: {
          id: rfqGroupId,
          rfqNumber,
          buyerId,
        },
      })

      const rows = []
      for (const target of targets) {
        const row = await tx.quoteRequest.create({
          data: {
            ...sharedData,
            sellerId: target.sellerId,
            productId: target.productId,
            rfqNumber,
          },
          include: QUOTE_INCLUDE,
        })
        rows.push(row)

        await emitRfqNotification(tx, {
          recipientUserId: target.sellerId,
          eventType: RFQ_EVENT_TYPES.RFQ_RECEIVED,
          quoteRequestId: row.id,
          rfqGroupId,
          payload: {
            rfqNumber,
            productTitle,
            quantity,
          },
        })
      }

      return { rfqGroupId, rfqNumber, rows }
    }, { timeout: 20_000, maxWait: 10_000 })
  } catch (error) {
    if (error?.code === 'P2002') {
      const target = error?.meta?.target || []
      if (target.includes('rfq_number') || target.includes('rfqNumber')) {
        throw new AppError('RFQ number conflict. Please retry.', 409, 'RFQ_NUMBER_CONFLICT')
      }
      throw new AppError('Duplicate seller in the same RFQ group is not allowed.', 409, 'DUPLICATE_SELLER')
    }
    throw error
  }
}

module.exports = {
  createQuoteRequests,
  resolveCreateTargets,
  assertEligibleSellers,
  assertQuantityMeetsMoq,
}
