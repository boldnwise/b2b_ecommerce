import { describe, expect, it } from 'vitest'
import { csrfHeaderFromCookies } from '../../tests/fixtures/csrf.js'

describe('csrfHeaderFromCookies (Playwright API helper)', () => {
  it('returns X-CSRF-Token header when csrf_token cookie is present', () => {
    expect(
      csrfHeaderFromCookies([
        { name: 'auth_token', value: 'jwt' },
        { name: 'csrf_token', value: 'abc123' },
      ]),
    ).toEqual({ 'X-CSRF-Token': 'abc123' })
  })

  it('returns null when csrf_token cookie is missing', () => {
    expect(csrfHeaderFromCookies([{ name: 'auth_token', value: 'jwt' }])).toBeNull()
    expect(csrfHeaderFromCookies([])).toBeNull()
  })
})
