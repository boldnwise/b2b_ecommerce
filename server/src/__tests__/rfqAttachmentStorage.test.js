'use strict'

const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')

const mockEnv = {
  rfqStorageDriver: 'local',
  rfqS3Bucket: 'test-private-bucket',
  rfqS3Prefix: 'rfq/',
  awsRegion: 'ap-south-1',
  isProd: false,
}

jest.mock('../config/env.js', () => mockEnv)
jest.mock('../config/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}))

describe('rfqAttachmentStorage', () => {
  let storage

  beforeEach(() => {
    jest.resetModules()
    mockEnv.rfqStorageDriver = 'local'
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')
    storage.resetRfqS3ClientForTests()
  })

  afterEach(() => {
    storage.resetRfqS3ClientForTests()
  })

  test('local driver saves and serves a file', async () => {
    const filename = `local-test-${Date.now()}.bin`
    const body = Buffer.from('local-rfq-bytes')

    await storage.saveRfqAttachment({
      filename,
      buffer: body,
      mimeType: 'application/pdf',
    })

    const headers = {}
    let sent
    const res = {
      set(name, value) {
        headers[name.toLowerCase()] = value
      },
      send(data) {
        sent = data
      },
    }

    await storage.serveRfqAttachment(filename, res)

    expect(headers['content-type']).toBe('application/octet-stream')
    expect(Buffer.isBuffer(sent) && sent.equals(body)).toBe(true)

    const diskPath = path.join(storage.UPLOAD_DIR, filename)
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath)
  })

  test('rejects path traversal filenames', async () => {
    await expect(storage.saveRfqAttachment({
      filename: '..',
      buffer: Buffer.from('x'),
      mimeType: 'text/plain',
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  test('S3 driver uploads with PutObject after validation path', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const send = jest.fn().mockResolvedValue({})
    storage.setRfqS3ClientForTests({ send })

    const filename = '1700000000000-deadbeef.pdf'
    await storage.saveRfqAttachment({
      filename,
      buffer: Buffer.from('%PDF-1.4'),
      mimeType: 'application/pdf',
    })

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0]
    expect(command.constructor.name).toBe('PutObjectCommand')
    expect(command.input.Bucket).toBe('test-private-bucket')
    expect(command.input.Key).toBe('rfq/1700000000000-deadbeef.pdf')
    expect(command.input.ContentType).toBe('application/pdf')
    expect(command.input.ACL).toBeUndefined()
  })

  test('S3 driver serves object via GetObject stream', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const payload = Buffer.from('s3-object-data')
    const send = jest.fn().mockResolvedValue({
      ContentType: 'application/pdf',
      Body: Readable.from([payload]),
    })
    storage.setRfqS3ClientForTests({ send })

    const { Writable } = require('stream')
    const headers = {}
    const chunks = []
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      },
    })
    res.set = (name, value) => {
      headers[name.toLowerCase()] = value
    }

    await storage.serveRfqAttachment('1700000000000-abc.pdf', res)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].constructor.name).toBe('GetObjectCommand')
    expect(headers['content-type']).toBe('application/pdf')
    expect(Buffer.concat(chunks).equals(payload)).toBe(true)
  })

  test('S3 NoSuchKey falls back to legacy local file', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const filename = `legacy-fallback-${Date.now()}.pdf`
    const legacyBody = Buffer.from('legacy-local')
    const diskPath = path.join(storage.UPLOAD_DIR, filename)
    fs.writeFileSync(diskPath, legacyBody)

    const send = jest.fn().mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }))
    storage.setRfqS3ClientForTests({ send })

    const headers = {}
    let body
    const res = {
      set(name, value) {
        headers[name.toLowerCase()] = value
      },
      send(data) {
        body = data
      },
    }

    await storage.serveRfqAttachment(filename, res)

    expect(send).toHaveBeenCalledTimes(1)
    expect(body.equals(legacyBody)).toBe(true)

    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath)
  })

  test('S3 NoSuchKey without local file returns 404', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const send = jest.fn().mockRejectedValue(Object.assign(new Error('Not found'), { name: 'NoSuchKey' }))
    storage.setRfqS3ClientForTests({ send })

    const res = { set: jest.fn(), write: jest.fn(), end: jest.fn(), send: jest.fn() }

    await expect(storage.serveRfqAttachment('missing-file.pdf', res)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  })

  test('S3 network failure returns safe 503', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const send = jest.fn().mockRejectedValue(Object.assign(new Error('Network error'), { name: 'NetworkingError' }))
    storage.setRfqS3ClientForTests({ send })

    const res = { set: jest.fn(), write: jest.fn(), end: jest.fn() }

    await expect(storage.serveRfqAttachment('file.pdf', res)).rejects.toMatchObject({
      statusCode: 503,
      code: 'STORAGE_UNAVAILABLE',
    })
  })

  test('S3 AccessDenied returns safe 503', async () => {
    mockEnv.rfqStorageDriver = 's3'
    jest.resetModules()
    // eslint-disable-next-line global-require
    storage = require('../services/rfqAttachmentStorage.js')

    const send = jest.fn().mockRejectedValue(Object.assign(new Error('Denied'), { name: 'AccessDenied' }))
    storage.setRfqS3ClientForTests({ send })

    const res = { set: jest.fn(), write: jest.fn(), end: jest.fn() }

    await expect(storage.serveRfqAttachment('file.pdf', res)).rejects.toMatchObject({
      statusCode: 503,
      code: 'STORAGE_UNAVAILABLE',
    })
  })
})
