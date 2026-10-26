import { expect } from '@playwright/test'
import { csrfHeaderFromCookies } from './csrf.js'
import { TEST_USERS } from './test-users.js'

/**
 * Sign in through the UI and wait for post-login navigation.
 * Default credentials are PREMIUM_AUTOMATION users (subscribed) from server/prisma/seed.js.
 */
export async function loginViaUi(page, { email, password } = TEST_USERS.buyer) {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)

  const loginResponse = page.waitForResponse(
    (res) => res.url().includes('/auth/login') && res.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Continue' }).click()
  const response = await loginResponse
  expect(response.ok(), `Login API failed (${response.status()})`).toBeTruthy()

  await page
    .waitForResponse(
      (res) => res.url().includes('/subscriptions/status') && res.status() === 200,
      { timeout: 15_000 },
    )
    .catch(() => {})

  await page.waitForURL(/\/(buyer|seller|portal|admin)/, { timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

export async function logoutViaApi(request) {
  const headers = csrfHeaderFromCookies(await request.storageState().then((s) => s.cookies))
  await request.post('/api/auth/logout', { headers: headers ?? {} })
}
