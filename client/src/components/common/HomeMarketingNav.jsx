import { Link } from 'react-router-dom'
import { BrandLogo } from './BrandLogo.jsx'
import { MyDashboardMenu } from './MyDashboardMenu.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { useAppSelector } from '../../hooks/redux.js'
import { selectHasSellerSubscription } from '../../store/slices/subscriptionSlice.js'
import { canAccessSellerWorkspace } from '../../utils/portalNav.js'

export function HomeMarketingNav({ tagline = 'Procurement & supply' }) {
  const { user, initialized, isAuthenticated } = useAuth()
  const hasSellerSub = useAppSelector(selectHasSellerSubscription)
  const showSellerCatalog =
    isAuthenticated && canAccessSellerWorkspace(user?.role, hasSellerSub)

  return (
    <header className="subNav">
      <Link to="/" className="subNav__brand homeNav__brandLink">
        <BrandLogo size="nav" className="subNav__logo" />
        <span className="subNav__brandText">
          <span className="subNav__brandName">B2B Marketplace</span>
          <span className="subNav__brandTag">{tagline}</span>
        </span>
      </Link>
      <nav className="subNav__links" aria-label="Primary">
        <Link to="/" className="subNav__link">
          Home
        </Link>
        {showSellerCatalog ? (
          <Link to="/seller/products" className="subNav__link">
            Product listing
          </Link>
        ) : (
          <Link to="/products" className="subNav__link">
            Product
          </Link>
        )}
        <Link to="/pricing" className="subNav__link">
          Pricing
        </Link>
        {initialized && isAuthenticated ? <MyDashboardMenu /> : null}
      </nav>
    </header>
  )
}
