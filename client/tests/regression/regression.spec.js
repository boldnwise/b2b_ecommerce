import { test, expect } from '@playwright/test'
import { loginViaUi } from '../fixtures/auth.js'
import { TEST_USERS } from '../fixtures/test-users.js'

test.describe('Regression — end-to-end marketplace journeys', () => {
  test('guest browse → product detail → login redirect for dashboard', async ({ page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')
    const cardLink = page.locator('.mpCard__link').first()
    if (await cardLink.count()) {
      await cardLink.click()
      await expect(page).toHaveURL(/\/products\//)
    }
    await page.goto('/buyer/dashboard')
    await expect(page).toHaveURL(/\/session-required/)
  })

  test('buyer session persists across quotation and deals pages', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)
    await page.goto('/buyer/quotations')
    await expect(page.getByTestId('quotation-workspace')).toBeVisible({ timeout: 30_000 })
    await page.goto('/buyer/deals')
    await expect(page.getByTestId('deal-list-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /my orders|deals/i })).toBeVisible({ timeout: 30_000 })
  })

  test('seller can access products and quotations workspaces', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.seller)
    await page.goto('/seller/products')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.goto('/seller/quotations')
    await expect(page.getByRole('heading', { name: /quotation center|incoming rfqs/i })).toBeVisible()
    await expect(page.getByTestId('quotation-workspace-list')).toBeVisible()
  })

  test('catalog API returns masked seller identity', async ({ request }) => {
    const apiURL = process.env.PLAYWRIGHT_API_URL || 'http://localhost:3001'
    const res = await request.get(`${apiURL}/api/catalog/products?limit=5`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const product = body.data?.products?.[0]
    if (product?.seller) {
      expect(product.seller).toHaveProperty('portalUserId')
      expect(product.seller).toHaveProperty('city')
      expect(product.seller.id).toBeUndefined()
      expect(product.seller.email).toBeUndefined()
      expect(product.seller.companyName).toBeUndefined()
    }
  })
})
