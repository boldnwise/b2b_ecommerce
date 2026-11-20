/**
 * useAuth and useLogoutRedirect hook tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses renderHook from @testing-library/react with a real Redux store so we
 * test the full hook behaviour without rendering a full component tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import React from 'react'

vi.mock('../services/auth.service.js', () => ({
  loginRequest:    vi.fn(),
  fetchMeRequest:  vi.fn(),
  logoutRequest:   vi.fn().mockResolvedValue(undefined),
}))

import { useAuth, useLogoutRedirect } from '../hooks/useAuth.js'
import { authReducer, login } from '../store/slices/authSlice.js'
import * as authApi from '../services/auth.service.js'

// ── Store + wrapper factory ───────────────────────────────────────────────────

const MOCK_USER = {
  id:          'hook-user-uuid',
  email:       'hook@example.com',
  role:        'BUYER',
  companyName: 'Hook Co',
}

function makeStore(preloadedUser = null) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        user:        preloadedUser,
        status:      preloadedUser ? 'succeeded' : 'idle',
        error:       null,
        initialized: Boolean(preloadedUser),
      },
    },
  })
}

function wrapper(store) {
  return function Wrapper({ children }) {
    return React.createElement(Provider, { store }, children)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// useAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('useAuth', () => {
  it('returns isAuthenticated: false when no user in store', () => {
    const store = makeStore(null)
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(store) })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('returns isAuthenticated: true when user is present in store', () => {
    const store = makeStore(MOCK_USER)
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(store) })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user).toEqual(MOCK_USER)
  })

  it('exposes status and error from auth slice', () => {
    const store = makeStore(null)
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(store) })

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('logout() dispatches logoutUser and clears user', async () => {
    authApi.logoutRequest.mockResolvedValue(undefined)
    const store = makeStore(MOCK_USER)
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(store) })

    expect(result.current.isAuthenticated).toBe(true)

    await act(async () => {
      result.current.logout()
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('reflects state changes from external login dispatch', async () => {
    authApi.loginRequest.mockResolvedValue({ user: MOCK_USER })
    const store = makeStore(null)
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(store) })

    expect(result.current.isAuthenticated).toBe(false)

    await act(async () => {
      await store.dispatch(login({ email: MOCK_USER.email, password: 'pass' }))
    })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user).toEqual(MOCK_USER)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// useLogoutRedirect
// ─────────────────────────────────────────────────────────────────────────────

describe('useLogoutRedirect', () => {
  it('returns a function that clears Redux auth state on call', async () => {
    authApi.logoutRequest.mockResolvedValue(undefined)
    const store = makeStore(MOCK_USER)
    const { result } = renderHook(() => useLogoutRedirect(), { wrapper: wrapper(store) })

    expect(store.getState().auth.user).toEqual(MOCK_USER)

    await act(async () => {
      result.current()
    })

    expect(store.getState().auth.user).toBeNull()
  })
})
