'use strict'

const {
  assertTransition,
  canTransition,
  isTerminalStatus,
  isRevisionTransition,
  defaultQuoteValidUntil,
} = require('../services/rfqLifecycleService.js')

describe('rfqLifecycleService', () => {
  test('buyer can cancel pending RFQ only', () => {
    expect(canTransition('PENDING', 'CANCELLED', 'BUYER')).toBe(true)
    expect(canTransition('RESPONDED', 'CANCELLED', 'BUYER')).toBe(false)
  })

  test('seller can respond to a pending RFQ', () => {
    expect(canTransition('PENDING', 'RESPONDED', 'SELLER')).toBe(true)
    assertTransition('PENDING', 'RESPONDED', 'SELLER')
  })

  test('buyer cannot mark a pending RFQ as responded', () => {
    expect(canTransition('PENDING', 'RESPONDED', 'BUYER')).toBe(false)
    expect(() => assertTransition('PENDING', 'RESPONDED', 'BUYER')).toThrow(/Invalid RFQ transition/)
  })

  test('seller cannot accept a pending RFQ', () => {
    expect(canTransition('PENDING', 'ACCEPTED', 'SELLER')).toBe(false)
    expect(() => assertTransition('PENDING', 'ACCEPTED', 'SELLER')).toThrow(/Invalid RFQ transition/)
  })

  test('seller can revise responded quotation', () => {
    expect(canTransition('RESPONDED', 'RESPONDED', 'SELLER')).toBe(true)
    expect(isRevisionTransition('RESPONDED', 'RESPONDED')).toBe(true)
    assertTransition('RESPONDED', 'RESPONDED', 'SELLER')
  })

  test('admin seller-response transitions stay unchanged', () => {
    expect(canTransition('PENDING', 'RESPONDED', 'ADMIN')).toBe(true)
    expect(canTransition('PENDING', 'DECLINED', 'ADMIN')).toBe(true)
    expect(canTransition('PENDING', 'CANCELLED', 'ADMIN')).toBe(true)
    expect(canTransition('PENDING', 'ACCEPTED', 'ADMIN')).toBe(false)
    expect(canTransition('RESPONDED', 'RESPONDED', 'ADMIN')).toBe(true)
    expect(canTransition('RESPONDED', 'ACCEPTED', 'ADMIN')).toBe(true)
    expect(canTransition('RESPONDED', 'DECLINED', 'ADMIN')).toBe(true)
    assertTransition('PENDING', 'RESPONDED', 'ADMIN')
  })

  test('terminal statuses reject further transitions', () => {
    expect(isTerminalStatus('ACCEPTED')).toBe(true)
    expect(isTerminalStatus('DECLINED')).toBe(true)
    expect(isTerminalStatus('NOT_SELECTED')).toBe(true)
    expect(isTerminalStatus('CANCELLED')).toBe(true)
    expect(() => assertTransition('ACCEPTED', 'RESPONDED', 'SELLER')).toThrow(/closed/)
    expect(() => assertTransition('DECLINED', 'RESPONDED', 'SELLER')).toThrow(/closed/)
    expect(() => assertTransition('NOT_SELECTED', 'RESPONDED', 'SELLER')).toThrow(/closed/)
    expect(() => assertTransition('CANCELLED', 'RESPONDED', 'ADMIN')).toThrow(/closed/)
  })

  test('default quote validity is ~30 days ahead', () => {
    const date = defaultQuoteValidUntil()
    const diffDays = (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThan(29)
    expect(diffDays).toBeLessThan(31)
  })
})
