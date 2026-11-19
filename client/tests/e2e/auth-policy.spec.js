import { test, expect } from '@playwright/test'
import { loginViaUi } from '../fixtures/auth.js'
import { consumeSsoTicketInBrowser, issueSsoTicket } from '../fixtures/sso.js'
import { MANUAL_ONBOARDING_USERS, PREMIUM_QA_USERS, TEST_USERS } from '../fixtures/test-users.js'

const apiURL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001'

async function currentUserEmail(page) {
  const me = await page.request.get(`${apiURL}/api/auth/me`)
  return me.ok() ? (await me.json()).data.user.email : null
}

test.describe('Authify SSO sign-in and subscription routing', () => {
  test('buyer signs in through SSO and lands on the buyer dashboard', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)
    await expect(page).toHaveURL(/\/buyer\/dashboard/)
  })

  test('seller signs in through SSO and lands on the seller dashboard', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.seller)
    await expect(page).toHaveURL(/\/seller\/dashboard/)
  })

  test('a new SSO user without a subscription is sent to pricing and blocked from workspaces', async ({ page }) => {
    // Creates one BUYER with no subscription in the local test database.
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    await loginViaUi(page, {
      authifyUserId: `8${suffix}`.slice(0, 18),
      email: `sso.nosub.${suffix}@example.test`,
    })
    await expect(page).toHaveURL(/\/pricing/)

    await page.goto('/buyer/dashboard')
    await expect(page).not.toHaveURL(/\/buyer\/dashboard/)

    const deals = await page.request.get(`${apiURL}/api/v1/deals`)
    expect(deals.status()).toBe(403)
    expect((await deals.json()).error.code).toBe('SUBSCRIPTION_REQUIRED')
  })

  test('a Both subscriber can open the buyer and seller dashboards', async ({ page }) => {
    await loginViaUi(page, PREMIUM_QA_USERS.both)

    const status = await page.request.get(`${apiURL}/api/subscriptions/status`)
    expect(status.status()).toBe(200)
    const summary = (await status.json()).data
    expect(summary.hasBuyerSubscription).toBe(true)
    expect(summary.hasSellerSubscription).toBe(true)

    await page.goto('/buyer/dashboard')
    await expect(page).toHaveURL(/\/buyer\/dashboard/)
    await expect(page).not.toHaveURL(/\/pricing/)

    await page.goto('/seller/dashboard')
    await expect(page).toHaveURL(/\/seller\/dashboard/)
    await expect(page).not.toHaveURL(/\/pricing/)
  })
})

test.describe('Authify handoff with an existing B2B session', () => {
  test('a handoff from Authify replaces the current session', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)
    expect(await currentUserEmail(page)).toBe(TEST_USERS.buyer.email)

    const ticket = await issueSsoTicket(page.request, PREMIUM_QA_USERS.seller)
    await consumeSsoTicketInBrowser(page, ticket)

    await expect(page).not.toHaveURL(/\/(login|session-required)/)
    expect(await currentUserEmail(page)).toBe(PREMIUM_QA_USERS.seller.email)
  })

  test('a handoff without a trusted Origin is refused and leaves the ticket unused', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)
    const ticket = await issueSsoTicket(page.request, PREMIUM_QA_USERS.seller)

    await consumeSsoTicketInBrowser(page, ticket, { fromOrigin: null })
    await expect(page).toHaveURL(/\/(login|session-required)/)
    expect(await currentUserEmail(page)).toBe(TEST_USERS.buyer.email)

    await consumeSsoTicketInBrowser(page, ticket)
    expect(await currentUserEmail(page)).toBe(PREMIUM_QA_USERS.seller.email)
  })
})

test.describe('Password sign-in is admin-only', () => {
  for (const [label, account] of Object.entries(MANUAL_ONBOARDING_USERS)) {
    test(`${label} password login is refused without a session`, async ({ request }) => {
      const response = await request.post(`${apiURL}/api/auth/login`, {
        data: { email: account.email, password: account.password },
      })
      expect(response.status()).toBe(403)
      expect((await response.json()).error.code).toBe('SSO_REQUIRED')
      expect(response.headers()['set-cookie'] ?? '').not.toContain('auth_token=')
    })
  }

  test('registration is refused', async ({ request }) => {
    const response = await request.post(`${apiURL}/api/auth/register`, {
      data: { email: `new.${Date.now()}@example.test`, password: 'StrongPass1!', role: 'BUYER' },
    })
    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('REGISTRATION_DISABLED')
  })

  test('a buyer SSO session cannot open the admin area or admin APIs', async ({ page }) => {
    await loginViaUi(page, TEST_USERS.buyer)

    await page.goto('/admin')
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)

    const adminApi = await page.request.get(`${apiURL}/api/admin/buyers`)
    expect(adminApi.status()).toBe(403)
  })
})
