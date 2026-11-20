import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from './useAuth.js'
import { setIntendedRoute } from '../utils/authStorage.js'

const DEFAULT_LOGIN_PATH = '/session-required'

/**
 * Gate an action behind authentication.
 *
 * Returns a wrapper that, when invoked:
 *   • runs the callback immediately if the user is signed in, OR
 *   • stores the intended return path + optional metadata, then redirects to
 *     `/session-required` with a friendly toast and `state.from` set to the current URL.
 *     Pass `loginPath: '/admin/login'` for an admin-only action.
 *
 * Usage:
 *   const requireAuth = useRequireAuthAction()
 *   const handleAction = requireAuth(
 *     (product) => doSomething(product),
 *     { message: 'Sign in to continue', redirectTo: '/products' },
 *   )
 *
 * Options:
 *   - message       Toast shown when redirecting.
 *   - redirectTo    Path to send the user to after login (defaults to the
 *                   current path, so they return where they were).
 *   - meta          Arbitrary JSON-safe payload persisted with the intent
 *                   (e.g. `{ productId: 'abc' }`).
 *   - loginPath     Override the login route (e.g. '/admin/login').
 */
export function useRequireAuthAction() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  return useCallback(
    (callback, options = {}) => {
      const {
        message = 'Open B2B from the Authify Main Portal to continue.',
        redirectTo,
        meta,
        loginPath = DEFAULT_LOGIN_PATH,
      } = options

      return (...args) => {
        if (isAuthenticated) {
          return callback?.(...args)
        }

        const target =
          redirectTo ||
          `${location.pathname}${location.search || ''}${location.hash || ''}`

        setIntendedRoute(target, meta)
        toast(message, { icon: 'ℹ️' })
        navigate(loginPath, { state: { from: { pathname: target } } })
        return undefined
      }
    },
    [isAuthenticated, navigate, location],
  )
}
