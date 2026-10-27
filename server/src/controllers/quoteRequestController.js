const { Prisma } = require('@prisma/client')
const { prisma } = require('../config/database.js')
const { asyncHandler } = require('../utils/asyncHandler.js')
const { AppError } = require('../utils/AppError.js')
const { hasActiveSubscription } = require('../middleware/requireSubscription.js')
const { createOrderFromQuote } = require('../services/quoteOrderService.js')
const { createDealFromAcceptedQuote } = require('../services/dealCreationService.js')
const { createQuoteRequests } = require('../services/rfqCreateService.js')
const {
  assertTransition,
  isRevisionTransition,
  defaultQuoteValidUntil,
  assertGroupOpenForSellerAction,
  assertGroupOpenForBuyerAction,
} = require('../services/rfqLifecycleService.js')
const {
  emitRfqNotification,
  emitToMany,
  RFQ_EVENT_TYPES,
  buildNotificationSummary,
} = require('../services/rfqNotificationService.js')
const { recordQuoteRevision, listQuoteRevisions, serializeRevision } = require('../services/quoteRevisionService.js')
const { pickUserCity, mapMaskedParty, USER_PUBLIC_SELECT, buildPartyMetaFromRequest } = require('../services/sellerProfileService.js')
const { serializeCounterpartyUser } = require('../services/counterpartyProfileService.js')
const { serializeOrder } = require('../utils/serialize.js')
const { serializeDeal } = require('../utils/serializeDeal.js')
const {
  displayRfqRef,
  listGroupedFromRows,
  listGroupedFromRegistry,
  buildComparisonGroup,
  computeBuyerStats,
  computeSellerStats,
  filterSellerRows,
  paginate,
  isBuyerQuotationExpired,
} = require('../services/quoteGroupService.js')
const { buildRfqAttachments } = require('../middleware/rfqUpload.js')
const { sanitizeDisplayFilename } = require('../utils/rfqFileValidation.js')
const { serveRfqAttachment } = require('../services/rfqAttachmentStorage.js')

const QUOTE_INCLUDE = {
  buyer: { select: USER_PUBLIC_SELECT },
  seller: { select: USER_PUBLIC_SELECT },
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
  deal: {
    select: {
      id: true,
      dealNumber: true,
      status: true,
      contactUnlockStatus: true,
      payments: {
        select: {
          payerRole: true,
          paymentStatus: true,
        },
      },
    },
  },
}

function cleanText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, maxLength) : null
}

function rfqRef(requestOrId) {
  if (typeof requestOrId === 'string') {
    return `RFQ-${requestOrId.slice(0, 8).toUpperCase()}`
  }
  return displayRfqRef(requestOrId)
}

function parseAttachments(raw) {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  return raw.map((item) => ({
    name: cleanText(item?.name, 255),
    url: cleanText(item?.url, 2000),
    mimeType: cleanText(item?.mimeType, 100),
    sizeBytes: Number.isFinite(Number(item?.sizeBytes)) ? Number(item.sizeBytes) : undefined,
  })).filter((item) => item.name && item.url)
}

async function resolveSellerIds(body, product) {
  const fromArray = Array.isArray(body.sellerIds)
    ? body.sellerIds.map((id) => cleanText(id, 64)).filter(Boolean)
    : []

  if (fromArray.length) {
    return [...new Set(fromArray)]
  }

  const single = cleanText(body.sellerId, 64)
  if (single) return [single]

  if (product?.sellerId) return [product.sellerId]

  return []
}

async function assertSellersExist(sellerIds) {
  const sellers = await prisma.user.findMany({
    where: { id: { in: sellerIds }, role: 'SELLER' },
    select: { id: true },
  })
  if (sellers.length !== sellerIds.length) {
    throw new AppError('One or more sellerIds are invalid', 400, 'VALIDATION_ERROR')
  }
}

const PRE_DEAL_PRIVACY = { dealAccepted: false, dealChargesPaid: false }

