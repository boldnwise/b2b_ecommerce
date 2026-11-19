/**
 * Accounts from server/prisma/seed. Buyers and sellers sign in through test SSO using
 * their fixed authifyUserId (see server/prisma/seed/constants.js). Only the admin uses a password.
 */
export const TEST_USERS = {
  buyer: {
    email: 'buyer.premium1@test.com',
    authifyUserId: '900000000001',
  },
  seller: {
    email: 'seller.premium1@test.com',
    authifyUserId: '900000000002',
  },
  admin: {
    email: 'admin@b2b.local',
    password: 'Admin@123',
  },
}

/** PREMIUM_QA_USERS — subscribed fresh accounts for manual workflow testing */
export const PREMIUM_QA_USERS = {
  buyer: { email: 'buyer.premium2@test.com', authifyUserId: '900000000003' },
  seller: { email: 'seller.premium2@test.com', authifyUserId: '900000000004' },
  seller2: { email: 'seller2@test.com', authifyUserId: '900000000005' },
  seller3: { email: 'seller3@test.com', authifyUserId: '900000000006' },
  /** BUYER role with one BOTH_LIFETIME subscription (buyer and seller workspaces) */
  both: { email: 'both.premium1@test.com', authifyUserId: '900000000007' },
}

/**
 * Seeded buyer/seller accounts with passwords but no Authify link. Used to prove the
 * password API refuses them.
 */
export const MANUAL_ONBOARDING_USERS = {
  buyer: { email: 'buyer1@test.com', password: 'Buyer@123' },
  seller: { email: 'seller1@test.com', password: 'Seller@123' },
}

/** @deprecated use MANUAL_ONBOARDING_USERS */
export const MANUAL_TEST_USERS = MANUAL_ONBOARDING_USERS
