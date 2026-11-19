import { Link } from 'react-router-dom'
import { BrandLogo } from '../../components/common/BrandLogo.jsx'
import { authifyMyAppsUrl, env } from '../../constants/env.js'

/**
 * Shown when a marketplace page needs a B2B session and the browser does not have one.
 * Normal users sign in through Authify and open B2B from My Apps.
 */
export function SessionRequiredPage() {
  const authifyUrl = authifyMyAppsUrl(env.authifyFrontendUrl)

  return (
    <div className="authPage">
      <div className="authCard authCard--elevated">
        <Link to="/" className="authBrand" aria-label="Home">
          <BrandLogo size="lg" />
        </Link>
        <div className="authHeader">
          <h1 className="authTitle">Open B2B from Authify</h1>
          <p className="authSub">
            Sign in on the Authify Main Portal, then open B2B Marketplace from My Apps.
            This page does not ask for a separate B2B password.
          </p>
        </div>
        <div className="form form--tight">
          {authifyUrl ? (
            <a href={authifyUrl} className="btn btn--primary btn--block" rel="noopener noreferrer">
              Continue to Authify
            </a>
          ) : null}
          <Link to="/pricing" className={`btn ${authifyUrl ? 'btn--ghost' : 'btn--primary'} btn--block`}>
            View plans
          </Link>
          <Link to="/" className="btn btn--ghost btn--block">
            Return to home
          </Link>
        </div>
      </div>
    </div>
  )
}
