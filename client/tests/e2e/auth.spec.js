import { test, expect } from '@playwright/test'
import { loginViaUi } from '../fixtures/auth.js'
import { TEST_USERS } from '../fixtures/test-users.js'

test.describe('Homepage', () => {
  test('shows marketplace value proposition', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.homeLanding__eyebrow')).toHaveText('B2B marketplace')
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  })
})

test.describe('Login redirect', () => {
  test('protected buyer dashboard explains how to open B2B from Authify', async ({ page }) => {
    await page.goto('/buyer/dashboard')
    await expect(page).toHaveURL(/\/session-required/)
    await expect(page.getByRole('heading', { name: /open b2b from authify/i })).toBeVisible()
  })

  test('guest login and register routes explain how to open B2B from Authify', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/session-required/)
    await expect(page.getByRole('heading', { name: /open b2b from authify/i })).toBeVisible()
    await expect(page.getByPlaceholder('you@company.com')).toHaveCount(0)

    await page.goto('/register')
    await expect(page).toHaveURL(/\/session-required/)
    await expect(page.getByRole('heading', { name: /open b2b from authify/i })).toBeVisible()
  })

  test('authenticated buyer reaches dashboard', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)
    await page.goto('/buyer/dashboard')
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible()
  })
})

test.describe('Unauthorized page', () => {
  test('renders access denied copy', async ({ page }) => {
    await page.goto('/unauthorized')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to home' })).toBeVisible()
  })
})