function pickQuotePublicFields(request) {
  return {
    id: request.id,
    rfqGroupId: request.rfqGroupId,
    rfqNumber: request.rfqNumber,
    catalogProductId: request.catalogProductId,
    productId: request.productId,
    productTitle: request.productTitle,
    productCategory: request.productCategory,
    brandName: request.brandName,
    quantity: request.quantity,
    targetPrice: request.targetPrice,
    message: request.message,
    status: request.status,
    sellerUnitPrice: request.sellerUnitPrice,
    sellerCurrency: request.sellerCurrency,
    taxNote: request.taxNote,
    quoteValidUntil: request.quoteValidUntil,
    freightNote: request.freightNote,
    exclusionsNote: request.exclusionsNote,
    sellerRespondedAt: request.sellerRespondedAt,
    sellerAcceptedAt: request.sellerAcceptedAt,
    buyerAcceptedAt: request.buyerAcceptedAt,
    buyerRejectedAt: request.buyerRejectedAt,
    buyerCancelledAt: request.buyerCancelledAt,
    revisionCount: request.revisionCount ?? 0,
    orderId: request.orderId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    product: request.product,
    order: request.order,
    deal: request.deal,
  }
}

function withPartyMeta(request) {
  const meta = buildPartyMetaFromRequest(request, PRE_DEAL_PRIVACY)
  return {
    rfqGroupId: meta.rfqGroupId,
    rfqNumber: meta.rfqNumber,
    buyerPortalUserId: meta.buyerPortalUserId,
    buyerCity: meta.buyerCity,
    sellerPortalUserId: meta.sellerPortalUserId,
    sellerCity: meta.sellerCity,
    buyerMarketplaceId: meta.buyerMarketplaceId,
    sellerMarketplaceId: meta.sellerMarketplaceId,
    deliveryLocation: meta.deliveryLocation,
    expectedDeliveryDate: meta.expectedDeliveryDate,
    attachments: meta.attachments ?? [],
  }
}

function sanitizeQuoteRequestForSeller(request, hasFullAccess) {
  const meta = buildPartyMetaFromRequest(request, PRE_DEAL_PRIVACY)
  return {
    ...pickQuotePublicFields(request),
    ...withPartyMeta(request),
    rfqRef: rfqRef(request),
    locked: !hasFullAccess,
    buyer: meta.buyer,
    seller: meta.seller,
  }
}

function sanitizeQuoteRequestForBuyer(request) {
  const meta = buildPartyMetaFromRequest(request, PRE_DEAL_PRIVACY)
  const expired = isBuyerQuotationExpired(request)
  const actionsLocked = expired
    || request.status === 'NOT_SELECTED'
    || request.status === 'ACCEPTED'
    || request.status === 'DECLINED'
    || request.status === 'CANCELLED'

  return {
    ...pickQuotePublicFields(request),
    ...withPartyMeta(request),
    rfqRef: rfqRef(request),
    seller: meta.seller,
    buyer: meta.buyer,
    expired,
    buyerDisplayStatus: request.status === 'NOT_SELECTED' ? 'EXPIRED' : request.status,
    actionsLocked,
  }
}

function maskQuoteRequestSummary(request) {
  return {
    id: request.id,
    rfqGroupId: request.rfqGroupId,
    rfqNumber: request.rfqNumber,
    rfqRef: rfqRef(request),
    status: request.status,
    createdAt: request.createdAt,
    productTitle: request.productTitle,
    productCategory: request.productCategory,
    brandName: request.brandName,
    quantity: request.quantity,
    deliveryLocation: request.deliveryLocation,
    expectedDeliveryDate: request.expectedDeliveryDate,
    ...withPartyMeta(request),
    locked: true,
    buyerHidden: true,
  }
}

function maskQuoteRequestSummaryForBuyer(request) {
  return {
    id: request.id,
    rfqGroupId: request.rfqGroupId,
    rfqNumber: request.rfqNumber,
    rfqRef: rfqRef(request),
    status: request.status,
    createdAt: request.createdAt,
    productTitle: request.productTitle,
    productCategory: request.productCategory,
    brandName: request.brandName,
    quantity: request.quantity,
    deliveryLocation: request.deliveryLocation,
    expectedDeliveryDate: request.expectedDeliveryDate,
    attachments: request.attachments ?? [],
    ...withPartyMeta(request),
    sellerUnitPrice: request.status === 'RESPONDED' || request.status === 'ACCEPTED'
      ? request.sellerUnitPrice
      : null,
    seller: mapMaskedParty(request.seller, 'SELLER', PRE_DEAL_PRIVACY),
  }
}

async function assertSellerCanAccess(requestId, user) {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: requestId },
    include: QUOTE_INCLUDE,
  })

  if (!request) {
    throw new AppError('Quote request not found', 404, 'NOT_FOUND')
  }

  if (user.role !== 'ADMIN' && request.sellerId !== user.id) {
    throw new AppError('You do not have access to this quote request', 403, 'FORBIDDEN')
  }

  return request
}

