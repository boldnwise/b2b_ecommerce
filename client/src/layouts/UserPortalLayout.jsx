import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { SidebarLogoutButton } from '../components/common/SidebarLogoutButton.jsx'
import { SubscribeFeatureAlert } from '../components/common/SubscribeFeatureAlert.jsx'
import { WorkspaceSwitcher } from '../components/common/WorkspaceSwitcher.jsx'
import { useActiveWorkspace } from '../hooks/useActiveWorkspace.js'
import { useLogoutRedirect } from '../hooks/useAuth.js'
import { useAppSelector } from '../hooks/redux.js'
import { selectUser } from '../store/slices/authSlice.js'
import { selectHasBuyerSubscription, selectHasSellerSubscription } from '../store/slices/subscriptionSlice.js'
import { fetchContactUnreadCount } from '../services/contact.service.js'
import { SELLER_SUBSCRIBE_MESSAGE } from '../utils/sellerSubscription.js'
import { BUYER_SUBSCRIBE_MESSAGE } from '../utils/buyerSubscription.js'
import {
  isBuyerSection,
  isSellerSection,
  portalRoleLabel,
  visiblePortalPrimaryNav,
  visibleBuyerSubNav,
  visibleSellerSubNav,
  canAccessSellerWorkspace,
} from '../utils/portalNav.js'

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 01-3.46 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function SubNav({ links, onNavigate, onLockedClick }) {
  return (
    <div className="proNavSub">
      {links.map((item) => {
        if (item.locked) {
          return (
            <button
              key={item.to}
              type="button"
              className="proNavLink proNavLink--sub proNavLink--locked"
              onClick={() => onLockedClick?.(item)}
            >
              <span>{item.label}</span>
              <LockIcon />
            </button>
          )
        }

        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--sub proNavLink--active' : 'proNavLink proNavLink--sub'
            }
            onClick={onNavigate}
          >
            {item.label}
          </NavLink>
        )
      })}
    </div>
  )
}

