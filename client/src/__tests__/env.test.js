import { describe, expect, it } from 'vitest'
import { authifyMyAppsUrl, normalizeApiBaseUrl, normalizeAuthifyFrontendUrl } from '../constants/env.js'

describe('normalizeApiBaseUrl', () => {
  it('strips accidental .env line pasted into Vercel value', () => {
    expect(
      normalizeApiBaseUrl(
        'VITE_API_BASE_URL=https://git-repo-az5t.onrender.com/api',
        { isProd: true },
      ),
    ).toBe('https://git-repo-az5t.onrender.com/api')
  })

  it('strips leading slash before env line fragment', () => {
    expect(
      normalizeApiBaseUrl(
        '/VITE_API_BASE_URL=https://git-repo-az5t.onrender.com/api',
        { isProd: true },
      ),
    ).toBe('https://git-repo-az5t.onrender.com/api')
  })

  it('appends /api when host given without path', () => {
    expect(
      normalizeApiBaseUrl('https://git-repo-az5t.onrender.com', { isProd: true }),
    ).toBe('https://git-repo-az5t.onrender.com/api')
  })

  it('defaults to localhost in development when unset', () => {
    expect(normalizeApiBaseUrl('', { isProd: false })).toBe('http://localhost:3001/api')
  })
})

describe('normalizeAuthifyFrontendUrl', () => {
  it('keeps an https origin and drops trailing slashes and paths', () => {
    expect(normalizeAuthifyFrontendUrl('https://app-staging.boldnwise.com/')).toBe(
      'https://app-staging.boldnwise.com',
    )
    expect(normalizeAuthifyFrontendUrl(' https://app-staging.boldnwise.com/login ')).toBe(
      'https://app-staging.boldnwise.com',
    )
  })

  it('allows plain http only for localhost', () => {
    expect(normalizeAuthifyFrontendUrl('http://localhost:5174')).toBe('http://localhost:5174')
    expect(normalizeAuthifyFrontendUrl('http://app-staging.boldnwise.com')).toBe('')
  })

  it('rejects empty, relative, and non-web values', () => {
    expect(normalizeAuthifyFrontendUrl(undefined)).toBe('')
    expect(normalizeAuthifyFrontendUrl('')).toBe('')
    expect(normalizeAuthifyFrontendUrl('/my-apps')).toBe('')
    expect(normalizeAuthifyFrontendUrl('javascript:alert(1)')).toBe('')
  })

  it('builds the My Apps link only when an origin is configured', () => {
    expect(authifyMyAppsUrl('https://app-staging.boldnwise.com')).toBe(
      'https://app-staging.boldnwise.com/my-apps',
    )
    expect(authifyMyAppsUrl('')).toBe('')
  })
})
