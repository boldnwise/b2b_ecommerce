'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const env = require('../config/env.js')
const logger = require('../config/logger.js')
const { AppError } = require('../utils/AppError.js')
const { sanitizeDisplayFilename } = require('../utils/rfqFileValidation.js')
const {
  sanitizeUploadFilename,
  resolvePathUnderUploadDir,
} = require('../utils/uploadFilename.js')

const UPLOAD_DIR = path.join(__dirname, '../../uploads/rfq')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

/** @type {import('@aws-sdk/client-s3').S3Client | null} */
let s3ClientOverride = null

function getS3Client() {
  if (s3ClientOverride) return s3ClientOverride
  return new S3Client({ region: env.awsRegion })
}

function setRfqS3ClientForTests(client) {
  s3ClientOverride = client
}

function resetRfqS3ClientForTests() {
  s3ClientOverride = null
}

function generateRfqStorageFilename(originalname) {
  const ext = path.extname(sanitizeDisplayFilename(originalname)).toLowerCase()
  const safeExt = ext && ext.length <= 8 ? ext : ''
  return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${safeExt}`
}

function buildS3ObjectKey(filename) {
  return `${env.rfqS3Prefix}${filename}`
}

function assertSafeStorageFilename(filename) {
  const safe = sanitizeUploadFilename(filename)
  if (!safe || safe === '.' || safe === '..') {
    throw new AppError('Invalid attachment filename', 400, 'VALIDATION_ERROR')
  }
  return safe
}

async function writeLocalFile(filename, buffer) {
  const safeName = assertSafeStorageFilename(filename)
  const diskPath = resolvePathUnderUploadDir(UPLOAD_DIR, safeName)
  if (!diskPath) {
    throw new AppError('Invalid attachment path', 400, 'VALIDATION_ERROR')
  }
  await fs.promises.writeFile(diskPath, buffer)
}

async function readLocalFile(filename) {
  const safeName = assertSafeStorageFilename(filename)
  const diskPath = resolvePathUnderUploadDir(UPLOAD_DIR, safeName)
  if (!diskPath || !fs.existsSync(diskPath)) {
    return null
  }
  const buffer = await fs.promises.readFile(diskPath)
  return { buffer, mimeType: null }
}

function mapS3Error(err) {
  const code = err?.name || err?.Code
  if (code === 'NoSuchKey' || code === 'NotFound') {
    return new AppError('Attachment not found', 404, 'NOT_FOUND')
  }
  if (code === 'AccessDenied') {
    return new AppError('Attachment storage is temporarily unavailable', 503, 'STORAGE_UNAVAILABLE')
  }
  logger.error({ err, code }, '[rfq-storage] S3 operation failed')
  return new AppError('Attachment storage is temporarily unavailable', 503, 'STORAGE_UNAVAILABLE')
}

/**
 * Persist validated RFQ bytes (local disk or private S3).
 * @param {{ filename: string, buffer: Buffer, mimeType: string }} params
 */
async function saveRfqAttachment({ filename, buffer, mimeType }) {
  const safeName = assertSafeStorageFilename(filename)

  if (env.rfqStorageDriver === 'local') {
    await writeLocalFile(safeName, buffer)
    return
  }

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket: env.rfqS3Bucket,
      Key: buildS3ObjectKey(safeName),
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
    }))
  } catch (err) {
    throw mapS3Error(err)
  }
}

/**
 * Stream attachment to response after authorization (caller must enforce access).
 */
async function serveRfqAttachment(filename, res) {
  const safeName = assertSafeStorageFilename(filename)

  if (env.rfqStorageDriver === 'local') {
    const local = await readLocalFile(safeName)
    if (!local) {
      throw new AppError('Attachment not found', 404, 'NOT_FOUND')
    }
    res.set('Content-Type', local.mimeType || 'application/octet-stream')
    res.send(local.buffer)
    return
  }

  try {
    const result = await getS3Client().send(new GetObjectCommand({
      Bucket: env.rfqS3Bucket,
      Key: buildS3ObjectKey(safeName),
    }))
    res.set('Content-Type', result.ContentType || 'application/octet-stream')
    if (result.Body) {
      await pipeline(result.Body, res)
    } else {
      throw new AppError('Attachment not found', 404, 'NOT_FOUND')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    const code = err?.name || err?.Code
    if (code === 'NoSuchKey' || code === 'NotFound') {
      const legacy = await readLocalFile(safeName)
      if (legacy) {
        logger.info({ filename: safeName }, '[rfq-storage] served legacy local file after S3 miss')
        res.set('Content-Type', legacy.mimeType || 'application/octet-stream')
        res.send(legacy.buffer)
        return
      }
      throw new AppError('Attachment not found', 404, 'NOT_FOUND')
    }
    throw mapS3Error(err)
  }
}

module.exports = {
  UPLOAD_DIR,
  generateRfqStorageFilename,
  saveRfqAttachment,
  serveRfqAttachment,
  buildS3ObjectKey,
  setRfqS3ClientForTests,
  resetRfqS3ClientForTests,
  getS3Client,
}
