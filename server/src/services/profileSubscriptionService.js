'use strict'

/**
 * Marketplace-owned subscription data for the profile page.
 * Subscriptions MUST always come from marketplace DB — never from Main Portal.
 */

const { prisma } = require('../config/database.js')
const { USER_SELECT } = require('../utils/serializeUser.js')
const { BUYER_ENTITLEMENT_PLANS, SELLER_ENTITLEMENT_PLANS } = require('./subscriptionSyncService.js')

function formatPlanLabel(plan) {
  if (!plan) return null
  return String(plan).replace(/_/g, ' ')
}

function formatDisplayDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function pickLatestSubscription(subscriptions, planSet) {
  return subscriptions.find((sub) => planSet.has(sub.plan)) ?? null
}

function buildSubscriptionCard(subscription, fallbackPlan, fallbackStatus) {
  const plan = subscription?.plan ?? fallbackPlan ?? null
  let status = subscription?.status ?? fallbackStatus ?? null
  const now = new Date()

  // Align with requireSubscription / buildSubscriptionSummary — future start is not active.
  if (subscription?.startsAt && new Date(subscription.startsAt) > now) {
    status = null
  } else if (subscription?.expiresAt && new Date(subscription.expiresAt) <= now) {
    status = 'EXPIRED'
  }

  if (!plan && !status) return null

  const expiryDate = subscription?.expiresAt
    ? formatDisplayDate(subscription.expiresAt)
    : (plan ? 'Lifetime' : null)

  return {
    plan: formatPlanLabel(plan),
    status,
    startDate: formatDisplayDate(subscription?.startsAt),
    expiryDate,
  }
}

async function fetchUserSubscriptions(userId) {
  return prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      plan: true,
      status: true,
      startsAt: true,
      expiresAt: true,
    },
  })
}

/**
 * @param {string} userId
 * @returns {Promise<{ buyer: object|null, seller: object|null }>}
 */
async function fetchMarketplaceSubscriptions(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  })
  if (!user) return { buyer: null, seller: null }

  const subscriptions = await fetchUserSubscriptions(userId)
  const buyerSub = pickLatestSubscription(subscriptions, BUYER_ENTITLEMENT_PLANS)
  const sellerSub = pickLatestSubscription(subscriptions, SELLER_ENTITLEMENT_PLANS)

  return {
    buyer: buildSubscriptionCard(
      buyerSub,
      user.buyerSubscriptionPlan,
      user.buyerSubscriptionStatus,
    ),
    seller: buildSubscriptionCard(
      sellerSub,
      user.sellerSubscriptionPlan,
      user.sellerSubscriptionStatus,
    ),
  }
}

module.exports = {
  fetchMarketplaceSubscriptions,
  fetchUserSubscriptions,
  buildSubscriptionCard,
  formatPlanLabel,
  formatDisplayDate,
}