async function assertBuyerCanAccess(requestId, user) {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: requestId },
    include: QUOTE_INCLUDE,
  })

  if (!request) {
    throw new AppError('Quote request not found', 404, 'NOT_FOUND')
  }

  if (user.role !== 'ADMIN' && request.buyerId !== user.id) {
    throw new AppError('You do not have access to this quote request', 403, 'FORBIDDEN')
  }

  return request
}

async function userHasBuyerWorkspace(user) {
  if (user.role === 'BUYER') return true
  return hasActiveSubscription(user.id, 'BUYER')
}

async function userHasSellerWorkspace(user) {
  if (user.role === 'SELLER') return true
  return hasActiveSubscription(user.id, 'SELLER')
}

async function resolveQuoteListView(user, viewAs) {
  if (user.role === 'ADMIN') {
    return viewAs === 'buyer' ? 'buyer' : 'seller'
  }
  if (viewAs === 'buyer') {
    if (user.role !== 'ADMIN' && !(await userHasBuyerWorkspace(user))) {
      throw new AppError('Buyer workspace access required', 403, 'FORBIDDEN')
    }
    return 'buyer'
  }
  if (viewAs === 'seller') {
    if (user.role !== 'ADMIN' && !(await userHasSellerWorkspace(user))) {
      throw new AppError('Seller workspace access required', 403, 'FORBIDDEN')
    }
    return 'seller'
  }
  if (user.role === 'BUYER') return 'buyer'
  if (user.role === 'SELLER') return 'seller'
  if (await userHasBuyerWorkspace(user)) return 'buyer'
  if (await userHasSellerWorkspace(user)) return 'seller'
  return 'buyer'
}

function attachRevisions(request, revisions) {
  const base = request
  if (!revisions?.length) return base
  return {
    ...base,
    revisions: revisions.map(serializeRevision),
  }
}

const createRequest = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await userHasBuyerWorkspace(req.user))) {
    throw new AppError('Buyer workspace access is required to request quotes.', 403, 'FORBIDDEN')
  }

  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'BUYER'))) {
    throw new AppError(
      'An active Buyer subscription is required to request quotations.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const productTitle = cleanText(req.body.productTitle, 300)
  if (!productTitle) {
    throw new AppError('productTitle is required', 400, 'VALIDATION_ERROR')
  }

  const message = cleanText(req.body.message, 1000)
  if (!message) {
    throw new AppError('message is required', 400, 'VALIDATION_ERROR')
  }

  const quantity = Number.parseInt(req.body.quantity, 10)
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 100000) : 1
  const targetPrice = req.body.targetPrice == null || req.body.targetPrice === ''
    ? null
    : new Prisma.Decimal(String(req.body.targetPrice))
  const deliveryLocation = cleanText(req.body.deliveryLocation, 500)
  if (!deliveryLocation) {
    throw new AppError('deliveryLocation is required', 400, 'VALIDATION_ERROR')
  }

  const expectedDeliveryDate = new Date(req.body.expectedDeliveryDate)

  const attachments = parseAttachments(req.body.attachments)

  if (Array.isArray(req.body.productIds) && req.body.productIds.length > 1) {
    throw new AppError(
      'Multi-product RFQ is not supported yet. This feature belongs to a future release.',
      400,
      'VALIDATION_ERROR',
    )
  }

  const { rfqGroupId, rfqNumber, rows: createdRows } = await createQuoteRequests({
    buyerId: req.user.id,
    body: req.body,
    attachments,
    expectedDeliveryDate,
    targetPrice,
    quantity: safeQuantity,
    productTitle,
  })

  const requests = createdRows.map(sanitizeQuoteRequestForBuyer)

  res.status(201).json({
    success: true,
    data: {
      group: {
        rfqGroupId,
        rfqNumber,
        rfqRef: rfqRef(createdRows[0]),
        requests,
      },
      request: requests[0],
    },
  })
})

