import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { SidebarLogoutButton } from '../components/common/SidebarLogoutButton.jsx'
import { useLogoutRedirect } from '../hooks/useAuth.js'
import { useAppSelector } from '../hooks/redux.js'
import { selectUser } from '../store/slices/authSlice.js'
import { fetchCategoryRequestUnreadCount } from '../services/categoryRequest.service.js'
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

export function SellerLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const logout = useLogoutRedirect()
  const user = useAppSelector(selectUser)
  const wideCatalog =
    pathname.startsWith('/seller/products') ||
    pathname.startsWith('/seller/add-product') ||
    pathname.startsWith('/seller/product-listed')
  const [sidebarOpen,   setSidebarOpen]   = useState(false)
  const [unreadCount,   setUnreadCount]   = useState(0)
  const [replyCount,    setReplyCount]    = useState(0)

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  useEffect(() => {
    fetchCategoryRequestUnreadCount()
      .then((d) => setUnreadCount(d?.count ?? 0))
      .catch(() => {})
    fetchContactUnreadCount()
      .then((d) => setReplyCount(d?.count ?? 0))
      .catch(() => {})
  }, [pathname])

  const initials = (user?.companyName || user?.email || 'Seller')
    .slice(0, 2)
    .toUpperCase()

  function onLogout() {
    logout()
    navigate('/session-required', { replace: true })
  }

  return (
    <div className="proShell">
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
              <span className="proBrand__title">B2B Seller</span>
              <span className="proBrand__sub">Workspace</span>
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

        <nav className="proNav" aria-label="Seller">
          <NavLink
            to="/seller/welcome"
            end
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Welcome
          </NavLink>
          <NavLink
            to="/seller/dashboard"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            My Dashboard
          </NavLink>

          <NavLink
            to="/seller/products"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Listed products
          </NavLink>

          <NavLink
            to="/seller/manage-buyer"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Buyers history
          </NavLink>
          <NavLink
            to="/seller/quotations"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            RFQs &amp; quotations
          </NavLink>
          <NavLink
            to="/seller/transactions"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Transactions
          </NavLink>
          <NavLink
            to="/seller/category-request"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}
          >
            Request Category
            {unreadCount > 0 && (
              <span
                style={{
                  background: '#f59e0b',
                  color: '#fff',
                  borderRadius: '999px',
                  fontSize: '.7rem',
                  fontWeight: 700,
                  padding: '.1rem .45rem',
                  lineHeight: 1.4,
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </NavLink>
        </nav>

        <div className="proSidebar__footer">
          <NavLink
            to="/seller/contact-admin"
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
                placeholder="Search products, orders, buyers…"
                aria-label="Search"
              />
            </div>
          </div>
          <div className="appTopHeader__actions">
            <button type="button" className="btnOutline">
              Quick reorder
            </button>
            <NavLink
              to="/seller/contact-admin"
              className="iconBtn iconBtn--notify"
              aria-label={`Notifications${(unreadCount + replyCount) > 0 ? ` (${unreadCount + replyCount})` : ''}`}
              style={{ textDecoration: 'none' }}
            >
              <BellIcon />
              {(unreadCount + replyCount) > 0 && (
                <span className="notificationBadge notificationBadge--count" aria-label={`${unreadCount + replyCount} unread`}>
                  {(unreadCount + replyCount) > 9 ? '9+' : unreadCount + replyCount}
                </span>
              )}
            </NavLink>
            <div className="userChip">
              <span className="userChip__avatar" aria-hidden>
                {initials}
              </span>
              <div className="userChip__meta">
                <span className="userChip__name">
                  {user?.companyName || 'Seller'}
                </span>
                <span className="userChip__role">
                  {user?.email || 'Your company'}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className={wideCatalog ? 'proContent proContent--wide' : 'proContent'}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
