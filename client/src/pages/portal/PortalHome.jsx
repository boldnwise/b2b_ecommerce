import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth.js'
import { useAppDispatch, useAppSelector } from '../../hooks/redux.js'
import {
  loadSubscriptionStatus,
  selectHasBuyerSubscription,
  selectHasSellerSubscription,
  selectSubscriptionError,
  selectSubscriptionStatus,
} from '../../store/slices/subscriptionSlice.js'

/**
 * Destination after a B2B session exists and subscription status has loaded.
 * Buyer is preferred when both subscriptions are active. Role alone is not a subscription.
 */
export function subscriptionLandingPath({ hasBuyer = false, hasSeller = false } = {}) {
  if (hasBuyer) return '/buyer/dashboard'
  if (hasSeller) return '/seller/dashboard'
  return '/pricing'
}

export function PortalHome() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { user, initialized } = useAuth()
  const hasBuyerSub = useAppSelector(selectHasBuyerSubscription)
  const hasSellerSub = useAppSelector(selectHasSellerSubscription)
  const status = useAppSelector(selectSubscriptionStatus)
  const error = useAppSelector(selectSubscriptionError)

  useEffect(() => {
    if (!initialized || !user) return
    if (status !== 'idle') return
    dispatch(loadSubscriptionStatus())
  }, [dispatch, initialized, status, user])

  useEffect(() => {
    if (!initialized || !user) return
    if (status !== 'succeeded') return
    navigate(
      subscriptionLandingPath({ hasBuyer: hasBuyerSub, hasSeller: hasSellerSub }),
      { replace: true },
    )
  }, [hasBuyerSub, hasSellerSub, initialized, navigate, status, user])

  if (status === 'failed') {
    return (
      <div className="sellerDashboard">
        <h1 className="sellerDashboard__greeting">Subscription status unavailable</h1>
        <p className="sellerDashboard__sub">
          {error || 'Your session is still active. We could not confirm your plan, so you were not redirected.'}
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => dispatch(loadSubscriptionStatus())}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="sellerDashboard">
      <p className="sellerDashboard__sub">Checking your subscription…</p>
    </div>
  )
}