const listRequests = asyncHandler(async (req, res) => {
  const view = await resolveQuoteListView(req.user, req.query.viewAs)

  if (view === 'buyer') {
    const requests = await prisma.quoteRequest.findMany({
      where: { buyerId: req.user.id },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const hasFullAccess = req.user.role === 'ADMIN' || await hasActiveSubscription(req.user.id, 'BUYER')

    const visibleRequests = hasFullAccess
      ? requests.map(sanitizeQuoteRequestForBuyer)
      : requests.map(maskQuoteRequestSummaryForBuyer)

    return res.json({
      success: true,
      data: {
        hasFullAccess,
        requests: visibleRequests,
        total: visibleRequests.length,
      },
    })
  }

  const where =
    req.user.role === 'ADMIN'
      ? {}
      : { sellerId: req.user.id }

  const allRows = await prisma.quoteRequest.findMany({
    where,
    include: QUOTE_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })

  const hasFullAccess =
    req.user.role === 'ADMIN' ||
    await hasActiveSubscription(req.user.id, 'SELLER')

  const filtered = filterSellerRows(allRows, req.query)
  const paged = paginate(filtered, req.query.page, req.query.limit)

  const visibleRequests = hasFullAccess
    ? paged.items.map((request) => sanitizeQuoteRequestForSeller(request, true))
    : paged.items.map(maskQuoteRequestSummary)

  res.json({
    success: true,
    data: {
      hasFullAccess,
      requests: visibleRequests,
      pagination: paged.pagination,
      total: paged.pagination.total,
    },
  })
})

const getById = asyncHandler(async (req, res) => {
  const request = await prisma.quoteRequest.findUnique({
    where: { id: req.params.id },
    include: QUOTE_INCLUDE,
  })

  if (!request) {
    throw new AppError('Quote request not found', 404, 'NOT_FOUND')
  }

  const isBuyerParty = request.buyerId === req.user.id
  const isSellerParty = request.sellerId === req.user.id

  if (req.user.role !== 'ADMIN' && !isBuyerParty && !isSellerParty) {
    throw new AppError('You do not have access to this quote request', 403, 'FORBIDDEN')
  }

  if (isBuyerParty) {
    const hasFullAccess =
      req.user.role === 'ADMIN' || await hasActiveSubscription(req.user.id, 'BUYER')
    const revisions = await listQuoteRevisions(prisma, request.id)
    const sanitized = hasFullAccess
      ? attachRevisions(sanitizeQuoteRequestForBuyer(request), revisions)
      : maskQuoteRequestSummaryForBuyer(request)

    return res.json({
      success: true,
      data: {
        hasFullAccess,
        request: sanitized,
      },
    })
  }

  const hasFullAccess =
    req.user.role === 'ADMIN' ||
    await hasActiveSubscription(req.user.id, 'SELLER')
  const revisions = await listQuoteRevisions(prisma, request.id)

  res.json({
    success: true,
    data: {
      hasFullAccess,
      request: attachRevisions(
        sanitizeQuoteRequestForSeller(request, hasFullAccess),
        revisions,
      ),
    },
  })
})

const respond = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'SELLER'))) {
    throw new AppError(
      'An active Seller subscription is required to respond with price.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const existing = await assertSellerCanAccess(req.params.id, req.user)
  const nextStatus = 'RESPONDED'
  assertTransition(existing.status, nextStatus, req.user.role)

  let validUntil = req.body.quoteValidUntil ? new Date(req.body.quoteValidUntil) : defaultQuoteValidUntil()
  if (req.body.quoteValidUntil && Number.isNaN(validUntil.getTime())) {
    throw new AppError('quoteValidUntil must be a valid date', 400, 'VALIDATION_ERROR')
  }

  const quoteFields = {
    sellerUnitPrice: new Prisma.Decimal(String(req.body.sellerUnitPrice)),
    sellerCurrency: req.body.sellerCurrency || 'INR',
    taxNote: cleanText(req.body.taxNote, 500),
    quoteValidUntil: validUntil,
    freightNote: cleanText(req.body.freightNote, 1000),
    exclusionsNote: cleanText(req.body.exclusionsNote, 1000),
  }

  const updated = await prisma.$transaction(async (tx) => {
    await assertGroupOpenForSellerAction(tx, existing)

    const revision = await recordQuoteRevision(tx, existing.id, req.user.id, {
      sellerUnitPrice: quoteFields.sellerUnitPrice,
      sellerCurrency: quoteFields.sellerCurrency,
      taxNote: quoteFields.taxNote,
      quoteValidUntil: quoteFields.quoteValidUntil,
      freightNote: quoteFields.freightNote,
      exclusionsNote: quoteFields.exclusionsNote,
    })

    const row = await tx.quoteRequest.update({
      where: { id: existing.id },
      data: {
        ...quoteFields,
        sellerRespondedAt: new Date(),
        status: nextStatus,
      },
      include: QUOTE_INCLUDE,
    })

    await emitRfqNotification(tx, {
      recipientUserId: existing.buyerId,
      eventType: isRevisionTransition(existing.status, nextStatus)
        ? RFQ_EVENT_TYPES.QUOTE_REVISED
        : RFQ_EVENT_TYPES.QUOTE_RECEIVED,
      quoteRequestId: existing.id,
      rfqGroupId: existing.rfqGroupId,
      payload: {
        rfqNumber: existing.rfqNumber,
        productTitle: existing.productTitle,
        revisionNumber: revision.revisionNumber,
      },
    })

    return row
  }, { timeout: 15_000, maxWait: 10_000 })

  const revisions = await listQuoteRevisions(prisma, updated.id)

  res.json({
    success: true,
    data: {
      request: attachRevisions(sanitizeQuoteRequestForSeller(updated, true), revisions),
    },
  })
})

