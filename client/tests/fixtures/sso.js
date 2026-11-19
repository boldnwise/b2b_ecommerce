import crypto from 'crypto'
import { expect } from '@playwright/test'

const apiURL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001'

/**
 * Test-only SSO server-to-server secret. playwright.config.js passes the same value to the
 * local API it starts. Never reuse this value outside local and CI browser tests.
 */
export const TEST_SSO_S2S_SECRET =
  process.env.PLAYWRIGHT_SSO_S2S_SECRET || 'playwright-local-sso-s2s-secret-not-for-deployment'

/**
 * Stand-in Authify frontend origin. Nothing listens here: the test serves the handoff page
 * with page.route. playwright.config.js puts it in the API's SSO_HANDOFF_ALLOWED_ORIGINS.
 */
export const TEST_AUTHIFY_ORIGIN = process.env.PLAYWRIGHT_AUTHIFY_ORIGIN || 'http://localhost:4599'

const ISSUE_PATH = '/api/sso/issue-ticket'

/** Headers Authify's backend sends with a ticket request, signed with the test secret. */
export function signedIssueHeaders(body) {
  const timestamp = String(Date.now())
  const nonce = crypto.randomBytes(24).toString('base64url')
  const signature = crypto
    .createHmac('sha256', TEST_SSO_S2S_SECRET)
    .update(`POST\n${ISSUE_PATH}\n${timestamp}\n${nonce}\n${body}`)
    .digest('hex')
  return {
    'Content-Type': 'application/json',
    'X-SSO-Timestamp': timestamp,
    'X-SSO-Nonce': nonce,
    'X-SSO-Signature': signature,
  }
}

export const SSO_ISSUE_URL = `${apiURL}${ISSUE_PATH}`

/** Sign and send the request Authify's backend would send to issue a one-time ticket. */
export async function issueSsoTicket(request, { authifyUserId, email }) {
  const body = JSON.stringify({ authifyUserId, email, audience: 'b2b' })
  const response = await request.post(SSO_ISSUE_URL, {
    headers: signedIssueHeaders(body),
    data: body,
  })
  expect(response.status(), `SSO ticket issue failed (${response.status()})`).toBe(201)
  return (await response.json()).data.ticket
}

function handoffForm(ticket) {
  return (
    `<form method="post" action="${apiURL}/sso/consume">` +
    `<input type="hidden" name="ticket" value="${ticket}"></form>`
  )
}

/**
 * Complete the browser handoff the way Authify does: a top-level form POST to /sso/consume
 * from a page on the Authify origin. The API redirects to the B2B frontend: /portal on
 * success, /login on failure.
 *
 * Pass { fromOrigin: null } to submit from about:blank (Origin: null), which the API must refuse.
 */
export async function consumeSsoTicketInBrowser(page, ticket, { fromOrigin = TEST_AUTHIFY_ORIGIN } = {}) {
  const apiOrigin = new URL(apiURL).origin
  const pageUrl = fromOrigin ? `${fromOrigin}/b2b-handoff` : null
  if (pageUrl) {
    await page.route(pageUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: handoffForm(ticket) }),
    )
    await page.goto(pageUrl)
  } else {
    await page.setContent(handoffForm(ticket))
  }

  await Promise.all([
    page.waitForURL(
      (url) => url.protocol.startsWith('http') && url.origin !== apiOrigin && url.origin !== fromOrigin,
      { timeout: 20_000 },
    ),
    page.locator('form').evaluate((form) => form.submit()),
  ])
  if (pageUrl) await page.unroute(pageUrl)
}
