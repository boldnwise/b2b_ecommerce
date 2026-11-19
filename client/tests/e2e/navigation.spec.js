import { test, expect } from '@playwright/test'

test.describe('Primary navigation', () => {
  test('header links navigate between marketing pages', async ({ page }) => {
    await page.goto('/')
    const primaryNav = page.getByRole('navigation', { name: 'Primary' })
    await primaryNav.getByRole('link', { name: 'Product' }).click()
    await expect(page).toHaveURL(/\/products/)
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing/)
  })

  test('catalog header has no password sign-in link', async ({ page }) => {
    await page.goto('/products')
    await expect(page.getByRole('link', { name: /^sign in$/i })).toHaveCount(0)
    await expect(page).toHaveURL(/\/products/)
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing/)
  })
})

test.describe('Loading states', () => {
  test('lazy routes show loader then content', async ({ page }) => {
    await page.goto('/products')
    await expect(page.locator('.mpPage').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.mpShell').first()).toBeVisible({ timeout: 20_000 })
  })
})