const sellerReject = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'SELLER'))) {
    throw new AppError(
      'An active Seller subscription is required to decline RFQs.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const existing = await assertSellerCanAccess(req.params.id, req.user)
  assertTransition(existing.status, 'DECLINED', req.user.role)

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.quoteRequest.update({
      where: { id: existing.id },
      data: {
        status: 'DECLINED',
        sellerRespondedAt: new Date(),
      },
      include: QUOTE_INCLUDE,
    })

    await emitRfqNotification(tx, {
      recipientUserId: existing.buyerId,
      eventType: RFQ_EVENT_TYPES.QUOTE_DECLINED,
      quoteRequestId: existing.id,
      rfqGroupId: existing.rfqGroupId,
      payload: {
        rfqNumber: existing.rfqNumber,
        productTitle: existing.productTitle,
      },
    })

    return row
  })

  res.json({
    success: true,
    data: {
      request: sanitizeQuoteRequestForSeller(updated, true),
    },
  })
})

const buyerAccept = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'BUYER'))) {
    throw new AppError(
      'An active Buyer subscription is required to accept quotes.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const existing = await assertBuyerCanAccess(req.params.id, req.user)
  assertTransition(existing.status, 'ACCEPTED', req.user.role)

  if (!existing.sellerUnitPrice) {
    throw new AppError('Seller has not provided a unit price', 400, 'NO_QUOTE_PRICE')
  }

  if (existing.quoteValidUntil && new Date() > new Date(existing.quoteValidUntil)) {
    throw new AppError('This quote has expired', 410, 'QUOTE_EXPIRED')
  }

  const result = await prisma.$transaction(
    async (tx) => {
    const locked = await tx.quoteRequest.findUnique({ where: { id: existing.id } })
    if (!locked || locked.status !== 'RESPONDED') {
      throw new AppError('Quote status changed. Please refresh and try again.', 409, 'CONFLICT')
    }

    if (locked.rfqGroupId) {
      const alreadyAccepted = await tx.quoteRequest.findFirst({
        where: {
          rfqGroupId: locked.rfqGroupId,
          buyerId: locked.buyerId,
          status: 'ACCEPTED',
          id: { not: locked.id },
        },
      })
      if (alreadyAccepted) {
        throw new AppError(
          'Another quotation in this RFQ group is already accepted.',
          409,
          'CONFLICT',
        )
      }
    }

    const order = await createOrderFromQuote(tx, locked, req.user.id)

    const deal = await createDealFromAcceptedQuote(tx, {
      quote: locked,
      orderId: order.id,
      actorUserId: req.user.id,
    })

    const updated = await tx.quoteRequest.update({
      where: { id: locked.id },
      data: {
        status: 'ACCEPTED',
        buyerAcceptedAt: new Date(),
        orderId: order.id,
      },
      include: QUOTE_INCLUDE,
    })

    let notSelectedSiblingCount = 0
    if (locked.rfqGroupId) {
      const notSelected = await tx.quoteRequest.updateMany({
        where: {
          rfqGroupId: locked.rfqGroupId,
          buyerId: locked.buyerId,
          id: { not: locked.id },
          status: { in: ['PENDING', 'RESPONDED'] },
        },
        data: {
          status: 'NOT_SELECTED',
        },
      })
      notSelectedSiblingCount = notSelected.count

      const notSelectedRows = await tx.quoteRequest.findMany({
        where: {
          rfqGroupId: locked.rfqGroupId,
          buyerId: locked.buyerId,
          status: 'NOT_SELECTED',
          id: { not: locked.id },
        },
        select: { id: true, sellerId: true },
      })

      await emitToMany(tx, notSelectedRows.map((row) => row.sellerId), {
        eventType: RFQ_EVENT_TYPES.QUOTE_NOT_SELECTED,
        quoteRequestId: null,
        rfqGroupId: locked.rfqGroupId,
        payload: {
          message: 'Quotation not selected.',
          rfqNumber: locked.rfqNumber,
          productTitle: locked.productTitle,
        },
      })
    }

    await emitRfqNotification(tx, {
      recipientUserId: locked.sellerId,
      eventType: RFQ_EVENT_TYPES.QUOTE_ACCEPTED,
      quoteRequestId: updated.id,
      rfqGroupId: locked.rfqGroupId,
      payload: {
        message: 'Your quotation has been accepted.',
        rfqNumber: locked.rfqNumber,
        productTitle: locked.productTitle,
        orderId: order.id,
        dealId: deal.id,
        dealNumber: deal.dealNumber,
      },
    })

    await emitRfqNotification(tx, {
      recipientUserId: locked.buyerId,
      eventType: RFQ_EVENT_TYPES.BUYER_QUOTATION_ACCEPTED,
      quoteRequestId: updated.id,
      rfqGroupId: locked.rfqGroupId,
      payload: {
        message: 'Quotation accepted successfully.',
        rfqNumber: locked.rfqNumber,
        productTitle: locked.productTitle,
        orderId: order.id,
        dealId: deal.id,
        dealNumber: deal.dealNumber,
      },
    })

    return { order, deal, request: updated, notSelectedSiblingCount }
  }, { timeout: 30_000, maxWait: 15_000 })

  res.json({
    success: true,
    data: {
      request: sanitizeQuoteRequestForBuyer(result.request),
      order: serializeOrder(result.order),
      deal: serializeDeal(result.deal),
      notSelectedSiblingCount: result.notSelectedSiblingCount,
    },
  })
})

