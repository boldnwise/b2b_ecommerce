'use strict'

const BUYER_PLANS = new Set(['BUYER_MONTHLY', 'BUYER_ANNUAL', 'BUYER_LIFETIME', 'BUYER_STANDARD'])
const SELLER_PLANS = new Set(['SELLER_MONTHLY', 'SELLER_ANNUAL', 'SELLER_LIFETIME', 'SELLER_MONTH'])
const BUNDLE_PLANS = ['BOTH_MONTHLY', 'BOTH_ANNUAL', 'BOTH_LIFETIME']

/** Plans that grant each workspace. A single BOTH_* row grants both, matching requireSubscription. */
const BUYER_ENTITLEMENT_PLANS = new Set([...BUYER_PLANS, ...BUNDLE_PLANS])
const SELLER_ENTITLEMENT_PLANS = new Set([...SELLER_PLANS, ...BUNDLE_PLANS])

function workspaceForPlan(plan) {
  if (BUYER_PLANS.has(plan)) return 'BUYER'
  if (SELLER_PLANS.has(plan)) return 'SELLER'
  return null
}

function subscriptionFieldsForType(type) {
  if (type === 'BUYER') {
    return {
      statusField: 'buyerSubscriptionStatus',
      planField: 'buyerSubscriptionPlan',
      activatedField: 'buyerSubscriptionActivatedAt',
    }
  }
  return {
    statusField: 'sellerSubscriptionStatus',
    planField: 'sellerSubscriptionPlan',
    activatedField: 'sellerSubscriptionActivatedAt',
  }
}

/**
 * Sync denormalized subscription plan/status after payment verification.
 * Portal User ID is provisioned by Main Portal — not allocated here.
 */
async function syncSubscriptionFieldsForGrants(client, userId, subscriptions) {
  for (const sub of subscriptions) {
    const type = workspaceForPlan(sub.plan)
    if (!type) continue

    const fields = subscriptionFieldsForType(type)
    const status = sub.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE'
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { [fields.activatedField]: true },
    })
    if (!user) continue

    const updateData = {
      [fields.statusField]: status,
      [fields.planField]: sub.plan,
    }
    if (!user[fields.activatedField]) {
      updateData[fields.activatedField] = new Date()
    }
    await client.user.update({ where: { id: userId }, data: updateData })
  }
}

/**
 * Sync denormalized subscription status/plan from active subscriptions.
 */
async function syncDenormalizedSubscriptionFields(client, userId, { hasBuyerSub, hasSellerSub, buyerPlan, sellerPlan }) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      buyerSubscriptionActivatedAt: true,
      sellerSubscriptionActivatedAt: true,
      buyerSubscriptionStatus: true,
      sellerSubscriptionStatus: true,
    },
  })
  if (!user) return

  const data = {}

  if (user.buyerSubscriptionActivatedAt || user.buyerSubscriptionStatus) {
    data.buyerSubscriptionStatus = hasBuyerSub ? 'ACTIVE' : 'EXPIRED'
    if (hasBuyerSub && buyerPlan) data.buyerSubscriptionPlan = buyerPlan
  }

  if (user.sellerSubscriptionActivatedAt || user.sellerSubscriptionStatus) {
    data.sellerSubscriptionStatus = hasSellerSub ? 'ACTIVE' : 'EXPIRED'
    if (hasSellerSub && sellerPlan) data.sellerSubscriptionPlan = sellerPlan
  }

  if (Object.keys(data).length) {
    await client.user.update({ where: { id: userId }, data })
  }
}

function hasEverActivatedBuyerSub(user) {
  return Boolean(user?.buyerSubscriptionActivatedAt || user?.buyerSubscriptionStatus)
}

function hasEverActivatedSellerSub(user) {
  return Boolean(user?.sellerSubscriptionActivatedAt || user?.sellerSubscriptionStatus)
}

module.exports = {
  workspaceForPlan,
  syncSubscriptionFieldsForGrants,
  syncDenormalizedSubscriptionFields,
  hasEverActivatedBuyerSub,
  hasEverActivatedSellerSub,
  BUYER_PLANS,
  SELLER_PLANS,
  BUYER_ENTITLEMENT_PLANS,
  SELLER_ENTITLEMENT_PLANS,
}
