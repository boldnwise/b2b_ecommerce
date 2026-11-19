import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { authReducer } from '../store/slices/authSlice.js'
import { subscriptionReducer } from '../store/slices/subscriptionSlice.js'
import { PortalHome, subscriptionLandingPath } from '../pages/portal/PortalHome.jsx'
import { ProtectedRoute } from '../router/ProtectedRoute.jsx'
import { HomeMarketingNav } from '../components/common/HomeMarketingNav.jsx'
import { PricingPlansPage } from '../pages/marketing/PricingPlansPage.jsx'

const { startCheckout } = vi.hoisted(() => ({ startCheckout: vi.fn() }))

vi.mock('../hooks/useRazorpayCheckout.js', () => ({
  useRazorpayCheckout: () => ({ startCheckout, loadingPlan: null }),
}))

vi.mock('../services/subscription.service.js', () => ({
  fetchSubscriptionStatus: vi.fn().mockResolvedValue({
    hasBuyerSubscription: false,
    hasSellerSubscription: false,
    subscriptions: [],
  }),
  createSubscriptionOrder: vi.fn(),
  verifySubscriptionPayment: vi.fn(),
}))

function authState(overrides = {}) {
  return {
    user: null,
    status: 'succeeded',
    error: null,
    initialized: true,
    ...overrides,
  }
}

function subscriptionState(overrides = {}) {
  return {
    hasSeller: false,
    hasBuyer: false,
    sellerPlanType: null,
    buyerPlanType: null,
    buyerMarketplaceId: null,
    sellerMarketplaceId: null,
    portalUserId: null,
    buyerSubscription: null,
    sellerSubscription: null,
    subscriptions: [],
    status: 'succeeded',
    error: null,
    ...overrides,
  }
}

function renderWithState(ui, { auth = authState(), subscription = subscriptionState(), path = '/portal' } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, subscription: subscriptionReducer },
    preloadedState: { auth, subscription },
  })
  const pages = {
    '/portal': <div>Portal</div>,
    '/pricing': <div>Pricing page</div>,
    '/buyer/dashboard': <div>Buyer dashboard</div>,
    '/seller/dashboard': <div>Seller dashboard</div>,
    '/session-required': <div>Session required</div>,
    '/admin/login': <div>Admin sign in</div>,
    '/login': <div>Password login</div>,
    '/admin': <div>Admin shell</div>,
    '/buyer/dashboard-guard': <div>Guard shell</div>,
  }
  pages[path] = ui
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {Object.entries(pages).map(([route, element]) => (
            <Route key={route} path={route} element={element} />
          ))}
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

describe('subscriptionLandingPath', () => {
  it('sends a user with no active subscription to pricing', () => {
    expect(subscriptionLandingPath({ hasBuyer: false, hasSeller: false })).toBe('/pricing')
  })

  it('sends an active buyer subscription to the buyer dashboard', () => {
    expect(subscriptionLandingPath({ hasBuyer: true, hasSeller: false })).toBe('/buyer/dashboard')
  })

  it('sends an active seller subscription to the seller dashboard', () => {
    expect(subscriptionLandingPath({ hasBuyer: false, hasSeller: true })).toBe('/seller/dashboard')
  })

  it('prefers the buyer dashboard when both subscriptions are active', () => {
    expect(subscriptionLandingPath({ hasBuyer: true, hasSeller: true })).toBe('/buyer/dashboard')
  })
})

describe('PortalHome subscription routing', () => {
  const user = { id: 'user-1', email: 'buyer@example.com', role: 'BUYER' }

  it('does not redirect while subscription status is still loading', () => {
    renderWithState(<PortalHome />, {
      auth: authState({ user }),
      subscription: subscriptionState({ status: 'loading' }),
    })
    expect(screen.getByText(/checking your subscription/i)).toBeInTheDocument()
    expect(screen.queryByText('Pricing page')).not.toBeInTheDocument()
  })

  it('does not redirect when the subscription request fails', () => {
    renderWithState(<PortalHome />, {
      auth: authState({ user }),
      subscription: subscriptionState({ status: 'failed', error: 'unavailable' }),
    })
    expect(screen.getByRole('heading', { name: /subscription status unavailable/i })).toBeInTheDocument()
    expect(screen.queryByText('Pricing page')).not.toBeInTheDocument()
    expect(screen.queryByText('Buyer dashboard')).not.toBeInTheDocument()
  })

  it('opens pricing for a signed-in user with no subscription', async () => {
    renderWithState(<PortalHome />, {
      auth: authState({ user }),
      subscription: subscriptionState({ status: 'succeeded' }),
    })
    expect(await screen.findByText('Pricing page')).toBeInTheDocument()
  })

  it('opens the buyer dashboard for an active buyer subscription', async () => {
    renderWithState(<PortalHome />, {
      auth: authState({ user: { ...user, role: 'BUYER' } }),
      subscription: subscriptionState({ status: 'succeeded', hasBuyer: true }),
    })
    expect(await screen.findByText('Buyer dashboard')).toBeInTheDocument()
  })

  it('opens the seller dashboard for an active seller subscription', async () => {
    renderWithState(<PortalHome />, {
      auth: authState({ user: { ...user, role: 'BUYER' } }),
      subscription: subscriptionState({ status: 'succeeded', hasSeller: true }),
    })
    expect(await screen.findByText('Seller dashboard')).toBeInTheDocument()
  })
})

