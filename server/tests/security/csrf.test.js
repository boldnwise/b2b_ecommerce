'use strict'

jest.mock('../../src/config/database')
jest.mock('razorpay', () => {
  const mockOrders = { create: jest.fn() }
  const RazorpayMock = jest.fn().mockImplementation(() => ({ orders: mockOrders }))
  RazorpayMock._mockOrders = mockOrders
  return RazorpayMock
})

const { agent, makeToken, cookieFor, makeUser } = require('../../src/__tests__/helpers')
const { prisma } = require('../../src/config/database')

const BUYER = makeUser()
const buyerToken = makeToken({ id: BUYER.id, email: BUYER.email, role: 'BUYER' })

describe('CSRF protection', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(BUYER)
    prisma.payment.findFirst.mockResolvedValue(null)
  })

  test('403 when mutating request lacks CSRF header', async () => {
    const token = buyerToken
    const csrf = process.env.TEST_CSRF_TOKEN

    const res = await agent
      .post('/api/subscriptions/create-order')
      .set('Cookie', `auth_token=${token}; csrf_token=${csrf}`)
      .send({ plan: 'BUYER_ANNUAL' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED')
  })

  test('allows mutating request when CSRF cookie and header match', async () => {
    const Razorpay = require('razorpay')
    Razorpay._mockOrders.create.mockResolvedValue({
      id: 'rzp_order_csrf',
      amount: 999900,
      currency: 'INR',
    })
    prisma.payment.create.mockResolvedValue({})

    const res = await agent
      .post('/api/subscriptions/create-order')
      .set(cookieFor(buyerToken))
      .send({ plan: 'BUYER_ANNUAL' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('403 when CSRF header does not match the cookie', async () => {
    const res = await agent
      .post('/api/subscriptions/create-order')
      .set('Cookie', `auth_token=${buyerToken}; csrf_token=${process.env.TEST_CSRF_TOKEN}`)
      .set('X-CSRF-Token', 'different-csrf-token')
      .send({ plan: 'BUYER_ANNUAL' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED')
  })

  test('GET does not require a CSRF header', async () => {
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${buyerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.error?.code).not.toBe('CSRF_VALIDATION_FAILED')
    const csrfCookie = (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('csrf_token='))
    expect(res.headers['x-csrf-token']).toBe(csrfCookie.split(';')[0].slice('csrf_token='.length))
  })
})
