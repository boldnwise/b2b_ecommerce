import { test, expect } from '@playwright/test'

test.describe('Subscription / pricing page', () => {
  test('displays buyer and seller plan options', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.getByRole('tab', { name: /^Buyer$/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Seller$/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Both/i })).toBeVisible()
  })

  test('unauthenticated user sees sign-in path for checkout', async ({ page }) => {
    await page.goto('/pricing')
    const subscribeBtn = page.getByRole('button', { name: /subscribe|get started|choose/i }).first()
    if (await subscribeBtn.isVisible()) {
      await subscribeBtn.click()
      await expect(page).toHaveURL(/\/session-required/)
    }
  })
})