describe('marketplace session guard', () => {
  it('sends a direct dashboard visit without a session to the signed-out page', async () => {
    renderWithState(
      <ProtectedRoute>
        <div>Private dashboard</div>
      </ProtectedRoute>,
      { path: '/buyer/dashboard-guard' },
    )
    expect(await screen.findByText('Session required')).toBeInTheDocument()
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
  })

  it('sends an unauthenticated admin visit to the admin login page', async () => {
    renderWithState(
      <ProtectedRoute roles={['ADMIN']} redirectTo="/admin/login">
        <div>Admin dashboard</div>
      </ProtectedRoute>,
      { path: '/admin' },
    )
    expect(await screen.findByText('Admin sign in')).toBeInTheDocument()
  })

  it('allows an authenticated admin onto the admin dashboard', () => {
    renderWithState(
      <ProtectedRoute roles={['ADMIN']} redirectTo="/admin/login">
        <div>Admin dashboard</div>
      </ProtectedRoute>,
      {
        path: '/admin',
        auth: authState({ user: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' } }),
      },
    )
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument()
  })
})

describe('HomeMarketingNav', () => {
  it('does not show a password sign-in link and keeps pricing available', () => {
    renderWithState(<HomeMarketingNav />, { path: '/pricing' })
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pricing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Product' })).toBeInTheDocument()
  })
})

describe('PricingPlansPage checkout gate', () => {
  beforeEach(() => {
    startCheckout.mockReset()
    startCheckout.mockResolvedValue(undefined)
  })

  it('does not start checkout or leave pricing before auth initialization finishes', async () => {
    const user = userEvent.setup()
    renderWithState(<PricingPlansPage />, {
      path: '/pricing',
      auth: authState({ initialized: false, status: 'loading' }),
    })
    await user.click(screen.getAllByRole('button', { name: /subscribe now/i })[0])
    expect(startCheckout).not.toHaveBeenCalled()
    expect(screen.queryByText('Session required')).not.toBeInTheDocument()
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
  })

  it('starts checkout for an authenticated user with no subscription', async () => {
    const user = userEvent.setup()
    renderWithState(<PricingPlansPage />, {
      path: '/pricing',
      auth: authState({
        user: { id: 'user-1', email: 'buyer@example.com', role: 'BUYER', companyName: 'Acme' },
      }),
    })
    await user.click(screen.getAllByRole('button', { name: /subscribe now/i })[0])
    expect(startCheckout).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor to the Authify message instead of password login', async () => {
    const user = userEvent.setup()
    renderWithState(<PricingPlansPage />, { path: '/pricing' })
    await user.click(screen.getAllByRole('button', { name: /subscribe now/i })[0])
    expect(await screen.findByText('Session required')).toBeInTheDocument()
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
    expect(startCheckout).not.toHaveBeenCalled()
  })

  it('follows the existing success redirect after payment verification', async () => {
    startCheckout.mockImplementation(async ({ plan, onSuccess }) => {
      onSuccess?.(plan)
    })
    const user = userEvent.setup()
    renderWithState(<PricingPlansPage />, {
      path: '/pricing',
      auth: authState({
        user: { id: 'user-1', email: 'seller@example.com', role: 'BUYER' },
      }),
    })
    await user.click(screen.getByRole('tab', { name: /seller/i }))
    await user.click(screen.getAllByRole('button', { name: /subscribe now/i })[0])
    expect(await screen.findByText('Seller dashboard')).toBeInTheDocument()
  })
})
