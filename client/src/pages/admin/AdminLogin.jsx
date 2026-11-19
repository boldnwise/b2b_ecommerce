import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BrandLogo } from '../../components/common/BrandLogo.jsx'
import { useAppDispatch, useAppSelector } from '../../hooks/redux.js'
import { clearError, login, logoutUser, selectAuth } from '../../store/slices/authSlice.js'

export function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const { user, status, error } = useAppSelector(selectAuth)

  const fromPath = useMemo(() => {
    const state = location.state
    if (state && state.from && state.from.pathname) return state.from.pathname
    return '/admin'
  }, [location.state])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    dispatch(clearError())
  }, [dispatch])

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      navigate(fromPath, { replace: true })
    }
  }, [user, navigate, fromPath])

  async function onSubmit(e) {
    e.preventDefault()
    const result = await dispatch(login({ email, password }))
    if (login.fulfilled.match(result) && result.payload?.role !== 'ADMIN') {
      // The API refuses non-admin password sign-in; never keep such a session here.
      await dispatch(logoutUser())
      toast.error('This account is not an admin. Buyers and sellers sign in through Authify.')
    }
  }

  const loading = status === 'loading'

  return (
    <div className="authPage">
      <div className="authCard">
        <Link to="/" className="authBrand" aria-label="B2B Marketplace home">
          <BrandLogo size="lg" />
        </Link>
        <div className="authHeader">
          <h1 className="authTitle">Admin Login</h1>
          <p className="authSub">Sign in to access buyers, sellers, and transactions.</p>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <div className="fieldLabel">Email</div>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@b2b.local"
              autoComplete="username"
              required
            />
          </label>

          <label className="field">
            <div className="fieldLabel">Password</div>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <div className="errorBox">{error}</div> : null}

          <button className="btn btn--primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