const buyerReject = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'BUYER'))) {
    throw new AppError(
      'An active Buyer subscription is required to reject quotes.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const existing = await assertBuyerCanAccess(req.params.id, req.user)
  assertTransition(existing.status, 'DECLINED', req.user.role)

  const updated = await prisma.$transaction(async (tx) => {
    await assertGroupOpenForBuyerAction(tx, existing)

    const row = await tx.quoteRequest.update({
      where: { id: existing.id },
      data: {
        status: 'DECLINED',
        buyerRejectedAt: new Date(),
      },
      include: QUOTE_INCLUDE,
    })

    await emitRfqNotification(tx, {
      recipientUserId: existing.sellerId,
      eventType: RFQ_EVENT_TYPES.QUOTE_REJECTED_BY_BUYER,
      quoteRequestId: existing.id,
      rfqGroupId: existing.rfqGroupId,
      payload: {
        rfqNumber: existing.rfqNumber,
        productTitle: existing.productTitle,
      },
    })

    return row
  })

  res.json({
    success: true,
    data: {
      request: sanitizeQuoteRequestForBuyer(updated),
    },
  })
})

const buyerCancel = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'BUYER'))) {
    throw new AppError(
      'An active Buyer subscription is required to cancel RFQs.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const existing = await assertBuyerCanAccess(req.params.id, req.user)
  assertTransition(existing.status, 'CANCELLED', req.user.role)

  const updated = await prisma.$transaction(async (tx) => {
    await assertGroupOpenForBuyerAction(tx, existing)

    const row = await tx.quoteRequest.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        buyerCancelledAt: new Date(),
      },
      include: QUOTE_INCLUDE,
    })

    if (existing.sellerId) {
      await emitRfqNotification(tx, {
        recipientUserId: existing.sellerId,
        eventType: RFQ_EVENT_TYPES.RFQ_CANCELLED,
        quoteRequestId: existing.id,
        rfqGroupId: existing.rfqGroupId,
        payload: {
          rfqNumber: existing.rfqNumber,
          productTitle: existing.productTitle,
        },
      })
    }

    return row
  })

  res.json({
    success: true,
    data: {
      request: sanitizeQuoteRequestForBuyer(updated),
    },
  })
})

