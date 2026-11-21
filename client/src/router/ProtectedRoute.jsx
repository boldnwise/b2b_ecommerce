import { useEffect, useRef } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'
import { useAppDispatch, useAppSelector } from '../hooks/redux.js'
import {
  loadSubscriptionStatus,
  selectHasBuyerSubscription,
  selectHasSellerSubscription,
  selectSubscriptionStatus,
} from '../store/slices/subscriptionSlice.js'
import { PageLoader } from '../components/ui/PageLoader.jsx'
import {
  PORTAL_HOME,
  canAccessBuyerWorkspace,
  canAccessSellerWorkspace,
  roleDashboardPath,
} from '../utils/portalNav.js'
import {
  hasSubscriptionEntitlement,
  isSubscriptionStatusPending,
} from '../utils/subscriptionEntitlement.js'
import { setIntendedRoute } from '../utils/authStorage.js'

/**
 * Resolve the landing path for a role — used after guest redirects.
 */
function dashboardForRole(role) {
  if (role === 'ADMIN') return '/admin'
  return roleDashboardPath(role) || PORTAL_HOME
}

function needsSubscriptionLoad(user, workspace, subscription) {
  if (!user || user.role === 'ADMIN') return false
  return Boolean(workspace || subscription)
}

function SubscriptionExpiredOverlay() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem 2rem',
      textAlign: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(12px)',
      borderRadius: '16px',
      border: '1px solid rgba(229, 231, 235, 1)',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      maxWidth: '32rem',
      margin: '4rem auto',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        width: '4rem',
        height: '4rem',
        backgroundColor: '#FEF2F2',
        color: '#EF4444',
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '1.5rem'
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '2rem', height: '2rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#111827', marginBottom: '0.5rem' }}>Subscription Expired</h2>
      <p style={{ color: '#4B5563', marginBottom: '2rem', fontSize: '1rem', lineHeight: '1.5' }}>
        Your subscription has expired. Please renew your subscription to continue.
      </p>
      <a
        href="/pricing"
        style={{
          padding: '0.75rem 2rem',
          backgroundColor: '#4F46E5',
          color: '#FFFFFF',
          borderRadius: '8px',
          fontWeight: '500',
          textDecoration: 'none',
          boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2)',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#4338CA' }}
        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#4F46E5' }}
      >
        Renew Subscription
      </a>
    </div>
  )
}

/**
 * Single, composable route guard. Replaces per-concern guards.
 *
 * guestOnlyRedirectRoles: with guestOnly, only these signed-in roles are redirected;
 * other signed-in roles see the page. Omit it to redirect every signed-in user.
 */
export function ProtectedRoute({
  children,
  requireAuth = true,
  roles,
  workspace,
  subscription,
  guestOnly = false,
  guestOnlyRedirectRoles,
  redirectTo,
}) {
  const location = useLocation()
  const dispatch = useAppDispatch()
  const { user, initialized, isAuthenticated } = useAuth()
  const hasBuyerSub = useAppSelector(selectHasBuyerSubscription)
  const hasSellerSub = useAppSelector(selectHasSellerSubscription)
  const subscriptionStatus = useAppSelector(selectSubscriptionStatus)
  const loadDispatched = useRef(false)

  useEffect(() => {
    loadDispatched.current = false
  }, [user?.id])

  useEffect(() => {
    if (!isAuthenticated || !user) return
    if (!needsSubscriptionLoad(user, workspace, subscription)) return
    if (subscriptionStatus !== 'idle') return
    if (loadDispatched.current) return
    loadDispatched.current = true
    dispatch(loadSubscriptionStatus())
  }, [
    dispatch,
    isAuthenticated,
    user,
    workspace,
    subscription,
    subscriptionStatus,
  ])

  if (!initialized) {
    return <PageLoader label="Loading session" />
  }

  if (guestOnly) {
    const redirectsRole = !guestOnlyRedirectRoles || guestOnlyRedirectRoles.includes(user?.role)
    if (isAuthenticated && user && redirectsRole) {
      return <Navigate to={redirectTo || dashboardForRole(user.role)} replace />
    }
    return children
  }

  if (requireAuth && !isAuthenticated) {
    const intended = `${location.pathname}${location.search || ''}${location.hash || ''}`
    setIntendedRoute(intended)
    return (
      <Navigate
        to={redirectTo || '/session-required'}
        state={{ from: { pathname: intended } }}
        replace
      />
    )
  }

  const awaitingSubscription =
    isAuthenticated &&
    user &&
    needsSubscriptionLoad(user, workspace, subscription) &&
    isSubscriptionStatusPending(subscriptionStatus)

  if (awaitingSubscription) {
    return <PageLoader label="Loading subscription" />
  }

  if (workspace === 'buyer' && user && !canAccessBuyerWorkspace(user.role, hasBuyerSub)) {
    return <Navigate to="/pricing" replace state={{ from: location, reason: 'subscription' }} />
  }

  if (workspace === 'seller' && user && !canAccessSellerWorkspace(user.role, hasSellerSub)) {
    return <Navigate to="/pricing" replace state={{ from: location, reason: 'subscription' }} />
  }

  if (roles?.length && user && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace state={{ from: location }} />
  }

  if (subscription) {
    const entitled = hasSubscriptionEntitlement(subscription, {
      hasBuyer: hasBuyerSub,
      hasSeller: hasSellerSub,
      status: subscriptionStatus,
    })
    if (entitled === false) {
      return <SubscriptionExpiredOverlay />
    }
  }

  return children
}
