const { Router } = require('express')
const authController = require('../controllers/authController.js')
const { authenticate } = require('../middleware/authenticate.js')
const { createAuthLimiter } = require('../middleware/authRateLimiter.js')
const { validate } = require('../middleware/validate.js')
const { loginBody } = require('../validators/auth.validator.js')

const router = Router()

const authLimiter = createAuthLimiter()

router.post('/register', authLimiter, authController.register)
/** Admin-only password sign-in. Buyers and sellers get 403 SSO_REQUIRED. */
router.post('/login', authLimiter, validate(loginBody), authController.login)
router.get('/me', authenticate, authController.me)

/**
 * Clears the auth cookie. Unauthenticated so expired sessions can also
 * be cleaned up without a round-trip failure.
 */
router.post('/logout', authController.logout)

module.exports = router
