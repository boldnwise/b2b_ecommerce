'use strict'

jest.mock('../config/database')

const { prisma } = require('../config/database')
const {
  TICKET_TTL_MS,
  TICKET_CLEANUP_GRACE_MS,
  purgeExpiredSsoTickets,
  issueSsoTicket,
  consumeSsoTicket,
} = require('../services/ssoTicketService')

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-19T12:00:00.000Z')

function at(offsetMs) {
  return new Date(NOW.getTime() + offsetMs)
}

/** Apply the deleteMany filter the way PostgreSQL would to an in-memory table. */
function deleteMatching(rows, where) {
  const cutoff = where.expiresAt.lt
  const kept = rows.filter((row) => !(row.expiresAt < cutoff))
  return { kept, count: rows.length - kept.length }
}

describe('SSO ticket cleanup', () => {
  test('deletes only rows that expired before the grace window', async () => {
    const rows = [
      { id: 'valid-unused', expiresAt: at(TICKET_TTL_MS), consumedAt: null },
      { id: 'consumed-not-expired', expiresAt: at(10_000), consumedAt: at(-5_000) },
      { id: 'just-expired-unused', expiresAt: at(-1_000), consumedAt: null },
      { id: 'expired-inside-grace', expiresAt: at(-TICKET_CLEANUP_GRACE_MS + 1_000), consumedAt: null },
      { id: 'old-unused', expiresAt: at(-TICKET_CLEANUP_GRACE_MS - 1_000), consumedAt: null },
      { id: 'old-consumed', expiresAt: at(-TICKET_CLEANUP_GRACE_MS - 60_000), consumedAt: at(-TICKET_CLEANUP_GRACE_MS - 90_000) },
    ]
    let remaining = rows
    prisma.ssoTicket.deleteMany.mockImplementation(async ({ where }) => {
      const result = deleteMatching(remaining, where)
      remaining = result.kept
      return { count: result.count }
    })

    await purgeExpiredSsoTickets(NOW)

    expect(remaining.map((row) => row.id)).toEqual([
      'valid-unused',
      'consumed-not-expired',
      'just-expired-unused',
      'expired-inside-grace',
    ])
  })

  test('filters on expiry only, so consumedAt never selects a claimable ticket', async () => {
    prisma.ssoTicket.deleteMany.mockResolvedValue({ count: 0 })

    await purgeExpiredSsoTickets(NOW)

    expect(prisma.ssoTicket.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: at(-TICKET_CLEANUP_GRACE_MS) } },
    })
  })

  test('the cleanup cutoff is always earlier than the expiry a consume can still claim', () => {
    // consumeSsoTicket claims only rows with expiresAt > now; cleanup deletes only expiresAt < now - grace.
    expect(TICKET_CLEANUP_GRACE_MS).toBeGreaterThan(0)
    expect(at(-TICKET_CLEANUP_GRACE_MS).getTime()).toBeLessThan(NOW.getTime())
  })

  test('issuing a ticket purges old rows first and still succeeds when cleanup fails', async () => {
    prisma.ssoTicket.deleteMany.mockRejectedValue(new Error('cleanup unavailable'))
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'BUYER', isActive: true })
    prisma.ssoTicket.create.mockImplementation(async ({ data }) => data)

    const result = await issueSsoTicket({ authifyUserId: '900000000001', email: 'buyer@test.com' })

    expect(prisma.ssoTicket.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.ssoTicket.deleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.ssoTicket.create.mock.invocationCallOrder[0])
    expect(typeof result.ticket).toBe('string')
    expect(prisma.ssoTicket.create).toHaveBeenCalledTimes(1)
  })

  test('consuming a ticket never runs cleanup', async () => {
    prisma.ssoTicket.updateMany.mockResolvedValue({ count: 1 })
    prisma.ssoTicket.findUnique.mockResolvedValue({
      user: { id: USER_ID, role: 'BUYER', isActive: true },
    })

    await consumeSsoTicket('a'.repeat(43))

    expect(prisma.ssoTicket.deleteMany).not.toHaveBeenCalled()
  })
})
