'use strict'

const { Prisma } = require('@prisma/client')
const { prisma } = require('../config/database.js')
const { AppError } = require('../utils/AppError.js')
const { MAX_SKEW_MS, NONCE_CLEANUP_MARGIN_MS } = require('../middleware/ssoS2sAuth.js')

function nonceExpiry(timestamp) {
  return new Date(Number(timestamp) + MAX_SKEW_MS + NONCE_CLEANUP_MARGIN_MS)
}

/**
 * Record a nonce that has already passed HMAC checks.
 * The unique index makes concurrent registration atomic across instances.
 */
async function consumeSsoNonce({ nonce, timestamp }) {
  try {
    await prisma.ssoNonce.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
  } catch {
    // Cleanup is not the security boundary. A failed delete leaves old rows in place.
  }

  try {
    await prisma.ssoNonce.create({
      data: {
        nonce,
        expiresAt: nonceExpiry(timestamp),
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('SSO nonce has already been used', 401, 'SSO_NONCE_REUSED')
    }
    throw error
  }
}

module.exports = {
  consumeSsoNonce,
  nonceExpiry,
}
