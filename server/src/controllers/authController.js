const { prisma } = require('../config/database.js')

const { AppError } = require('../utils/AppError.js')

const { asyncHandler } = require('../utils/asyncHandler.js')

const { comparePassword } = require('../utils/password.js')

const { signToken, AUTH_METHODS } = require('../utils/jwt.js')

const { COOKIE_NAME, authCookieOptions, clearAuthCookieOptions, CSRF_COOKIE_NAME, csrfCookieOptions } = require('../config/cookies.js')
const { generateCsrfToken, readCsrfCookie } = require('../utils/csrf.js')

const REUSABLE_CSRF_TOKEN = /^[a-f0-9]{64}$/

/** rotate: always mint a new token, e.g. when an SSO handoff may switch the signed-in user. */
function issueCsrfCookie(req, res, { rotate = false } = {}) {
  const existing = readCsrfCookie(req)
  const token = !rotate && REUSABLE_CSRF_TOKEN.test(existing) ? existing : generateCsrfToken()
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions())
  // Same value as the host-only cookie. The browser can read this header
  // cross-origin; it cannot read the API host's csrf_token cookie.
  res.set('X-CSRF-Token', token)
}

const { serializeUser, USER_SELECT } = require('../utils/serializeUser.js')



/** Mint a JWT and write it as an httpOnly cookie. */

function setAuthCookie(res, payload) {

  const token = signToken(payload)

  res.cookie(COOKIE_NAME, token, authCookieOptions())

  return token

}



/** Buyer and seller accounts are created through Authify SSO only. */
function register(req, res, next) {
  next(new AppError(
    'B2B accounts are created through the Authify Main Portal.',
    403,
    'REGISTRATION_DISABLED',
  ))
}



/** Password sign-in is for ADMIN accounts only; everyone else uses Authify SSO. */
const login = asyncHandler(async (req, res) => {

  const { email, password } = req.body



  const user = await prisma.user.findUnique({ where: { email }, select: { ...USER_SELECT, passwordHash: true } })

    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS')
    }

    if (user.isActive === false) {
      throw new AppError('Your account has been deactivated. Contact support for assistance.', 403, 'ACCOUNT_DEACTIVATED')
    }



  const ok = await comparePassword(password, user.passwordHash)

  if (!ok) {

    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS')

  }



  if (user.role !== 'ADMIN') {
    throw new AppError(
      'Buyer and seller accounts sign in through the Authify Main Portal.',
      403,
      'SSO_REQUIRED',
    )
  }

  const { passwordHash: _ignored, ...safeUser } = user



  setAuthCookie(res, {
    sub: user.id,
    email: user.email,
    role: user.role,
    authMethod: AUTH_METHODS.PASSWORD,
  })
  issueCsrfCookie(req, res)

  res.json({
    success: true,
    data: { user: serializeUser(safeUser) },
  })
})



const me = asyncHandler(async (req, res) => {
  issueCsrfCookie(req, res)

  res.json({
    success: true,
    data: { user: serializeUser(req.user) },
  })
})



/**

 * Clear the auth cookie on the client. This endpoint is intentionally

 * unauthenticated — clearing a cookie for an already-expired session

 * should still succeed so the UI can reach a clean state.

 */

const logout = asyncHandler(async (req, res) => {

  res.clearCookie(COOKIE_NAME, clearAuthCookieOptions())

  res.json({ success: true, data: { message: 'Logged out successfully' } })

})



module.exports = { register, login, me, logout, setAuthCookie, issueCsrfCookie }

