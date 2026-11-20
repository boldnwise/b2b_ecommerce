const { verifyToken, AUTH_METHODS } = require('../utils/jwt.js')
const { AppError } = require('../utils/AppError.js')
const { prisma } = require('../config/database.js')
const { COOKIE_NAME, clearAuthCookieOptions } = require('../config/cookies.js')
const { USER_SELECT } = require('../utils/serializeUser.js')

/**
 * Extract the JWT from the httpOnly cookie set by the auth endpoints.
 * Falls back to the Authorization: Bearer header so existing API clients
 * (Postman, mobile apps, tests) keep working during migration.
 */
function extractToken(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME]
  const h = req.headers.authorization
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim()
  return null
}

/**
 * Buyer and seller sessions must come from Authify SSO; admin sessions must
 * not. Uses the current database role, so a role change in either direction
 * ends the existing session.
 */
function isAllowedSession(user, decoded) {
  if (user.role === 'ADMIN') return decoded.authMethod !== AUTH_METHODS.SSO
  return decoded.authMethod === AUTH_METHODS.SSO
}

/** Requires a valid JWT and attaches req.user { id, email, role, companyName } */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED')
    }
    const decoded = verifyToken(token)
    const userId = decoded.sub
    if (!userId) {
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN')
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    })
    if (!user) {
      throw new AppError('User no longer exists', 401, 'USER_NOT_FOUND')
    }
    if (user.isActive === false) {
      throw new AppError('Your account has been deactivated. Contact support for assistance.', 403, 'ACCOUNT_DEACTIVATED')
    }
    if (!isAllowedSession(user, decoded)) {
      // A stale cookie would otherwise make the next Authify handoff require CSRF.
      res.clearCookie(COOKIE_NAME, clearAuthCookieOptions())
      if (user.role === 'ADMIN') {
        throw new AppError('Sign in through the admin login.', 401, 'ADMIN_LOGIN_REQUIRED')
      }
      throw new AppError('Open B2B from the Authify Main Portal to sign in.', 401, 'SSO_SESSION_REQUIRED')
    }
    req.user = user
    next()
  } catch (err) {
    if (err instanceof AppError) return next(err)
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401, 'INVALID_TOKEN'))
    }
    next(err)
  }
}

/** Optional JWT — sets req.user if valid, continues regardless */
async function optionalAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return next()
  try {
    const decoded = verifyToken(token)
    const userId = decoded.sub
    if (!userId) return next()
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    })
    if (user && isAllowedSession(user, decoded)) req.user = user
  } catch {
    /* ignore invalid optional token */
  }
  next()
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'))
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'))
    }
    next()
  }
}

module.exports = { authenticate, optionalAuth, authorize, COOKIE_NAME }
