/**
 * Build CSRF request headers from Playwright cookie list (same name as server CSRF_COOKIE_NAME).
 */
export function csrfHeaderFromCookies(cookies) {
  const csrf = cookies.find((c) => c.name === 'csrf_token')?.value
  if (!csrf) return null
  return { 'X-CSRF-Token': csrf }
}

/** After UI login, mutating API calls must send X-CSRF-Token matching the csrf_token cookie. */
export async function csrfHeadersForPage(page) {
  const headers = csrfHeaderFromCookies(await page.context().cookies())
  if (!headers) {
    throw new Error(
      'Missing csrf_token cookie. Log in via the UI before calling authenticated mutating APIs.',
    )
  }
  return headers
}
