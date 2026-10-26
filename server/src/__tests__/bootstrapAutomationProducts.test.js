const {
  buildAutomationProductSpecs,
  AUTOMATION_E2E_PRODUCT_COUNT,
} = require('../../prisma/seed/premium.js')

describe('bootstrap automation seller product specs', () => {
  it('exports a count derived from buildAutomationProductSpecs', () => {
    expect(AUTOMATION_E2E_PRODUCT_COUNT).toBe(20)
    expect(buildAutomationProductSpecs('seller-id')).toHaveLength(AUTOMATION_E2E_PRODUCT_COUNT)
  })

  it('defines distinct SKUs for each automation listing', () => {
    const specs = buildAutomationProductSpecs('seller-id')
    const skus = specs.map((s) => s.sku)
    expect(new Set(skus).size).toBe(specs.length)
  })

  it('assigns every spec to the automation seller id', () => {
    const sellerId = 'automation-seller-uuid'
    const specs = buildAutomationProductSpecs(sellerId)
    expect(specs.every((s) => s.sellerId === sellerId)).toBe(true)
  })
})
