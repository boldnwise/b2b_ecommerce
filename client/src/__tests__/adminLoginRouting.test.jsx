import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom'

vi.mock('../services/auth.service.js', () => ({
  loginRequest: vi.fn(),
  fetchMeRequest: vi.fn(),
  logoutRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../layouts/AdminLayout.jsx', () => ({
  AdminLayout: () => (
    <div>
      Admin area
      <Outlet />
    </div>
  ),
}))

vi.mock('../pages/admin/AdminOverviewDashboard.jsx', () => ({
  AdminOverviewDashboard: () => <div>Admin dashboard</div>,
}))

vi.mock('../pages/common/UnauthorizedPage.jsx', () => ({
  UnauthorizedPage: () => <div>Unauthorized</div>,
}))

import { AppRoutes } from '../router/AppRoutes.jsx'
import { authReducer } from '../store/slices/authSlice.js'
import { subscriptionReducer } from '../store/slices/subscriptionSlice.js'
import * as authApi from '../services/auth.service.js'

const USERS = {
  BUYER: { id: 'buyer-1', email: 'buyer@example.com', role: 'BUYER' },
  SELLER: { id: 'seller-1', email: 'seller@example.com', role: 'SELLER' },
  ADMIN: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
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
    status: 'idle',
    error: null,
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="pathname">{location.pathname}</output>
}

function renderRoutes(path, { user = null, subscription } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, subscription: subscriptionReducer },
    preloadedState: {
      auth: { user, status: 'succeeded', error: null, initialized: true },
      subscription: subscriptionState(subscription),
    },
  })
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Provider>,
  )
  return store
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/admin/login routing', () => {
  it('shows the admin login form to a signed-out visitor', async () => {
    renderRoutes('/admin/login')

    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/admin/login')
  })

  it.each(['BUYER', 'SELLER'])(
    'shows the admin login form to a signed-in %s instead of redirecting',
    async (role) => {
      renderRoutes('/admin/login', { user: USERS[role] })

      expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument()
      expect(screen.getByTestId('pathname')).toHaveTextContent('/admin/login')
      expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument()
    },
  )

  it('redirects a signed-in ADMIN to the admin dashboard', async () => {
    renderRoutes('/admin/login', { user: USERS.ADMIN })

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/admin$/)
    expect(screen.queryByRole('heading', { name: /admin login/i })).not.toBeInTheDocument()
  })

  it.each(['BUYER', 'SELLER'])('still refuses /admin to a signed-in %s', async (role) => {
    renderRoutes('/admin', { user: USERS[role] })

    expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
  })

  it('still sends a signed-out visitor from /admin to the admin login form', async () => {
    renderRoutes('/admin')

    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/admin/login')
  })

  it('replaces a buyer session with the admin session after a successful admin login', async () => {
    authApi.loginRequest.mockResolvedValue({ user: USERS.ADMIN })
    const user = userEvent.setup()
    const store = renderRoutes('/admin/login', {
      user: USERS.BUYER,
      subscription: { hasBuyer: true, status: 'succeeded', buyerPlanType: 'BUYER_LIFETIME' },
    })

    await user.type(await screen.findByPlaceholderText('admin@b2b.local'), USERS.ADMIN.email)
    await user.type(screen.getByPlaceholderText('••••••••'), 'CorrectPassword1!')
    await user.click(screen.getByRole('button', { name: 'Login' }))

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(store.getState().auth.user.role).toBe('ADMIN')
    expect(store.getState().subscription.hasBuyer).toBe(false)
    expect(store.getState().subscription.status).toBe('idle')
    expect(authApi.logoutRequest).not.toHaveBeenCalled()
  })

  it('keeps the buyer session when the admin login is refused', async () => {
    authApi.loginRequest.mockRejectedValue(new Error('Invalid email or password'))
    const user = userEvent.setup()
    const store = renderRoutes('/admin/login', { user: USERS.BUYER })

    await user.type(await screen.findByPlaceholderText('admin@b2b.local'), 'someone@example.com')
    await user.type(screen.getByPlaceholderText('••••••••'), 'WrongPassword1!')
    await user.click(screen.getByRole('button', { name: 'Login' }))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(store.getState().auth.user).toEqual(USERS.BUYER)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/admin/login')
  })
})
