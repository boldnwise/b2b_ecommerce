'use strict'

const jwt       = require('jsonwebtoken')
const supertest = require('supertest')
// app is required lazily so mocks registered in test files take effect first
const app = require('../app')

const TEST_JWT_SECRET = process.env.JWT_SECRET

// ── Stable test UUIDs ────────────────────────────────────────────────────────
// All IDs must be valid v4 UUIDs because Zod validators use z.string().uuid().
const IDS = {
  BUYER:    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  SELLER:   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ADMIN:    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  PRODUCT:  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  PRODUCT2: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  ORDER:    'ffffffff-ffff-4fff-8fff-ffffffffffff',
  SUB:      '11111111-1111-4111-8111-111111111111',
  PAYMENT:  '22222222-2222-4222-8222-222222222222',
  DEAL:     '99999999-9999-4999-8999-999999999999',
  OTHER_BUYER:  '33333333-3333-4333-8333-333333333333',
  OTHER_SELLER: '44444444-4444-4444-8444-444444444444',
  STRANGER:     '55555555-5555-4555-8555-555555555555',
  NOT_FOUND:    '66666666-6666-4666-8666-666666666666', // valid UUID that never matches DB
}

/**
 * Mint a signed JWT accepted by the test server.
 * The issuer and secret must match what verifyToken() expects.
 * Defaults match real sessions: admins sign in with a password, everyone else through SSO.
 * Pass authMethod: null to mint a token without the claim (pre-policy session).
 */
function makeToken({
  id = IDS.BUYER,
  email = 'test@example.com',
  role = 'BUYER',
  authMethod = role === 'ADMIN' ? 'password' : 'sso',
} = {}) {
  const claims = { sub: id, email, role }
  if (authMethod) claims.authMethod = authMethod
  return jwt.sign(claims, TEST_JWT_SECRET, {
    expiresIn: '1h',
    issuer: 'b2b-ecommerce-api',
    algorithm: 'HS256',
  })
}

/**
 * Return a header object that sets the auth cookie for supertest requests.
 * Accepts either a token string or an options object for makeToken().
 */
function cookieFor(tokenOrOptions) {
  const token =
    typeof tokenOrOptions === 'string' ? tokenOrOptions : makeToken(tokenOrOptions)
  const csrf = process.env.TEST_CSRF_TOKEN || 'test-csrf-token-for-jest'
  return {
    Cookie: `auth_token=${token}; csrf_token=${csrf}`,
    'X-CSRF-Token': csrf,
  }
}

// ── Test-data factories ───────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    id:          IDS.BUYER,
    email:       'buyer@test.com',
    role:        'BUYER',
    companyName: 'Buyer Co',
    createdAt:   new Date('2024-01-01'),
    ...overrides,
  }
}

function makeSeller(overrides = {}) {
  return makeUser({
    id:          IDS.SELLER,
    email:       'seller@test.com',
    role:        'SELLER',
    companyName: 'Seller Co',
    ...overrides,
  })
}

function makeProduct(overrides = {}) {
  return {
    id:             IDS.PRODUCT,
    sellerId:       IDS.SELLER,
    sku:            'PROD-001',
    name:           'Test Product',
    price:          { toString: () => '1000.00' },
    moq:            1,
    isActive:       true,
    trackInventory: false,
    stockQty:       0,
    reservedQty:    0,
    ...overrides,
  }
}

function makeOrder(overrides = {}) {
  return {
    id:               IDS.ORDER,
    orderNumber:      'ORD-TEST-001',
    buyerId:          IDS.BUYER,
    sellerId:         IDS.SELLER,
    status:           'PENDING',
    totalAmount:      { toString: () => '1000.00' },
    notes:            null,
    idempotencyKey:   null,
    shippingSnapshot: null,
    billingSnapshot:  null,
    items:            [],
    buyer:            { id: IDS.BUYER,  email: 'buyer@test.com',  companyName: 'Buyer Co'  },
    seller:           { id: IDS.SELLER, email: 'seller@test.com', companyName: 'Seller Co' },
    history:          [],
    createdAt:        new Date(),
    updatedAt:        new Date(),
    ...overrides,
  }
}

function makeSubscription(overrides = {}) {
  return {
    id:        IDS.SUB,
    userId:    IDS.BUYER,
    plan:      'BUYER_ANNUAL',
    status:    'ACTIVE',
    startsAt:  new Date(),
    expiresAt: null,
    ...overrides,
  }
}

function makePayment(overrides = {}) {
  return {
    id:                 IDS.PAYMENT,
    userId:             IDS.BUYER,
    razorpayOrderId:    'rzp_order_TEST123',
    razorpayPaymentId:  null,
    razorpaySignature:  null,
    plan:               'BUYER_ANNUAL',
    amountPaise:        499900,
    currency:           'INR',
    status:             'PENDING',
    subscriptionId:     null,
    createdAt:          new Date(),
    ...overrides,
  }
}

const agent = supertest(app)

module.exports = {
  IDS,
  agent,
  makeToken,
  cookieFor,
  makeUser,
  makeSeller,
  makeProduct,
  makeOrder,
  makeSubscription,
  makePayment,
}
