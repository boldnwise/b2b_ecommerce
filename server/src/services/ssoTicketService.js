'use strict'

const crypto = require('crypto')
const { Prisma } = require('@prisma/client')
const { prisma } = require('../config/database.js')
const { AppError } = require('../utils/AppError.js')
const { hashPassword } = require('../utils/password.js')
const { USER_SELECT } = require('../utils/serializeUser.js')

const TICKET_TTL_MS = 45_000
/**
 * Rows are deleted only this long after expiry. Consumption requires
 * expiresAt > now and re-reads the row right after claiming it, so cleanup
 * never touches a ticket that can still be claimed or is mid-consumption.
 */
const TICKET_CLEANUP_GRACE_MS = 5 * 60 * 1000
const AUDIENCE = 'b2b'

function ticketHash(ticket) {
  return crypto.createHash('sha256').update(ticket, 'utf8').digest('hex')
}

function uniqueTargets(error) {
  const target = error?.meta?.target
  const fields = Array.isArray(target) ? target : [target]
  return fields.map((field) => String(field || '').toLowerCase())
}

function isUniqueConflict(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Admins sign in only through the separate admin login, never through SSO. */
function assertSsoEligible(user) {
  if (user.isActive === false) {
    throw new AppError('Linked account is deactivated', 403, 'ACCOUNT_DEACTIVATED')
  }
  if (user.role === 'ADMIN') {
    throw new AppError('Admin accounts cannot sign in through SSO', 403, 'SSO_ADMIN_NOT_ALLOWED')
  }
}

async function resolveSsoUser(tx, { authifyUserId, email }) {
  const linked = await tx.user.findUnique({ where: { authifyUserId } })
  if (linked) {
    assertSsoEligible(linked)
    return linked
  }

  const existingEmail = await tx.user.findUnique({ where: { email } })
  if (existingEmail) {
    throw new AppError(
      'An existing B2B account must be linked before SSO',
      409,
      'ACCOUNT_LINK_REQUIRED',
    )
  }

  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'))
  return tx.user.create({
    data: {
      email,
      passwordHash,
      role: 'BUYER',
      isActive: true,
      authifyUserId,
    },
  })
}

async function storeTicket(tx, userId) {
  const ticket = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS)
  await tx.ssoTicket.create({
    data: {
      ticketHash: ticketHash(ticket),
      userId,
      audience: AUDIENCE,
      expiresAt,
      consumedAt: null,
    },
  })
  return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 }
}

/**
 * Another request won the authifyUserId unique insert.
 * Re-read that user and issue a ticket without creating a second account.
 */
async function recoverAuthifyCreateRace(authifyUserId) {
  const user = await prisma.user.findUnique({ where: { authifyUserId } })
  if (!user) {
    throw new AppError('SSO user could not be resolved', 409, 'SSO_USER_CONFLICT')
  }
  assertSsoEligible(user)
  return prisma.$transaction(async (tx) => storeTicket(tx, user.id))
}

/** Remove consumed or unused tickets that expired before the grace window. */
async function purgeExpiredSsoTickets(now = new Date()) {
  try {
    await prisma.ssoTicket.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - TICKET_CLEANUP_GRACE_MS) } },
    })
  } catch {
    // Cleanup is not the security boundary. A failed delete leaves old rows in place.
  }
}

/**
 * Link or provision the B2B user, then store a one-time ticket hash.
 * Returns the raw ticket once. The caller must not log it.
 */
async function issueSsoTicket({ authifyUserId, email }) {
  await purgeExpiredSsoTickets()
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await resolveSsoUser(tx, { authifyUserId, email })
      return storeTicket(tx, user.id)
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    if (!isUniqueConflict(error)) throw error

    const fields = uniqueTargets(error)
    if (fields.some((field) => field.includes('email'))) {
      throw new AppError(
        'An existing B2B account must be linked before SSO',
        409,
        'ACCOUNT_LINK_REQUIRED',
      )
    }
    if (fields.some((field) => field.includes('authify'))) {
      return recoverAuthifyCreateRace(authifyUserId)
    }
    throw error
  }
}

/**
 * Claim a ticket with one conditional UPDATE.
 * PostgreSQL applies the hash, audience, unused, and expiry checks together,
 * so a concurrent replay cannot also match consumedAt IS NULL.
 */
async function consumeSsoTicket(rawTicket) {
  const hash = ticketHash(rawTicket)
  const now = new Date()
  const claimed = await prisma.ssoTicket.updateMany({
    where: {
      ticketHash: hash,
      audience: AUDIENCE,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  })
  if (claimed.count !== 1) {
    throw new AppError('SSO ticket is invalid', 401, 'SSO_TICKET_INVALID')
  }

  const ticket = await prisma.ssoTicket.findUnique({
    where: { ticketHash: hash },
    select: { user: { select: USER_SELECT } },
  })
  const user = ticket?.user
  if (!user || user.isActive === false) {
    throw new AppError(
      'Your account has been deactivated. Contact support for assistance.',
      403,
      'ACCOUNT_DEACTIVATED',
    )
  }
  // The role can change between issue and consume.
  if (user.role === 'ADMIN') {
    throw new AppError('Admin accounts cannot sign in through SSO', 403, 'SSO_ADMIN_NOT_ALLOWED')
  }
  return user
}

module.exports = {
  AUDIENCE,
  TICKET_TTL_MS,
  TICKET_CLEANUP_GRACE_MS,
  ticketHash,
  purgeExpiredSsoTickets,
  issueSsoTicket,
  consumeSsoTicket,
}
