/**
 * Single source of truth for all server-side configuration.
 *
 * Rules:
 *  - Every value is read exactly once, here, and exported as a frozen object.
 *  - `required()` throws immediately if a variable is absent — fail fast.
 *  - `optional()` returns a typed default; never leaks `undefined` to callers.
 *  - Production-only guards run after the base values are resolved so a single
 *    startup crash tells the operator exactly what is missing.
 *  - No code outside this file should read `process.env` directly.
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../../.env') })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function required(name) {
  const v = process.env[name]
  if (v === undefined || String(v).trim() === '') {
    throw new Error(`[config] Missing required environment variable: ${name}`)
  }
  return String(v).trim()
}

function optional(name, defaultValue = '') {
  const v = process.env[name]
  return v && String(v).trim() ? String(v).trim() : defaultValue
}

/**
 * Parse a simple duration string ("7d", "24h", "3600s") into milliseconds.
 * Falls back to 7 days on unrecognised input.
 */
function parseDurationMs(s) {
  const match = String(s || '').match(/^(\d+)([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const n = parseInt(match[1], 10)
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return n * (units[match[2]] ?? 86_400_000)
}

// ─── Base values ─────────────────────────────────────────────────────────────

const nodeEnv = optional('NODE_ENV', 'development')
const isProd  = nodeEnv === 'production'
const isDev   = !isProd

/**
 * Deployment tier when NODE_ENV=production: "production" (live) or "staging".
 * Staging keeps production cookie/CORS behavior but may omit Razorpay until configured.
 */
const appEnv = (() => {
  const fallback = isProd ? 'production' : 'development'
  const value = optional('APP_ENV', fallback)
  if (isProd && value !== 'staging' && value !== 'production') {
    throw new Error(
      '[config] APP_ENV must be "staging" or "production" when NODE_ENV=production.',
    )
  }
  return value
})()

const isStaging = isProd && appEnv === 'staging'

const jwtExpiresIn = optional('JWT_EXPIRES_IN', '7d')
const jwtSecret = required('JWT_SECRET')

// ─── CORS allowlist (CLIENT_URL + CORS_ALLOWED_ORIGINS) ─────────────────────
//
// Development: localhost Vite ports are allowed by default.
// Production:  CLIENT_URL is mandatory; add preview/extra domains via
//              CORS_ALLOWED_ORIGINS (comma-separated, supports wildcards).

/** Strip trailing slashes so CORS matches the browser Origin header exactly. */
function normalizeOrigins(list) {
  return list.map((u) => u.replace(/\/+$/, ''))
}

function parseOriginList(raw) {
  if (!raw || !String(raw).trim()) return []
  return normalizeOrigins(String(raw).split(',').map((s) => s.trim()).filter(Boolean))
}

function dedupeOrigins(list) {
  return [...new Set(list)]
}

let corsAllowedOrigins

if (isProd) {
  const clientUrlRaw = required('CLIENT_URL')
  const corsExtraRaw = optional('CORS_ALLOWED_ORIGINS', '')
  corsAllowedOrigins = dedupeOrigins([
    ...parseOriginList(clientUrlRaw),
    ...parseOriginList(corsExtraRaw),
  ])

  if (corsAllowedOrigins.length === 0) {
    throw new Error(
      '[config] CLIENT_URL and/or CORS_ALLOWED_ORIGINS must contain at least one origin in production.',
    )
  }

  const hasLocalhost = corsAllowedOrigins.some((u) => /localhost|127\.0\.0\.1/i.test(u))
  if (hasLocalhost) {
    throw new Error(
      '[config] CORS allowlist must not contain localhost or 127.0.0.1 in production. ' +
      'Provide your real domain(s), e.g. https://app.yourdomain.com',
    )
  }
} else {
  const clientUrlRaw = optional('CLIENT_URL', 'http://localhost:5173,http://localhost:3000')
  const corsExtraRaw = optional('CORS_ALLOWED_ORIGINS', '')
  corsAllowedOrigins = dedupeOrigins([
    ...parseOriginList(clientUrlRaw),
    ...parseOriginList(corsExtraRaw),
  ])
}

/** @deprecated Use corsAllowedOrigins — kept for backward-compatible imports. */
const clientUrls = corsAllowedOrigins

const DEFAULT_CORS_ALLOWED_HEADERS = Object.freeze([
  'Content-Type',
  'Authorization',
  'Accept',
  'Cache-Control',
  'X-Requested-With',
  'X-CSRF-Token',
])

function parseHeaderList(raw, defaults) {
  if (!raw || !String(raw).trim()) return [...defaults]
  return [...new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean))]
}

const corsAllowedHeaders = parseHeaderList(
  optional('CORS_ALLOWED_HEADERS', ''),
  DEFAULT_CORS_ALLOWED_HEADERS,
)

/**
 * True when the frontend is on a real HTTPS origin (e.g. Vercel), separate from
 * the API host (e.g. Render). Enables SameSite=None + Secure auth cookies.
 */
function detectCrossSiteCookies(urls) {
  return urls.some((origin) => {
    try {
      const { protocol, hostname } = new URL(origin)
      if (protocol !== 'https:') return false
      return !/localhost|127\.0\.0\.1/i.test(hostname)
    } catch {
      return false
    }
  })
}

const useCrossSiteCookies = detectCrossSiteCookies(corsAllowedOrigins)

if (useCrossSiteCookies && !isProd) {
  console.warn(
    '[config] CLIENT_URL is a production HTTPS origin but NODE_ENV is not "production". ' +
      'Cross-site cookies (SameSite=None) are enabled from CLIENT_URL. Set NODE_ENV=production on Render.',
  )
}

// ─── Razorpay — warn loudly if placeholder keys reach production ─────────────

const razorpayKeyId     = optional('RAZORPAY_KEY_ID')
const razorpayKeySecret = optional('RAZORPAY_KEY_SECRET')
const razorpayWebhookSecret = optional('RAZORPAY_WEBHOOK_SECRET')

const integrationApiEnabled = isProd
  ? optional('INTEGRATION_API_ENABLED', 'false') === 'true'
  : optional('INTEGRATION_API_ENABLED', 'true') === 'true'

/** When true (non-production only), allows UUID-only negotiation stub for integration QA. */
const integrationAllowDevNegotiationStub =
  !isProd && optional('INTEGRATION_ALLOW_DEV_NEGOTIATION_STUB', 'false') === 'true'

const integrationNegotiationVerifyUrl = optional('INTEGRATION_NEGOTIATION_VERIFY_URL', '')
const integrationS2sSharedSecret = optional('INTEGRATION_S2S_SHARED_SECRET', '')

const csrfProtectionEnabled = optional('CSRF_PROTECTION_ENABLED', isProd ? 'true' : 'true') === 'true'

/** Public B2B self-registration (POST /auth/register). Off in production unless explicitly enabled. */
const enablePublicRegistration = isProd
  ? optional('ENABLE_PUBLIC_REGISTRATION', 'false') === 'true'
  : optional('ENABLE_PUBLIC_REGISTRATION', 'true') === 'true'

const sentryDsn = optional('SENTRY_DSN', '')

// ─── RFQ attachment storage (local disk or private S3) ───────────────────────

const rfqStorageDriverRaw = optional('RFQ_STORAGE_DRIVER', 'local').toLowerCase()
if (rfqStorageDriverRaw !== 'local' && rfqStorageDriverRaw !== 's3') {
  throw new Error('[config] RFQ_STORAGE_DRIVER must be "local" or "s3".')
}
const rfqStorageDriver = rfqStorageDriverRaw

function normalizeRfqS3Prefix(raw) {
  const trimmed = String(raw || 'rfq/').trim()
  if (!trimmed) return 'rfq/'
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

const rfqS3Prefix = normalizeRfqS3Prefix(optional('RFQ_S3_PREFIX', 'rfq/'))
const rfqS3Bucket = optional('RFQ_S3_BUCKET', '')
const awsRegion = optional('AWS_REGION', '')

function assertRfqS3StorageConfig() {
  if (rfqStorageDriver !== 's3') return
  if (!rfqS3Bucket) {
    throw new Error('[config] RFQ_S3_BUCKET is required when RFQ_STORAGE_DRIVER=s3.')
  }
  if (!awsRegion) {
    throw new Error('[config] AWS_REGION is required when RFQ_STORAGE_DRIVER=s3.')
  }
}

assertRfqS3StorageConfig()

function assertProductionJwtSecret(secret) {
  if (!secret || secret.length < 32) {
    throw new Error(
      '[config] Production JWT_SECRET must be at least 32 characters.',
    )
  }
  const lower = secret.toLowerCase()
  const placeholderFragments = [
    'replace-with',
    'changeme',
    'your-secret',
    'example',
    'jwt_secret',
  ]
  if (placeholderFragments.some((fragment) => lower.includes(fragment))) {
    throw new Error(
      '[config] Production JWT_SECRET must not use placeholder or example values.',
    )
  }
}

function assertProductionRazorpayKeys() {
  const placeholders = ['', 'rzp_test_REPLACE_ME', 'REPLACE_ME_SECRET']
  const missingId = !razorpayKeyId || placeholders.includes(razorpayKeyId)
  const testId = razorpayKeyId.startsWith('rzp_test_')
  const missingSecret = !razorpayKeySecret || placeholders.includes(razorpayKeySecret)

  if (missingId || testId) {
    throw new Error(
      '[config] Production requires a live RAZORPAY_KEY_ID (rzp_live_*). Test keys are not allowed.',
    )
  }
  if (missingSecret) {
    throw new Error(
      '[config] Production requires RAZORPAY_KEY_SECRET. Placeholder or missing values are not allowed.',
    )
  }
  if (!razorpayWebhookSecret) {
    throw new Error(
      '[config] Production requires RAZORPAY_WEBHOOK_SECRET for payment webhook verification.',
    )
  }
}

if (isProd) {
  assertProductionJwtSecret(jwtSecret)
  if (!isStaging) {
    assertProductionRazorpayKeys()
  } else if (!razorpayKeyId || !razorpayKeySecret) {
    console.warn(
      '[config] APP_ENV=staging — Razorpay keys not configured. '
      + 'Subscription checkout and webhooks remain unavailable until keys are set.',
    )
  }
}

// ─── Exported config (frozen — callers must not mutate) ─────────────────────

/** Dummy deal payments are allowed only outside production (dev/test/CI). Production always rejects dummy. */
const allowDummyDealPayments = !isProd && optional('ALLOW_DUMMY_DEAL_PAYMENTS', 'true') === 'true'

module.exports = Object.freeze({
  nodeEnv,
  appEnv,
  isProd,
  isStaging,
  isDev,
  port:          parseInt(optional('PORT', '3001'), 10),
  databaseUrl:   required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn,
  cookieMaxAge:  parseDurationMs(jwtExpiresIn),
  clientUrls,
  corsAllowedOrigins,
  corsAllowedHeaders,
  useCrossSiteCookies,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  integrationApiEnabled,
  integrationAllowDevNegotiationStub,
  integrationNegotiationVerifyUrl,
  integrationS2sSharedSecret,
  csrfProtectionEnabled,
  enablePublicRegistration,
  sentryDsn,
  mainPortalProfileEnabled: optional('MAIN_PORTAL_PROFILE_ENABLED', 'false') === 'true',
  allowDummyDealPayments,
  rfqStorageDriver,
  rfqS3Bucket,
  rfqS3Prefix,
  awsRegion,
})

