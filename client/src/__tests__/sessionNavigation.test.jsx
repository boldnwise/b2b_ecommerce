import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { authReducer } from '../store/slices/authSlice.js'
import { subscriptionReducer } from '../store/slices/subscriptionSlice.js'
import { SubscribeOptionsPage } from '../pages/marketing/SubscribeOptionsPage.jsx'
import { SessionRequiredPage } from '../pages/common/SessionRequiredPage.jsx'
import { AppRoutes } from '../router/AppRoutes.jsx'
import { BuyerLayout } from '../layouts/BuyerLayout.jsx'
import { SellerLayout } from '../layouts/SellerLayout.jsx'
import { UserPortalLayout } from '../layouts/UserPortalLayout.jsx'
import { AdminLayout } from '../layouts/AdminLayout.jsx'
import { useRequireAuthAction } from '../hooks/useRequireAuthAction.js'

vi.mock('../hooks/useRazorpayCheckout.js', () => ({
  useRazorpayCheckout: () => ({ startCheckout: vi.fn(), loading: false }),
}))

vi.mock('../services/contact.service.js', () => ({
  fetchContactUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
  fetchAdminMessageUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
}))

vi.mock('../services/categoryRequest.service.js', () => ({
  fetchCategoryRequestUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
}))

vi.mock('../services/admin.service.js', () => ({
  fetchAdminCategoryRequests: vi.fn().mockResolvedValue({ requests: [] }),
}))

vi.mock('../services/auth.service.js', () => ({
  logoutRequest: vi.fn().mockResolvedValue(undefined),
}))

function renderAt(ui, path, { authenticated = true } = {}) {
  const store = configureStore({
    reducer: { auth: authReducer, subscription: subscriptionReducer },
    preloadedState: {
      auth: {
        user: authenticated
          ? { id: 'user-1', email: 'buyer@example.com', role: 'BUYER', companyName: 'Buyer Co' }
          : null,
        status: 'succeeded',
        error: null,
        initialized: true,
      },
      subscription: {
        hasSeller: true,
        hasBuyer: true,
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
      },
    },
  })
  const pages = {
    '/session-required': <div>Session required</div>,
    '/admin/login': <div>Admin sign in</div>,
    '/login': <div>Password login</div>,
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

function GuestGate({ loginPath }) {
  const requireAuth = useRequireAuthAction()
  const run = requireAuth(() => {}, loginPath ? { loginPath } : {})
  return <button type="button" onClick={run}>Continue</button>
}

describe('remaining marketplace and admin navigation', () => {
  it('sends an unsigned subscribe-as-both click to the Authify session page', async () => {
    const user = userEvent.setup()
    const store = configureStore({
      reducer: { auth: authReducer, subscription: subscriptionReducer },
      preloadedState: {
        auth: { user: null, status: 'succeeded', error: null, initialized: true },
        subscription: {
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
        },
      },
    })
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/subscribe']}>
          <Routes>
            <Route path="/subscribe" element={<SubscribeOptionsPage />} />
            <Route path="/session-required" element={<div>Session required</div>} />
            <Route path="/login" element={<div>Password login</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    )
    await user.click(screen.getByRole('button', { name: /pay & get full access/i }))
    expect(await screen.findByText('Session required')).toBeInTheDocument()
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
  })

  it('sends buyer, seller, and portal logout to the session page', async () => {
    const user = userEvent.setup()
    const layouts = [
      ['/buyer', <BuyerLayout />],
      ['/seller', <SellerLayout />],
      ['/portal', <UserPortalLayout />],
    ]
    for (const [path, layout] of layouts) {
      const view = renderAt(layout, path)
      await user.click(screen.getByRole('button', { name: /^logout$/i }))
      expect(await screen.findByText('Session required')).toBeInTheDocument()
      expect(screen.queryByText('Password login')).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('sends admin logout to the admin login page', async () => {
    const user = userEvent.setup()
    renderAt(<AdminLayout />, '/admin')
    await user.click(screen.getByRole('button', { name: /^logout$/i }))
    expect(await screen.findByText('Admin sign in')).toBeInTheDocument()
    expect(screen.queryByText('Password login')).not.toBeInTheDocument()
    expect(screen.queryByText('Session required')).not.toBeInTheDocument()
  })

  it('defaults a gated marketplace action to the session page and keeps an admin override', async () => {
    const user = userEvent.setup()
    const marketplace = renderAt(<GuestGate />, '/products', { authenticated: false })
    await user.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText('Session required')).toBeInTheDocument()
    marketplace.unmount()

    renderAt(<GuestGate loginPath="/admin/login" />, '/admin', { authenticated: false })
    await user.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText('Admin sign in')).toBeInTheDocument()
  })

  it('does not show an admin login link or password form on the buyer/seller session page', () => {
    render(
      <MemoryRouter>
        <SessionRequiredPage />
      </MemoryRouter>,
    )
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs.some((href) => href?.includes('/admin'))).toBe(false)
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('keeps the admin login route and redirects public login and register', async () => {
    const store = configureStore({
      reducer: { auth: authReducer, subscription: subscriptionReducer },
      preloadedState: {
        auth: { user: null, status: 'idle', error: null, initialized: true },
        subscription: {
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
        },
      },
    })
    const view = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/login']}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>,
    )
    expect(await screen.findByRole('heading', { name: /open b2b from authify/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('you@company.com')).not.toBeInTheDocument()
    view.unmount()

    const registerRoute = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/register']}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>,
    )
    expect(await screen.findByRole('heading', { name: /open b2b from authify/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
    registerRoute.unmount()

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/admin/login']}>
          <AppRoutes />
        </MemoryRouter>
      </Provider>,
    )
    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('admin@b2b.local')).toBeInTheDocument()
  })
})
