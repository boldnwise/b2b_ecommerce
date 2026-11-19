import { request } from '@playwright/test'
import { SSO_ISSUE_URL, signedIssueHeaders } from './fixtures/sso.js'

/**
 * Refuse to run against an API that does not hold the test-only SSO secret, for example
 * a dev server already listening on the API port. The probe is signed but its body is
 * invalid, so the API rejects it before writing a nonce or ticket:
 *   400 VALIDATION_ERROR  secret matches
 *   401                   different secret
 *   503                   SSO not configured
 */
export default async function globalSetup() {
  const api = await request.newContext()
  try {
    const body = '{}'
    let response
    try {
      response = await api.post(SSO_ISSUE_URL, { headers: signedIssueHeaders(body), data: body })
    } catch (error) {
      throw new Error(`[playwright preflight] API is not reachable at ${SSO_ISSUE_URL}: ${error.message}`)
    }
    const code = await response.json().then((json) => json?.error?.code).catch(() => undefined)
    if (response.status() !== 400 || code !== 'VALIDATION_ERROR') {
      throw new Error(
        `[playwright preflight] The API answered the SSO probe with ${response.status()} ${code ?? ''}. `
          + 'It is not running with the Playwright test SSO secret. Stop the server on the API port and let '
          + 'Playwright start it, or start it with SSO_S2S_SECRET and SSO_HANDOFF_ALLOWED_ORIGINS from '
          + 'client/playwright.config.js.',
      )
    }
  } finally {
    await api.dispose()
  }
}
