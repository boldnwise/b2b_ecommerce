import { Provider, useDispatch } from 'react-redux'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { store } from '../store/index.js'
import { setUnauthorizedHandler } from '../services/api.js'
import { logout } from '../store/slices/authSlice.js'

/**
 * Registers the global 401 handler once. When the server rejects a request
 * with 401 (outside of login, register, logout, and /auth/me), this:
 *   1. Clears Redux auth state immediately
 *   2. Tells the user the session ended
 *   3. Sends marketplace pages to /session-required and admin pages to /admin/login
 *
 * The cookie and JWT checks stay in place. Navigation stays here because
 * `useNavigate` must run inside the Router tree.
 */
function ApiAuthBridge() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  useEffect(() => {
    setUnauthorizedHandler(() => {
      dispatch(logout())
      const onAdmin = pathRef.current.startsWith('/admin')
      if (onAdmin) {
        toast.error('Session expired — please sign in again.')
        navigate('/admin/login', { replace: true })
        return
      }
      toast.error('Your B2B session ended. Open B2B again from the Authify Main Portal.')
      navigate('/session-required', { replace: true })
    })
    return () => setUnauthorizedHandler(() => {})
  }, [dispatch, navigate])

  return null
}

export function AppProviders({ children }) {
  return (
    <Provider store={store}>
      <ApiAuthBridge />
      {children}
      <Toaster
        position="top-center"
        gutter={12}
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '10px',
            fontSize: '14px',
            boxShadow: 'var(--shadow-lift-sm, 0 6px 16px rgba(15,23,42,0.12))',
          },
        }}
      />
    </Provider>
  )
}
