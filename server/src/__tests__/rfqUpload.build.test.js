'use strict'

jest.mock('../services/rfqAttachmentStorage.js', () => ({
  saveRfqAttachment: jest.fn().mockResolvedValue(undefined),
  generateRfqStorageFilename: jest.fn(() => '1700000000000-test.pdf'),
  UPLOAD_DIR: require('path').join(__dirname, '../../uploads/rfq'),
}))

const { buildRfqAttachments } = require('../middleware/rfqUpload.js')
const { saveRfqAttachment } = require('../services/rfqAttachmentStorage.js')

describe('buildRfqAttachments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('rejects executable extension before storage', async () => {
    await expect(buildRfqAttachments([{
      originalname: 'malware.exe',
      mimetype: 'application/octet-stream',
      size: 100,
      buffer: Buffer.from([0x4d, 0x5a]),
    }])).rejects.toMatchObject({ statusCode: 400 })

    expect(saveRfqAttachment).not.toHaveBeenCalled()
  })

  test('rejects oversized image before storage', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff)
    big[0] = 0xff
    big[1] = 0xd8
    big[2] = 0xff

    await expect(buildRfqAttachments([{
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: big.length,
      buffer: big,
    }])).rejects.toThrow(/5 MB/)

    expect(saveRfqAttachment).not.toHaveBeenCalled()
  })

  test('persists valid PDF and returns API URL shape', async () => {
    const buffer = Buffer.from('%PDF-1.4\n')
    const attachments = await buildRfqAttachments([{
      originalname: 'spec.pdf',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
    }])

    expect(saveRfqAttachment).toHaveBeenCalledWith(expect.objectContaining({
      filename: '1700000000000-test.pdf',
      mimeType: 'application/pdf',
    }))
    expect(attachments).toEqual([{
      name: 'spec.pdf',
      url: '/api/quote-requests/attachments/file/1700000000000-test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
    }])
  })
})
