const jwt = require('jsonwebtoken')
const env = require('../config/env.js')

/** Issuer claim — must match on sign and verify. */
const JWT_ISSUER = 'b2b-ecommerce-api'

/** Only HMAC-SHA256; verifier rejects other algs (including `none`). */
const JWT_ALGORITHMS = ['HS256']

/**
 * How the session was established. Buyer and seller sessions are accepted only
 * when they came from Authify SSO; admins sign in with a password.
 */
const AUTH_METHODS = Object.freeze({ SSO: 'sso', PASSWORD: 'password' })

/**
 * @param {{ sub: string, email: string, role: string, authMethod: string }} payload
 */
function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    issuer: JWT_ISSUER,
    algorithm: JWT_ALGORITHMS[0],
  })
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, {
    issuer: JWT_ISSUER,
    algorithms: JWT_ALGORITHMS,
  })
}

module.exports = { signToken, verifyToken, JWT_ISSUER, JWT_ALGORITHMS, AUTH_METHODS }
