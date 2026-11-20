import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { HomeMarketingNav } from '../../components/common/HomeMarketingNav.jsx'
import { formatInr, getPlanAmounts, useMarketingPricing } from '../../utils/marketingPricing.js'
import { useAppSelector, useAppDispatch } from '../../hooks/redux.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useRazorpayCheckout } from '../../hooks/useRazorpayCheckout.js'
import {
  selectHasBuyerSubscription,
  selectHasSellerSubscription,
  selectBuyerPlanType,
  selectSellerPlanType,
  loadSubscriptionStatus,
} from '../../store/slices/subscriptionSlice.js'
import { PaymentCancelledNotice } from '../../components/common/PaymentCancelledNotice.jsx'

const PRICING_PAGE_HTML_CLASS = 'isPricingPlansPage'

const PLAN_TABS = [
  { id: 'buyer', label: 'Buyer' },
  { id: 'seller', label: 'Seller' },
  { id: 'both', label: 'Both', badge: 'Best Value' },
]

function FeatureComparisonTable({ activeRole }) {
  const isSeller = activeRole === 'seller'
  const isBoth = activeRole === 'both'

  const dealFeeMonthly = isSeller ? '4.0%' : isBoth ? '3.5%' : '5.0%'
  const dealFeeAnnual = isSeller ? '3.0%' : isBoth ? '2.5%' : '4.0%'
  const dealFeeLifetime = isSeller ? '2.0%' : isBoth ? '1.5%' : '3.0%'

  return (
    <div className="pricingV2__compare">
      <h3 className="pricingV2__compareTitle">Plan Feature Matrix & Comparison</h3>
      <p className="pricingV2__compareSub">
        Compare features, limits, and platform transaction fees across subscription tiers.
      </p>

      <div className="pricingV2__compareTableWrap">
        <table className="pricingV2__compareTable">
          <thead>
            <tr>
              <th>Feature / Benefit</th>
              <th style={{ textAlign: 'center', color: '#2563eb' }}>Monthly Tier</th>
              <th style={{ textAlign: 'center', color: '#16a34a' }}>Annual Tier</th>
              <th style={{ textAlign: 'center', color: '#9333ea' }}>Lifetime Tier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Billing Cycle</td>
              <td style={{ textAlign: 'center' }}>Monthly Auto-Renewal</td>
              <td style={{ textAlign: 'center' }}>Billed Annually</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: '#9333ea' }}>One-Time Payment</td>
            </tr>
            <tr>
              <td>Platform Deal Charge Rate</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{dealFeeMonthly}</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>{dealFeeAnnual}</td>
              <td style={{ textAlign: 'center', fontWeight: 800, color: '#9333ea' }}>{dealFeeLifetime}</td>
            </tr>
            <tr>
              <td>RFQ & Catalog Access</td>
              <td style={{ textAlign: 'center' }}>Unlimited</td>
              <td style={{ textAlign: 'center' }}>Unlimited</td>
              <td style={{ textAlign: 'center' }}>Unlimited</td>
            </tr>
            <tr>
              <td>Supplier Contact Unlocking</td>
              <td style={{ textAlign: 'center' }}>Upon Dual Payment</td>
              <td style={{ textAlign: 'center' }}>Upon Dual Payment</td>
              <td style={{ textAlign: 'center' }}>Upon Dual Payment</td>
            </tr>
            <tr>
              <td>Support SLA</td>
              <td style={{ textAlign: 'center' }}>Standard Email</td>
              <td style={{ textAlign: 'center' }}>Priority Response</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: '#9333ea' }}>VIP Dedicated Support</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PricingCard3D({
  title,
  price,
  period,
  description,
  features,
  dealFee,
  badge,
  isPopular,
  isActive,
  loading,
  onSubscribe,
}) {
  return (
    <article className={`pricingV2__card${isPopular ? ' pricingV2__card--popular' : ''}`}>
      {badge ? <span className="pricingV2__badge">{badge}</span> : null}

      <div className="pricingV2__cardBody">
        <h3 className="pricingV2__cardTitle">{title}</h3>
        <p className="pricingV2__cardDesc">{description}</p>

        <div className="pricingV2__priceRow">
          <span className="pricingV2__price">{price}</span>
          <span className="pricingV2__period">{period}</span>
        </div>

        <div className="pricingV2__dealFee">
          <span>Deal Charge Rate</span>
          <strong>{dealFee}</strong>
        </div>

        <ul className="pricingV2__features">
          {features.map((feat) => (
            <li key={feat} className="pricingV2__feature">
              <span className="pricingV2__featureMark" aria-hidden>✓</span>
              <span>{feat}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className={`pricingV2__cta ${isPopular ? 'pricingV2__cta--primary' : 'pricingV2__cta--dark'}`}
          disabled={isActive || loading}
          onClick={onSubscribe}
        >
          {isActive ? 'Current Plan Active' : loading ? 'Opening Payment…' : 'Subscribe Now →'}
        </button>
      </div>
    </article>
  )
}

export function PricingPlansPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const marketingPricing = useMarketingPricing()
  const amounts = useMemo(() => getPlanAmounts(marketingPricing), [marketingPricing])
  const { user, isAuthenticated, initialized } = useAuth()
  const { startCheckout, loadingPlan } = useRazorpayCheckout()
  const [paymentCancelled, setPaymentCancelled] = useState(false)
  const [lastPlanKey, setLastPlanKey] = useState(null)

  const [activePlan, setActivePlan] = useState('buyer')

  const hasBuyer = useAppSelector(selectHasBuyerSubscription)
  const hasSeller = useAppSelector(selectHasSellerSubscription)
  const buyerPlanType = useAppSelector(selectBuyerPlanType)
  const sellerPlanType = useAppSelector(selectSellerPlanType)

  const buyerMonthlyActive = hasBuyer && buyerPlanType === 'BUYER_MONTHLY'
  const buyerAnnualActive = hasBuyer && (buyerPlanType === 'BUYER_ANNUAL' || buyerPlanType === 'BUYER_STANDARD')
  const buyerLifetimeActive = hasBuyer && buyerPlanType === 'BUYER_LIFETIME'

  const sellerMonthlyActive = hasSeller && (sellerPlanType === 'SELLER_MONTHLY' || sellerPlanType === 'SELLER_MONTH')
  const sellerAnnualActive = hasSeller && sellerPlanType === 'SELLER_ANNUAL'
  const sellerLifetimeActive = hasSeller && sellerPlanType === 'SELLER_LIFETIME'

  const openRazorpay = useCallback(
    (planKey) => {
      if (!initialized) return
      if (!isAuthenticated) {
        navigate('/session-required', { state: { from: { pathname: '/pricing' } } })
        return
      }
      setPaymentCancelled(false)
      setLastPlanKey(planKey)
      startCheckout({
        plan: planKey,
        user,
        onSuccess: () => {
          toast.success('Subscription activated successfully!')
          if (planKey.startsWith('SELLER_')) navigate('/seller/dashboard')
          else if (planKey.startsWith('BOTH_')) navigate('/buyer/dashboard')
          else navigate('/buyer/dashboard')
        },
        onCancelled: () => setPaymentCancelled(true),
        onError: (msg) => toast.error(msg),
      })
    },
    [initialized, isAuthenticated, navigate, startCheckout, user],
  )

  useEffect(() => {
    if (isAuthenticated) dispatch(loadSubscriptionStatus())
  }, [dispatch, isAuthenticated])

  useEffect(() => {
    document.documentElement.classList.add(PRICING_PAGE_HTML_CLASS)
    return () => document.documentElement.classList.remove(PRICING_PAGE_HTML_CLASS)
  }, [])

  return (
    <div className="subPage subPage--pricing">
      <HomeMarketingNav tagline="Plans & Pricing" />

      {paymentCancelled ? (
        <main className="subMain" style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
          <PaymentCancelledNotice
            onTryAgain={() => lastPlanKey && openRazorpay(lastPlanKey)}
            backTo="/pricing"
            backLabel="Back"
          />
        </main>
      ) : (

      <main className="subMain pricingPlans">
        <header className="pricingV2__header">
          <span className="pricingV2__eyebrow">Subscription Plans</span>
          <h1 className="pricingV2__title">Choose your plan</h1>
          <p className="pricingV2__subtitle">
            Choose the subscription tier that matches your business model. Dynamic deal charges apply automatically.
          </p>
        </header>

        <div className="pricingV2__tabs" role="tablist" aria-label="Pricing plan categories">
          {PLAN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activePlan === tab.id}
              className={`pricingV2__tab${activePlan === tab.id ? ' pricingV2__tab--active' : ''}`}
              onClick={() => setActivePlan(tab.id)}
            >
              {tab.label}
              {tab.badge ? <span className="pricingV2__tabBadge">{tab.badge}</span> : null}
            </button>
          ))}
        </div>

        <div className="pricingV2__grid">
          {activePlan === 'buyer' ? (
            <>
              <PricingCard3D
                title="Buyer Monthly"
                price={marketingPricing.buyerMonthly || formatInr(amounts.buyerMonthly ?? amounts.buyerAnnual)}
                period="/ month"
                description="Flexible monthly procurement membership for active buyers."
                dealFee="5.0%"
                features={['Unlimited RFQs', 'Multi-Seller Compare', 'Standard Support', 'Monthly Cancel Anytime']}
                isActive={buyerMonthlyActive}
                loading={loadingPlan === 'BUYER_MONTHLY'}
                onSubscribe={() => openRazorpay('BUYER_MONTHLY')}
              />
              <PricingCard3D
                title="Buyer Annual"
                price={marketingPricing.buyerAnnual || formatInr(amounts.buyerAnnual)}
                period="/ year"
                description="Annual procurement access with reduced platform deal fees."
                dealFee="4.0%"
                badge="Most Popular"
                isPopular
                features={['Unlimited RFQs', 'Reduced Deal Charge (4%)', 'Priority Seller Response', 'Verified Buyer Badge']}
                isActive={buyerAnnualActive}
                loading={loadingPlan === 'BUYER_ANNUAL' || loadingPlan === 'BUYER_STANDARD'}
                onSubscribe={() => openRazorpay('BUYER_ANNUAL')}
              />
              <PricingCard3D
                title="Buyer Lifetime"
                price={marketingPricing.buyerLifetime || formatInr(amounts.buyerLifetime)}
                period="one-time"
                description="Permanent buyer access with the lowest transaction charges."
                dealFee="3.0%"
                badge="Best Value"
                features={['Permanent Lifetime Access', 'Lowest Buyer Fee (3%)', 'VIP Support SLA', 'Zero Renewal Fees']}
                isActive={buyerLifetimeActive}
                loading={loadingPlan === 'BUYER_LIFETIME'}
                onSubscribe={() => openRazorpay('BUYER_LIFETIME')}
              />
            </>
          ) : null}

          {activePlan === 'seller' ? (
            <>
              <PricingCard3D
                title="Seller Monthly"
                price={marketingPricing.sellerMonthly || formatInr(amounts.sellerMonthly ?? amounts.sellerAnnual)}
                period="/ month"
                description="Monthly seller tools for catalog listings and order management."
                dealFee="4.0%"
                features={['Unlimited Listings', 'RFQ Inquiries', 'Standard Support', 'Monthly Billing']}
                isActive={sellerMonthlyActive}
                loading={loadingPlan === 'SELLER_MONTHLY' || loadingPlan === 'SELLER_MONTH'}
                onSubscribe={() => openRazorpay('SELLER_MONTHLY')}
              />
              <PricingCard3D
                title="Seller Annual"
                price={marketingPricing.sellerAnnual || formatInr(amounts.sellerAnnual)}
                period="/ year"
                description="Annual seller access with priority search placement and lower fees."
                dealFee="3.0%"
                badge="Most Popular"
                isPopular
                features={['Unlimited Listings', 'Lower Deal Charge (3%)', 'Priority Search Boost', 'Verified Seller Badge']}
                isActive={sellerAnnualActive}
                loading={loadingPlan === 'SELLER_ANNUAL'}
                onSubscribe={() => openRazorpay('SELLER_ANNUAL')}
              />
              <PricingCard3D
                title="Seller Lifetime"
                price={marketingPricing.sellerLifetime || formatInr(amounts.sellerLifetime)}
                period="one-time"
                description="Permanent seller access with zero recurring fees and lowest rate."
                dealFee="2.0%"
                badge="Best Value"
                features={['Permanent Lifetime Access', 'Lowest Seller Fee (2%)', 'VIP Supplier Badge', 'Zero Renewal Fees']}
                isActive={sellerLifetimeActive}
                loading={loadingPlan === 'SELLER_LIFETIME'}
                onSubscribe={() => openRazorpay('SELLER_LIFETIME')}
              />
            </>
          ) : null}

          {activePlan === 'both' ? (
            <>
              <PricingCard3D
                title="Both Monthly"
                price={marketingPricing.bothMonthly || formatInr(amounts.bothStandardMonth)}
                period="/ month"
                description="Full dual marketplace access on flexible monthly terms."
                dealFee="3.5%"
                features={['Dual Buying & Selling', 'Combined Dashboard', 'Standard Support', 'Monthly Cancel Anytime']}
                loading={loadingPlan === 'BOTH_MONTHLY' || loadingPlan === 'BOTH_STANDARD_MONTH'}
                onSubscribe={() => openRazorpay('BOTH_MONTHLY')}
              />
              <PricingCard3D
                title="Both Annual"
                price={marketingPricing.bothAnnual || formatInr(amounts.bothAnnual ?? amounts.bothStandardLifetime)}
                period="/ year"
                description="Full dual membership for 1 year at a bundled discount."
                dealFee="2.5%"
                badge="Most Popular"
                isPopular
                features={['Full Marketplace Access', 'Reduced Deal Charge (2.5%)', 'Priority Support', 'Bundled Discount']}
                loading={loadingPlan === 'BOTH_ANNUAL'}
                onSubscribe={() => openRazorpay('BOTH_ANNUAL')}
              />
              <PricingCard3D
                title="Both Lifetime"
                price={marketingPricing.bothLifetime || formatInr(amounts.bothLifetimeLifetime)}
                period="one-time"
                description="Ultimate one-time dual membership for permanent marketplace access."
                dealFee="1.5%"
                badge="Ultimate Value"
                features={['Permanent Dual Access', 'Lowest Deal Charge (1.5%)', 'VIP Marketplace Badge', 'Zero Renewal Fees']}
                loading={loadingPlan === 'BOTH_LIFETIME' || loadingPlan === 'BOTH_LIFETIME_LIFETIME'}
                onSubscribe={() => openRazorpay('BOTH_LIFETIME')}
              />
            </>
          ) : null}
        </div>

        <FeatureComparisonTable activeRole={activePlan} />

        <footer className="pricingV2__foot">
          <Link to="/" className="pricingV2__homeLink">← Back to Home</Link>
        </footer>
      </main>
      )}
    </div>
  )
}
