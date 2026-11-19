import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

async function renderWithAuthifyUrl(value) {
  vi.resetModules()
  vi.stubEnv('VITE_AUTHIFY_FRONTEND_URL', value)
  const { SessionRequiredPage } = await import('../pages/common/SessionRequiredPage.jsx')
  render(
    <MemoryRouter>
      <SessionRequiredPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('SessionRequiredPage', () => {
  it('links to Authify My Apps when VITE_AUTHIFY_FRONTEND_URL is set', async () => {
    await renderWithAuthifyUrl('https://app-staging.boldnwise.com')
    expect(screen.getByRole('link', { name: /continue to authify/i })).toHaveAttribute(
      'href',
      'https://app-staging.boldnwise.com/my-apps',
    )
  })

  it('hides the Authify link when the URL is not set', async () => {
    await renderWithAuthifyUrl('')
    expect(screen.queryByRole('link', { name: /continue to authify/i })).toBeNull()
    expect(screen.getByRole('link', { name: /view plans/i })).toBeInTheDocument()
  })

  it('hides the Authify link for a non-https URL', async () => {
    await renderWithAuthifyUrl('http://app-staging.boldnwise.com')
    expect(screen.queryByRole('link', { name: /continue to authify/i })).toBeNull()
  })
})
