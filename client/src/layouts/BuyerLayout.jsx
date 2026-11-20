import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { SidebarLogoutButton } from '../components/common/SidebarLogoutButton.jsx'
import { useLogoutRedirect } from '../hooks/useAuth.js'
import { useAppSelector } from '../hooks/redux.js'
import { selectUser } from '../store/slices/authSlice.js'
import { selectHasBuyerSubscription } from '../store/slices/subscriptionSlice.js'
import { fetchContactUnreadCount } from '../services/contact.service.js'

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="11"
        cy="11"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M20 20l-3.2-3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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

export function BuyerLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const logout = useLogoutRedirect()
  const user = useAppSelector(selectUser)
  const hasSub = useAppSelector(selectHasBuyerSubscription)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [replyCount,  setReplyCount]  = useState(0)

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  useEffect(() => {
    fetchContactUnreadCount()
      .then((d) => setReplyCount(d?.count ?? 0))
      .catch(() => {})
  }, [pathname])

  const initials = (user?.companyName || user?.email || 'Buyer')
    .slice(0, 2)
    .toUpperCase()

  function onLogout() {
    logout()
    navigate('/session-required', { replace: true })
  }

  function guardSubscribed(e, path) {
    if (!hasSub) {
      e.preventDefault()
      navigate('/', {
        state: { reason: 'subscription', lockedPath: path },
      })
    }
  }

  return (
    <div className="proShell">
      {/* Mobile overlay — closes sidebar on tap */}
      <div
        className={`proOverlay${sidebarOpen ? ' proOverlay--visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />

      <aside className={`proSidebar${sidebarOpen ? ' proSidebar--open' : ''}`}>
        <div className="proSidebarHead">
          <Link to="/" className="proBrand" aria-label="B2B Marketplace home">
            <BrandLogo size="md" className="proBrand__logo" />
            <div className="proBrand__text">
              <span className="proBrand__title">B2B Buyer</span>
              <span className="proBrand__sub">Dashboard</span>
            </div>
          </Link>
          <button
            type="button"
            className="proSidebar__close"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="proNav" aria-label="Buyer">
          <NavLink
            to="/buyer/dashboard"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Dashboard
          </NavLink>

          <Link to="/products" className="proNavLink">
            Products
          </Link>

          <NavLink
            to="/buyer/quotations"
            end
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            RFQs &amp; Quotations
          </NavLink>

          <NavLink
            to="/buyer/deals"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
            aria-disabled={!hasSub}
            onClick={(e) => guardSubscribed(e, '/buyer/deals')}
          >
            My Orders
          </NavLink>

          <NavLink
            to="/buyer/transactions"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
            aria-disabled={!hasSub}
            onClick={(e) => guardSubscribed(e, '/buyer/transactions')}
          >
            Transactions
          </NavLink>

          <NavLink
            to="/buyer/pricing"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Pricing
          </NavLink>
        </nav>

        <div className="proSidebar__footer">
          <NavLink to="/" className="proNavLink">
            Subscription
          </NavLink>
          <NavLink
            to="/buyer/contact-admin"
            className={({ isActive }) => isActive ? 'proNavLink proNavLink--active' : 'proNavLink'}
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}
          >
            Contact Admin
            {replyCount > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: '999px', fontSize: '.7rem', fontWeight: 700, padding: '.1rem .45rem', lineHeight: 1.4 }}>
                {replyCount > 9 ? '9+' : replyCount}
              </span>
            )}
          </NavLink>
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
          <div className="appTopHeader__searchWrap">
            <div className="appTopHeader__search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search products, suppliers, categories…"
                aria-label="Search"
              />
            </div>
          </div>
          <div className="appTopHeader__actions">
            <button type="button" className="btnOutline">
              Quick reorder
            </button>
            <NavLink
              to="/buyer/contact-admin"
              className="iconBtn iconBtn--notify"
              aria-label={`Notifications${replyCount > 0 ? ` (${replyCount} new replies)` : ''}`}
              style={{ textDecoration: 'none' }}
            >
              <BellIcon />
              {replyCount > 0 && (
                <span className="notificationBadge notificationBadge--count" aria-label={`${replyCount} new replies`}>
                  {replyCount > 9 ? '9+' : replyCount}
                </span>
              )}
            </NavLink>
            <div className="userChip">
              <span className="userChip__avatar" aria-hidden>
                {initials}
              </span>
              <div className="userChip__meta">
                <span className="userChip__name">
                  {user?.companyName || 'Buyer'}
                </span>
                <span className="userChip__role">
                  {user?.email || 'Your company'}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="proContent">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
