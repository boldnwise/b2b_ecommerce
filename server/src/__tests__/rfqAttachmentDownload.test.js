'use strict'

jest.mock('../config/database.js')
jest.mock('../services/rfqAttachmentStorage.js', () => ({
  serveRfqAttachment: jest.fn().mockImplementation((_filename, res) => {
    res.status(200).end()
    return Promise.resolve()
  }),
}))

const { agent, cookieFor, makeToken, IDS } = require('./helpers')
const { prisma } = require('../config/database.js')
const { serveRfqAttachment } = require('../services/rfqAttachmentStorage.js')

const buyerToken = makeToken({ id: IDS.BUYER, role: 'BUYER' })

describe('RFQ attachment download authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue({ id: IDS.BUYER, role: 'BUYER' })
  })

  test('403 before storage — serveRfqAttachment not called', async () => {
    prisma.$queryRaw.mockResolvedValue([])

    const res = await agent
      .get('/api/quote-requests/attachments/file/test-file.pdf')
      .set(cookieFor(buyerToken))

    expect(res.status).toBe(403)
    expect(serveRfqAttachment).not.toHaveBeenCalled()
  })

  test('authorized download delegates to storage after access check', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'qr-1' }])

    const res = await agent
      .get('/api/quote-requests/attachments/file/test-file.pdf')
      .set(cookieFor(buyerToken))

    expect(res.status).toBe(200)
    expect(serveRfqAttachment).toHaveBeenCalledWith('test-file.pdf', expect.any(Object))
  })
})