const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit), 10) || 20, 1), 100)
  const since = req.query.since ? new Date(req.query.since) : null
  if (req.query.since && Number.isNaN(since.getTime())) {
    throw new AppError('since must be a valid ISO date', 400, 'VALIDATION_ERROR')
  }

  const where = {
    recipientUserId: req.user.id,
    ...(req.query.unreadOnly ? { readAt: null } : {}),
    ...(since ? { createdAt: { gt: since } } : {}),
  }

  const [events, unreadCount] = await Promise.all([
    prisma.rfqNotificationEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.rfqNotificationEvent.count({
      where: { recipientUserId: req.user.id, readAt: null },
    }),
  ])

  res.json({
    success: true,
    data: {
      notifications: events.map(buildNotificationSummary),
      unreadCount,
    },
  })
})

const markNotificationsRead = asyncHandler(async (req, res) => {
  const now = new Date()
  const where = { recipientUserId: req.user.id, readAt: null }

  if (req.body.markAll) {
    const result = await prisma.rfqNotificationEvent.updateMany({
      where,
      data: { readAt: now },
    })
    return res.json({
      success: true,
      data: { marked: result.count },
    })
  }

  const ids = Array.isArray(req.body.ids) ? req.body.ids : []
  if (!ids.length) {
    throw new AppError('ids or markAll is required', 400, 'VALIDATION_ERROR')
  }

  const result = await prisma.rfqNotificationEvent.updateMany({
    where: { ...where, id: { in: ids } },
    data: { readAt: now },
  })

  res.json({
    success: true,
    data: { marked: result.count },
  })
})

const listConfirmedBuyers = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await hasActiveSubscription(req.user.id, 'SELLER'))) {
    throw new AppError(
      'An active Seller subscription is required to view confirmed buyer details.',
      403,
      'SUBSCRIPTION_REQUIRED',
    )
  }

  const sellerFilter =
    req.user.role === 'ADMIN' ? {} : { sellerId: req.user.id }

  const accepted = await prisma.quoteRequest.findMany({
    where: { ...sellerFilter, status: 'ACCEPTED' },
    include: {
      buyer: { select: USER_PUBLIC_SELECT },
    },
    orderBy: { buyerAcceptedAt: 'desc' },
  })

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const recentRfqs = await prisma.quoteRequest.groupBy({
    by: ['buyerId'],
    where: { ...sellerFilter, createdAt: { gte: ninetyDaysAgo } },
    _count: { id: true },
  })
  const rfqCountByBuyer = new Map(
    recentRfqs.map((row) => [row.buyerId, row._count.id]),
  )

  const byBuyer = new Map()
  for (const request of accepted) {
    const buyerKey = request.buyerId
    const buyerParty = serializeCounterpartyUser(request.buyer, 'BUYER', PRE_DEAL_PRIVACY)
    if (!byBuyer.has(buyerKey)) {
      byBuyer.set(buyerKey, {
        buyerPortalUserId: buyerParty?.portalUserId ?? null,
        buyerMarketplaceId: buyerParty?.portalUserId ?? buyerParty?.marketplaceId ?? null,
        buyerCity: buyerParty?.city ?? null,
        buyer: buyerParty,
        confirmedDeals: 0,
        lastConfirmedAt: null,
        rfqs90d: rfqCountByBuyer.get(buyerKey) ?? 0,
      })
    }

    const row = byBuyer.get(buyerKey)
    row.confirmedDeals += 1
    const confirmedAt = request.buyerAcceptedAt || request.updatedAt
    if (!row.lastConfirmedAt || confirmedAt > row.lastConfirmedAt) {
      row.lastConfirmedAt = confirmedAt
    }
  }

  const buyers = Array.from(byBuyer.values()).sort(
    (a, b) => new Date(b.lastConfirmedAt) - new Date(a.lastConfirmedAt),
  )

  res.json({
    success: true,
    data: {
      buyers,
      total: buyers.length,
    },
  })
})

