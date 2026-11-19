import { useCallback } from 'react'
import { logout, logoutUser } from '../store/slices/authSlice.js'
import { useAppDispatch, useAppSelector } from './redux.js'

export function useAuth() {
  const dispatch = useAppDispatch()
  const auth = useAppSelector((s) => s.auth)

  /**
   * Clears the server-side cookie via POST /auth/logout then wipes Redux
   * state. Safe to call even when the session is already expired.
   */
  const logoutAndClear = useCallback(() => {
    dispatch(logoutUser())
  }, [dispatch])

  return {
    user: auth.user,
    status: auth.status,
    error: auth.error,
    initialized: auth.initialized,
    isAuthenticated: Boolean(auth.user),
    logout: logoutAndClear,
  }
}

/**
 * Returns a logout function that clears the server cookie + Redux state.
 * Navigation is intentionally left to the caller. Marketplace layouts go to
 * `/session-required`. The admin layout goes to `/admin/login`.
 */
export function useLogoutRedirect() {
  const dispatch = useAppDispatch()

  return useCallback(() => {
    dispatch(logoutUser())
  }, [dispatch])
}

/**
 * Synchronous logout action — exported for ApiAuthBridge which needs to
 * clear Redux state immediately on 401 without waiting for a network call.
 */
export { logout as logoutAction } from '../store/slices/authSlice.js'
