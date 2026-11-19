/**
 * authSlice Redux unit tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the reducer and thunks in isolation — no real network calls.
 * The auth service module is mocked so we control what loginRequest,
 * fetchMeRequest and logoutRequest return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'

// Mock the service layer before importing the slice
vi.mock('../services/auth.service.js', () => ({
  loginRequest:    vi.fn(),
  fetchMeRequest:  vi.fn(),
  logoutRequest:   vi.fn().mockResolvedValue(undefined),
}))

import {
  authReducer,
  login,
  initializeAuth,
  logoutUser,
  logout,
  clearError,
} from '../store/slices/authSlice.js'
import * as authApi from '../services/auth.service.js'

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } })
}

const MOCK_USER = {
  id:          'user-test-uuid',
  email:       'test@example.com',
  role:        'BUYER',
  companyName: 'Test Co',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────

describe('authSlice – initial state', () => {
  it('starts with no user and idle status', () => {
    const store = makeStore()
    const state = store.getState().auth

    expect(state.user).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.error).toBeNull()
    expect(state.initialized).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous actions
// ─────────────────────────────────────────────────────────────────────────────

describe('authSlice – synchronous actions', () => {
  it('logout clears the user', () => {
    const store = makeStore()
    // Seed a user into the store
    store.dispatch({ type: 'auth/login/fulfilled', payload: MOCK_USER })
    expect(store.getState().auth.user).toEqual(MOCK_USER)

    store.dispatch(logout())
    expect(store.getState().auth.user).toBeNull()
    expect(store.getState().auth.error).toBeNull()
  })

  it('clearError nullifies the error field', () => {
    const store = makeStore()
    store.dispatch({ type: 'auth/login/rejected', payload: 'Bad creds' })
    expect(store.getState().auth.error).toBe('Bad creds')

    store.dispatch(clearError())
    expect(store.getState().auth.error).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// initializeAuth thunk
// ─────────────────────────────────────────────────────────────────────────────

describe('initializeAuth thunk', () => {
  it('fulfilled – sets user and marks initialized', async () => {
    authApi.fetchMeRequest.mockResolvedValue(MOCK_USER)
    const store = makeStore()

    await store.dispatch(initializeAuth())
    const state = store.getState().auth

    expect(state.user).toEqual(MOCK_USER)
    expect(state.initialized).toBe(true)
    expect(state.status).toBe('succeeded')
  })

  it('rejected (401 from server) – marks initialized with no user', async () => {
    authApi.fetchMeRequest.mockRejectedValue(new Error('Not authenticated'))
    const store = makeStore()

    await store.dispatch(initializeAuth())
    const state = store.getState().auth

    expect(state.user).toBeNull()
    expect(state.initialized).toBe(true)
    expect(state.status).toBe('succeeded') // rejected maps to 'succeeded' + user:null
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// login thunk
// ─────────────────────────────────────────────────────────────────────────────

describe('login thunk', () => {
  it('fulfilled – stores user and clears error', async () => {
    authApi.loginRequest.mockResolvedValue({ user: MOCK_USER })
    const store = makeStore()

    await store.dispatch(login({ email: 'test@example.com', password: 'pass' }))
    const state = store.getState().auth

    expect(state.user).toEqual(MOCK_USER)
    expect(state.error).toBeNull()
    expect(state.status).toBe('succeeded')
  })

  it('rejected – stores error message, user stays null', async () => {
    authApi.loginRequest.mockRejectedValue(new Error('Invalid email or password'))
    const store = makeStore()

    await store.dispatch(login({ email: 'bad@example.com', password: 'wrong' }))
    const state = store.getState().auth

    expect(state.user).toBeNull()
    expect(state.error).toBeTruthy()
    expect(state.status).toBe('failed')
  })

  it('pending – sets status to loading', () => {
    // Dispatch the pending action directly
    const store = makeStore()
    store.dispatch({ type: 'auth/login/pending' })

    expect(store.getState().auth.status).toBe('loading')
    expect(store.getState().auth.error).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// logoutUser thunk
// ─────────────────────────────────────────────────────────────────────────────

describe('logoutUser thunk', () => {
  it('fulfilled – clears user and resets to idle', async () => {
    authApi.logoutRequest.mockResolvedValue(undefined)
    const store = makeStore()
    // Seed user first
    store.dispatch({ type: 'auth/login/fulfilled', payload: MOCK_USER })

    await store.dispatch(logoutUser())
    const state = store.getState().auth

    expect(state.user).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.error).toBeNull()
  })

  it('rejected (network fail) – still clears user (best-effort)', async () => {
    authApi.logoutRequest.mockRejectedValue(new Error('Network error'))
    const store = makeStore()
    store.dispatch({ type: 'auth/login/fulfilled', payload: MOCK_USER })

    await store.dispatch(logoutUser())

    // Even if the network call fails, local state must be cleared
    expect(store.getState().auth.user).toBeNull()
    expect(store.getState().auth.status).toBe('idle')
  })
})
