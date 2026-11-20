import { expect } from '@playwright/test'
import { csrfHeaderFromCookies } from './csrf.js'
import { consumeSsoTicketInBrowser, issueSsoTicket } from './sso.js'
import { TEST_USERS } from './test-users.js'

const apiURL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001'

/**
 * Establish a session the way each account type really signs in.
 * Buyers and sellers (users with an authifyUserId) go through Authify SSO: a signed
 * ticket request, then the browser form POST to /sso/consume. Admins use the
 * password API behind /admin/login. Default user is the subscribed PREMIUM_AUTOMATION buyer.
 */
export async function loginViaUi(page, account = TEST_USERS.buyer) {
  if (account.authifyUserId) {
    const ticket = await issueSsoTicket(page.request, account)
    await consumeSsoTicketInBrowser(page, ticket)
  } else {
    const response = await page.request.post(`${apiURL}/api/auth/login`, {
      data: { email: account.email, password: account.password },
    })
    expect(response.ok(), `Admin login API failed (${response.status()})`).toBeTruthy()
    await page.goto('/portal')
  }

  await page
    .waitForResponse(
      (res) => res.url().includes('/subscriptions/status') && res.status() === 200,
      { timeout: 15_000 },
    )
    .catch(() => {})

  await page.waitForURL(/\/(buyer|seller|portal|admin|pricing)/, { timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/(login|session-required)/)
}

export async function logoutViaApi(request) {
  const headers = csrfHeaderFromCookies(await request.storageState().then((s) => s.cookies))
  await request.post('/api/auth/logout', { headers: headers ?? {} })
}
