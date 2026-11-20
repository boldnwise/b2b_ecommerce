import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { SidebarLogoutButton } from '../components/common/SidebarLogoutButton.jsx'
import { useLogoutRedirect } from '../hooks/useAuth.js'
import { useAppSelector } from '../hooks/redux.js'
import { selectUser } from '../store/slices/authSlice.js'
import { fetchAdminCategoryRequests } from '../services/admin.service.js'
import { fetchAdminMessageUnreadCount } from '../services/contact.service.js'
import { downloadAdminReportPdf } from '../utils/adminReportPdf.js'

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

export function AdminLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const logout = useLogoutRedirect()
  const user = useAppSelector(selectUser)
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [unreadMessages, setUnreadMessages]   = useState(0)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  useEffect(() => {
    fetchAdminCategoryRequests('PENDING')
      .then((d) => setPendingRequests(d?.requests?.length ?? 0))
      .catch(() => {})
    fetchAdminMessageUnreadCount()
      .then((d) => setUnreadMessages(d?.count ?? 0))
      .catch(() => {})
  }, [pathname])

  function onLogout() {
    logout()
    navigate('/admin/login', { replace: true })
  }

  async function onQuickExport() {
    if (exporting) return
    setExporting(true)
    try {
      await downloadAdminReportPdf({
        adminName: user?.companyName || 'Admin',
        adminEmail: user?.email,
      })
      toast.success('Admin report downloaded as PDF')
    } catch (err) {
      toast.error(err.message || 'Failed to export report')
    } finally {
      setExporting(false)
    }
  }

  const initials = (user?.companyName || user?.email || 'Admin')
    .slice(0, 2)
    .toUpperCase()

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
              <span className="proBrand__title">B2B Admin</span>
              <span className="proBrand__sub">Control center</span>
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

        <nav className="proNav" aria-label="Admin">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Overview
          </NavLink>
          <NavLink
            to="/admin/subscribers"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Subscribers
          </NavLink>
          <NavLink
            to="/admin/deals"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Deals
          </NavLink>
          <NavLink
            to="/admin/deal-charge-configs"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Deal charges
          </NavLink>
          <NavLink
            to="/admin/transactions"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Transaction reports
          </NavLink>
          <NavLink
            to="/admin/pricing"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Marketing pricing
          </NavLink>
          <NavLink
            to="/admin/categories"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
          >
            Categories
          </NavLink>
          <NavLink
            to="/admin/category-requests"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}
          >
            Category requests
            {pendingRequests > 0 && (
              <span style={{ background: '#f59e0b', color: '#fff', borderRadius: '999px', fontSize: '.7rem', fontWeight: 700, padding: '.1rem .45rem', lineHeight: 1.4 }}>
                {pendingRequests > 9 ? '9+' : pendingRequests}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/admin/messages"
            className={({ isActive }) =>
              isActive ? 'proNavLink proNavLink--active' : 'proNavLink'
            }
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}
          >
            Messages
            {unreadMessages > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: '999px', fontSize: '.7rem', fontWeight: 700, padding: '.1rem .45rem', lineHeight: 1.4 }}>
                {unreadMessages > 9 ? '9+' : unreadMessages}
              </span>
            )}
          </NavLink>
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
          <div className="appTopHeader__searchWrap">
            <div className="appTopHeader__search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search buyers, sellers, reports…"
                aria-label="Search"
              />
            </div>
          </div>
          <div className="appTopHeader__actions">
            <button
              type="button"
              className="btnOutline"
              onClick={onQuickExport}
              disabled={exporting}
              aria-busy={exporting}
            >
              {exporting ? 'Exporting…' : 'Quick export'}
            </button>
            <NavLink
              to="/admin/messages"
              className="iconBtn iconBtn--notify"
              aria-label={`Notifications${(pendingRequests + unreadMessages) > 0 ? ` (${pendingRequests + unreadMessages})` : ''}`}
              style={{ textDecoration: 'none' }}
            >
              <BellIcon />
              {(pendingRequests + unreadMessages) > 0 && (
                <span className="notificationBadge notificationBadge--count" aria-label={`${pendingRequests + unreadMessages} pending`}>
                  {(pendingRequests + unreadMessages) > 9 ? '9+' : pendingRequests + unreadMessages}
                </span>
              )}
            </NavLink>
            <div className="userChip">
              <span className="userChip__avatar" aria-hidden>
                {initials}
              </span>
              <div className="userChip__meta">
                <span className="userChip__name">
                  {user?.companyName || 'Admin'}
                </span>
                <span className="userChip__role">
                  {user?.email || 'B2B Marketplace'}
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
