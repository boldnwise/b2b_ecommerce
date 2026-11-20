import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../services/auth.service.js', () => ({
  loginRequest: vi.fn(),
  fetchMeRequest: vi.fn(),
  logoutRequest: vi.fn().mockResolvedValue(undefined),
}))

import { AdminLogin } from '../pages/admin/AdminLogin.jsx'
import { authReducer } from '../store/slices/authSlice.js'
import * as authApi from '../services/auth.service.js'

function renderAdminLogin() {
  const store = configureStore({ reducer: { auth: authReducer } })
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<div>Admin dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return store
}

async function submit(user) {
  await user.type(screen.getByPlaceholderText('admin@b2b.local'), 'someone@example.com')
  await user.type(screen.getByPlaceholderText('••••••••'), 'CorrectPassword1!')
  await user.click(screen.getByRole('button', { name: 'Login' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminLogin', () => {
  it('signs an admin in and opens the admin dashboard', async () => {
    authApi.loginRequest.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
    })
    const user = userEvent.setup()
    renderAdminLogin()

    await submit(user)

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(authApi.logoutRequest).not.toHaveBeenCalled()
  })

  it('shows the API refusal for a buyer or seller and stays on the admin form', async () => {
    authApi.loginRequest.mockRejectedValue(
      new Error('Buyer and seller accounts sign in through the Authify Main Portal.'),
    )
    const user = userEvent.setup()
    const store = renderAdminLogin()

    await submit(user)

    expect(await screen.findByText(/sign in through the authify main portal/i)).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
    expect(store.getState().auth.user).toBeNull()
  })

  it('signs out a non-admin session instead of keeping it', async () => {
    authApi.loginRequest.mockResolvedValue({
      user: { id: 'buyer-1', email: 'buyer@example.com', role: 'BUYER' },
    })
    const user = userEvent.setup()
    const store = renderAdminLogin()

    await submit(user)

    await vi.waitFor(() => expect(authApi.logoutRequest).toHaveBeenCalledTimes(1))
    expect(store.getState().auth.user).toBeNull()
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
  })

  it('does not show demo credentials', () => {
    renderAdminLogin()
    expect(screen.queryByText(/demo admin/i)).not.toBeInTheDocument()
  })
})