const listGroupedRequests = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await userHasBuyerWorkspace(req.user))) {
    throw new AppError('Buyer workspace access required', 403, 'FORBIDDEN')
  }

  const buyerFilter = req.user.role === 'ADMIN' ? {} : { buyerId: req.user.id }
  const registry = await prisma.rfqGroup.findMany({
    where: buyerFilter,
    include: {
      requests: {
        include: QUOTE_INCLUDE,
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const hasFullAccess =
    req.user.role === 'ADMIN' || await hasActiveSubscription(req.user.id, 'BUYER')

  const grouped = listGroupedFromRegistry(registry, req.query)

  if (!hasFullAccess) {
    grouped.items = grouped.items.map((group) => ({
      rfqGroupId: group.rfqGroupId,
      rfqNumber: group.rfqNumber,
      rfqRef: group.rfqRef,
      productTitle: group.productTitle,
      quantity: group.quantity,
      aggregateStatus: group.aggregateStatus,
      sellerCount: group.sellerCount,
      createdAt: group.createdAt,
      locked: true,
    }))
  }

  res.json({
    success: true,
    data: {
      hasFullAccess,
      ...grouped,
    },
  })
})

const getGroupComparison = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await userHasBuyerWorkspace(req.user))) {
    throw new AppError('Buyer workspace access required', 403, 'FORBIDDEN')
  }

  const rfqGroupId = req.params.rfqGroupId
  const registry = await prisma.rfqGroup.findFirst({
    where: req.user.role === 'ADMIN'
      ? { id: rfqGroupId }
      : { id: rfqGroupId, buyerId: req.user.id },
    include: {
      requests: {
        include: QUOTE_INCLUDE,
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!registry?.requests?.length) {
    throw new AppError('RFQ group not found', 404, 'NOT_FOUND')
  }

  const hasFullAccess =
    req.user.role === 'ADMIN' || await hasActiveSubscription(req.user.id, 'BUYER')

  const group = buildComparisonGroup(registry.requests)
  if (!hasFullAccess) {
    return res.json({
      success: true,
      data: {
        hasFullAccess: false,
        group: {
          rfqGroupId: group.rfqGroupId,
          rfqNumber: group.rfqNumber,
          productTitle: group.productTitle,
          aggregateStatus: group.aggregateStatus,
          sellerCount: group.sellerCount,
          locked: true,
        },
      },
    })
  }

  res.json({
    success: true,
    data: {
      hasFullAccess: true,
      group,
    },
  })
})

const getStats = asyncHandler(async (req, res) => {
  const view = await resolveQuoteListView(req.user, req.query.viewAs)

  if (view === 'buyer') {
    const rows = await prisma.quoteRequest.findMany({
      where: { buyerId: req.user.id },
      select: {
        id: true,
        rfqGroupId: true,
        status: true,
        quoteValidUntil: true,
      },
    })
    return res.json({
      success: true,
      data: {
        viewAs: 'buyer',
        stats: computeBuyerStats(rows),
      },
    })
  }

  const where =
    req.user.role === 'ADMIN'
      ? {}
      : { sellerId: req.user.id }

  const rows = await prisma.quoteRequest.findMany({
    where,
    select: {
      id: true,
      status: true,
      quoteValidUntil: true,
    },
  })
  res.json({
    success: true,
    data: {
      viewAs: 'seller',
      stats: computeSellerStats(rows),
    },
  })
})

const uploadAttachments = asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN' && !(await userHasBuyerWorkspace(req.user))) {
    throw new AppError('Buyer workspace access required', 403, 'FORBIDDEN')
  }

  const attachments = await buildRfqAttachments(req.files || [])
  res.status(201).json({
    success: true,
    data: { attachments },
  })
})

async function userCanAccessRfqAttachment(user, filename) {
  if (user.role === 'ADMIN') return true

  const match = await prisma.$queryRaw`
    SELECT qr.id
    FROM quote_requests qr
    WHERE (qr.buyer_id = ${user.id} OR qr.seller_id = ${user.id})
      AND qr.attachments::text ILIKE ${`%${filename}%`}
    LIMIT 1
  `

  return Array.isArray(match) && match.length > 0
}

const downloadAttachment = asyncHandler(async (req, res) => {
  const filename = sanitizeDisplayFilename(req.params.filename)
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    throw new AppError('Invalid attachment filename', 400, 'VALIDATION_ERROR')
  }

  const allowed = await userCanAccessRfqAttachment(req.user, filename)
  if (!allowed) {
    throw new AppError('You do not have access to this attachment', 403, 'FORBIDDEN')
  }

  await serveRfqAttachment(filename, res)
})

module.exports = {
  createRequest,
  listRequests,
  listGroupedRequests,
  getGroupComparison,
  getStats,
  uploadAttachments,
  downloadAttachment,
  getById,
  respond,
  sellerReject,
  buyerAccept,
  buyerReject,
  buyerCancel,
  listNotifications,
  markNotificationsRead,
  listConfirmedBuyers,
}
