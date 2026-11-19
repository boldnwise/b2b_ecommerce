import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { HomeMarketingNav } from '../../components/common/HomeMarketingNav.jsx'
import { PaymentCancelledNotice } from '../../components/common/PaymentCancelledNotice.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { useRazorpayCheckout } from '../../hooks/useRazorpayCheckout.js'
import {
  bothBundlePlanId,
  dashboardAfterBothComplete,
} from '../../utils/bothSubscribeFlow.js'

export function SubscribeOptionsPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const { startCheckout, loading } = useRazorpayCheckout()
  const [paymentCancelled, setPaymentCancelled] = useState(false)

  function subscribeAsBoth() {
    const bundlePlan = bothBundlePlanId({ sellerPlan: 'month', buyerPlan: 'standard' })
    if (!isAuthenticated) {
      navigate('/session-required', { state: { from: { pathname: '/subscribe' } } })
      return
    }
    startCheckout({
      plan: bundlePlan,
      user,
      onSuccess: () => {
        toast.success('Full access activated — you can buy and sell now!')
        navigate(dashboardAfterBothComplete(user?.role), { replace: true })
      },
      onCancelled: () => setPaymentCancelled(true),
      onError: (msg) => toast.error(msg),
    })
  }

  if (paymentCancelled) {
    return (
      <div className="subPage">
        <HomeMarketingNav tagline="Choose your access" />
        <main className="subMain" style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
          <PaymentCancelledNotice
            onTryAgain={subscribeAsBoth}
            backTo="/subscribe"
            backLabel="Back"
          />
        </main>
      </div>
    )
  }

  return (
    <div className="subPage">
      <HomeMarketingNav tagline="Choose your access" />

      <main className="subMain homeSubscribe">
        <div className="homeSubscribe__intro">
          <p className="subEyebrow">Choose your plan</p>
          <h1 className="subHero__title">How do you want to use the marketplace?</h1>
          <p className="subHero__lead">
            Buyers pay once; sellers choose 1 month or lifetime. For both, one secure
            payment unlocks every tool on your account.
          </p>
        </div>

        <div className="homeSubscribe__grid">
          <button
            type="button"
            className="homeSubscribe__card"
            onClick={() => navigate('/pricing')}
          >
            <span className="homeSubscribe__cardTag">Procurement</span>
            <h2 className="homeSubscribe__cardTitle">Subscribe as a buyer</h2>
            <p className="homeSubscribe__cardText">
              Source suppliers, browse the catalog, and manage orders in
              one place.
            </p>
            <span className="homeSubscribe__cardCta">Continue →</span>
          </button>

          <button
            type="button"
            className="homeSubscribe__card"
            onClick={() => navigate('/pricing')}
          >
            <span className="homeSubscribe__cardTag">Supply</span>
            <h2 className="homeSubscribe__cardTitle">Subscribe as a seller</h2>
            <p className="homeSubscribe__cardText">
              List products, manage listings, respond to RFQs, and track B2B deals.
            </p>
            <span className="homeSubscribe__cardCta">Continue →</span>
          </button>

          <button
            type="button"
            className="homeSubscribe__card homeSubscribe__card--both"
            onClick={subscribeAsBoth}
            disabled={loading}
          >
            <span className="homeSubscribe__cardTag homeSubscribe__cardTag--both">
              Full access
            </span>
            <h2 className="homeSubscribe__cardTitle">Subscribe as both</h2>
            <p className="homeSubscribe__cardText">
              Pay once with secure checkout and get buyer + seller access on the same account.
            </p>
            <span className="homeSubscribe__cardCta">
              {loading ? 'Opening payment…' : 'Pay & get full access →'}
            </span>
          </button>
        </div>

        <p className="homeSubscribe__foot">
          <Link to="/pricing">Compare all both plans</Link>
          {' · '}
          <Link to="/">Back to home</Link>
        </p>
      </main>
    </div>
  )
}