export function UserPortalLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const logout = useLogoutRedirect()
  const user = useAppSelector(selectUser)
  const hasBuyerSub = useAppSelector(selectHasBuyerSubscription)
  const hasSellerSub = useAppSelector(selectHasSellerSubscription)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [replyCount, setReplyCount] = useState(0)
  const [sellerSubscribeAlertOpen, setSellerSubscribeAlertOpen] = useState(false)
  const [buyerSubscribeAlertOpen, setBuyerSubscribeAlertOpen] = useState(false)

  const {
    activeWorkspace,
    setActiveWorkspace,
    hasBothWorkspaces,
    buyerAccess: buyerWorkspaceAccess,
    sellerAccess: sellerWorkspaceAccess,
  } = useActiveWorkspace({
    role: user?.role,
    hasBuyer: hasBuyerSub,
    hasSeller: hasSellerSub,
  })

  const inBuyer = isBuyerSection(pathname)
  const inSeller = isSellerSection(pathname)
  const buyerLinks = useMemo(() => visibleBuyerSubNav(hasBuyerSub), [hasBuyerSub])
  const sellerLinks = useMemo(() => visibleSellerSubNav(hasSellerSub), [hasSellerSub])
  const primaryNav = useMemo(
    () =>
      visiblePortalPrimaryNav(user?.role, {
        hasBuyer: hasBuyerSub,
        hasSeller: hasSellerSub,
        activeWorkspace,
      }),
    [user?.role, hasBuyerSub, hasSellerSub, activeWorkspace],
  )

  const wideCatalog =
    pathname.startsWith('/seller/products') ||
    pathname.startsWith('/seller/add-product') ||
    pathname.startsWith('/seller/product-listed')

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  useEffect(() => {
    fetchContactUnreadCount()
      .then((d) => setReplyCount(d?.count ?? 0))
      .catch(() => {})
  }, [pathname, user?.role])

  useEffect(() => {
    if (
      location.state?.showSubscribeAlert &&
      canAccessSellerWorkspace(user?.role, hasSellerSub) &&
      !hasSellerSub
    ) {
      setSellerSubscribeAlertOpen(true)
      navigate(pathname, { replace: true, state: {} })
    }
  }, [location.state, user?.role, hasSellerSub, navigate, pathname])

  function openSellerSubscribeAlert() {
    setSellerSubscribeAlertOpen(true)
  }

  function openBuyerSubscribeAlert() {
    setBuyerSubscribeAlertOpen(true)
  }

  function closeSellerSubscribeAlert() {
    setSellerSubscribeAlertOpen(false)
  }

  function closeBuyerSubscribeAlert() {
    setBuyerSubscribeAlertOpen(false)
  }

  function goToSellerPricing() {
    closeSellerSubscribeAlert()
    navigate('/pricing')
  }

  function goToBuyerPricing() {
    closeBuyerSubscribeAlert()
    navigate('/pricing')
  }

  const initials = (user?.companyName || user?.email || 'User').slice(0, 2).toUpperCase()

  function onLogout() {
    logout()
    navigate('/session-required', { replace: true })
  }

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function primaryActive(item) {
    if (item.to === '/portal/profile') return pathname === '/portal/profile'
    if (item.section === 'buyer') return inBuyer
    if (item.section === 'seller') return inSeller
    if (item.to === '/pricing') return false
    if (item.to === '/portal/contact-admin') return pathname.startsWith('/portal/contact-admin')
    return pathname.startsWith(item.to)
  }

  return (
    <div className="proShell">
      <div
        className={`proOverlay${sidebarOpen ? ' proOverlay--visible' : ''}`}
        onClick={closeSidebar}
        aria-hidden
      />

      <aside className={`proSidebar${sidebarOpen ? ' proSidebar--open' : ''}`}>
        <div className="proSidebarHead">
          <Link to="/" className="proBrand" aria-label="B2B Marketplace home">
            <BrandLogo size="md" className="proBrand__logo" />
            <div className="proBrand__text">
              <span className="proBrand__title">B2B Portal</span>
              <span className="proBrand__sub">
                {portalRoleLabel(user?.role, {
                  hasBuyer: hasBuyerSub,
                  hasSeller: hasSellerSub,
                  activeWorkspace,
                })}
              </span>
            </div>
          </Link>
          <button
            type="button"
            className="proSidebar__close"
            aria-label="Close navigation"
            onClick={closeSidebar}
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="proNav" aria-label="User portal">
          {primaryNav.map((item) => {
            const active = primaryActive(item)
            const showBuyerSub =
              item.section === 'buyer' &&
              buyerWorkspaceAccess &&
              (!hasBothWorkspaces || activeWorkspace === 'buyer')
            const showSellerSub =
              item.section === 'seller' &&
              sellerWorkspaceAccess &&
              (!hasBothWorkspaces || activeWorkspace === 'seller')

            if (item.external) {
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="proNavLink"
                  onClick={closeSidebar}
                >
                  {item.label}
                </Link>
              )
            }

            return (
              <div key={item.to} className="proNavGroup">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={active ? 'proNavLink proNavLink--active' : 'proNavLink'}
                  onClick={closeSidebar}
                >
                  {item.label}
                  {item.to === '/portal/contact-admin' && replyCount > 0 ? (
                    <span className="proNavBadge">{replyCount > 9 ? '9+' : replyCount}</span>
                  ) : null}
                </NavLink>
                {showBuyerSub ? (
                  <SubNav
                    links={buyerLinks}
                    onNavigate={closeSidebar}
                    onLockedClick={() => {
                      closeSidebar()
                      openBuyerSubscribeAlert()
                    }}
                  />
                ) : null}
                {showSellerSub ? (
                  <SubNav
                    links={sellerLinks}
                    onNavigate={closeSidebar}
                    onLockedClick={() => {
                      closeSidebar()
                      openSellerSubscribeAlert()
                    }}
                  />
                ) : null}
              </div>
            )
          })}
        </nav>

        <div className="proSidebar__footer">
          <SidebarLogoutButton onClick={onLogout} />
        </div>
      </aside>

      <div className="proMain">
        <header className="appTopHeader">
          <button
            type="button"
            className="proMobileToggle"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <MenuIcon />
          </button>
          <div className="appTopHeader__actions" style={{ marginLeft: 'auto' }}>
            {hasBothWorkspaces ? (
              <WorkspaceSwitcher
                activeWorkspace={activeWorkspace}
                onSwitch={setActiveWorkspace}
              />
            ) : null}
            <NavLink
              to="/portal/contact-admin"
              className="iconBtn iconBtn--notify"
              aria-label={`Contact admin${replyCount > 0 ? ` (${replyCount} replies)` : ''}`}
              style={{ textDecoration: 'none' }}
            >
              <BellIcon />
              {replyCount > 0 ? (
                <span className="notificationBadge notificationBadge--count">
                  {replyCount > 9 ? '9+' : replyCount}
                </span>
              ) : null}
            </NavLink>
            <Link to="/portal/profile" className="userChip" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="userChip__avatar" aria-hidden>
                {initials}
              </span>
              <div className="userChip__meta">
                <span className="userChip__name">{user?.companyName || 'Account'}</span>
                <span className="userChip__role">{user?.email || user?.role || ''}</span>
              </div>
            </Link>
          </div>
        </header>

        <div className={wideCatalog ? 'proContent proContent--wide' : 'proContent'}>
          <Outlet />
        </div>
      </div>

      <SubscribeFeatureAlert
        open={sellerSubscribeAlertOpen}
        title="Subscribe to unlock seller features"
        message={SELLER_SUBSCRIBE_MESSAGE}
        onClose={closeSellerSubscribeAlert}
        onSubscribe={goToSellerPricing}
      />
      <SubscribeFeatureAlert
        open={buyerSubscribeAlertOpen}
        title="Subscribe to unlock buyer features"
        message={BUYER_SUBSCRIBE_MESSAGE}
        onClose={closeBuyerSubscribeAlert}
        onSubscribe={goToBuyerPricing}
      />
    </div>
  )
}
