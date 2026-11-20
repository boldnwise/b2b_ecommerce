import { api } from './api.js'
import { throwFriendly } from '../utils/apiError.js'

export async function loginRequest({ email, password }) {
  try {
    const { data } = await api.post('/auth/login', { email, password })
    if (!data.success) throw new Error(data.error?.message || 'Login failed')
    // Server sets the httpOnly auth cookie; only user object is returned in body.
    return data.data
  } catch (e) {
    throwFriendly(e, 'Login failed')
  }
}

export async function fetchMeRequest() {
  try {
    const { data } = await api.get('/auth/me')
    if (!data.success) throw new Error('Not authenticated')
    return data.data.user
  } catch (e) {
    throwFriendly(e, 'Not authenticated')
  }
}

/**
 * Ask the server to clear the auth cookie. Fire-and-forget — the UI should
 * clear Redux state regardless of whether the network call succeeds.
 */
export async function logoutRequest() {
  try {
    await api.post('/auth/logout')
  } catch {
    /* Best-effort. Swallow network errors — the cookie will expire naturally. */
  }
}
