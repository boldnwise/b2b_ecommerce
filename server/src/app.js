/**
 * Express application
 * ──────────────────────────────────────────────────────────────────────────────
 * Two distinct API namespaces are mounted here.  They are intentionally kept
 * separate because they serve different architectural responsibilities:
 *
 *  /api          ← Transactional B2B marketplace (Prisma / public schema)
 *                  Auth-gated, seller-owned products, orders, inventory,
 *                  subscriptions, addresses, admin panel.
 *                  See src/routes/index.js for the full route map.
 *
 *  /api/catalog  ← Browse-only reference catalog (raw pg / catalog schema)
 *                  Public (no auth), pre-seeded products with categories and
 *                  brands, cursor-paginated for infinite scroll.
 *                  See src/routes/catalog.routes.js for the full route map.
 *
 * Middleware order (critical — do NOT reorder):
 *   1. helmet          — security headers
 *   2. cors            — allow-origin + preflight
 *   3. requestLogger   — assigns req.id, logs every request after response
 *   4. metricsMiddleware — records counters + response times for /health
 *   5. express.json    — parse request body
 *   6. cookieParser    — parse cookies (needed for auth)
 *   7. routes          — business logic
 *   8. notFoundHandler — 404 catch-all
 *   9. errorHandler    — structured error responses + structured error logging
 */

const path           = require('path')
const express        = require('express')
const cors           = require('cors')
const helmet         = require('helmet')
const cookieParser   = require('cookie-parser')
const env            = require('./config/env.js')
const corsOptions    = require('./config/cors.js')
const requestLogger  = require('./middleware/requestLogger.js')
const { metricsMiddleware } = require('./middleware/metrics.js')
const { csrfProtection } = require('./middleware/csrfProtection.js')
const { ssoConsumeLimiter } = require('./middleware/authRateLimiter.js')
const { handleRazorpayWebhook } = require('./controllers/subscriptionWebhookController.js')
const { issueTicket, consumeBrowserHandoff } = require('./controllers/ssoController.js')
const routes         = require('./routes/index.js')
const catalogRoutes  = require('./routes/catalog.routes.js')
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.js')
const { asyncHandler } = require('./utils/asyncHandler.js')
const { authenticate } = require('./middleware/authenticate.js')
const { AppError } = require('./utils/AppError.js')
const { serveProductImage } = require('./services/productImageStorage.js')
const {
  serveContactAttachment,
  userCanAccessContactAttachment,
} = require('./services/contactAttachmentStorage.js')
const { sanitizeUploadFilename } = require('./utils/uploadFilename.js')

const app = express()

// Render / other PaaS terminate TLS at the edge — needed for secure cookies.
if (env.isProd || env.useCrossSiteCookies) {
  app.set('trust proxy', 1)
}

// ── Security ──────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: env.useCrossSiteCookies
      ? { policy: 'cross-origin' }
      : undefined,
  }),
)
app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

// ── Observability (must come before routes) ───────────────────────────────────
app.use(requestLogger)     // attaches req.id, logs req+res pairs
app.use(metricsMiddleware) // increments counters + records response times

// ── Body parsing ──────────────────────────────────────────────────────────────
app.post(
  '/api/subscriptions/webhook',
  express.raw({ type: 'application/json' }),
  handleRazorpayWebhook,
)
app.post(
  '/api/sso/issue-ticket',
  express.raw({ type: () => true, limit: '32kb' }),
  issueTicket,
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(csrfProtection)
app.post(
  '/sso/consume',
  ssoConsumeLimiter,
  express.urlencoded({
    extended: false,
    limit: '1kb',
    parameterLimit: 5,
    type: 'application/x-www-form-urlencoded',
  }),
  consumeBrowserHandoff,
)

// ── Uploaded contact attachments (disk in dev; DB fallback in production) ───
app.get(
  '/api/uploads/contact/:filename',
  authenticate,
  asyncHandler(async (req, res) => {
    const safeName = sanitizeUploadFilename(req.params.filename)
    if (!safeName) {
      throw new AppError('Invalid attachment filename', 400, 'VALIDATION_ERROR')
    }

    const allowed = await userCanAccessContactAttachment(req.user, safeName)
    if (!allowed) {
      throw new AppError('You do not have access to this attachment', 403, 'FORBIDDEN')
    }

    const served = await serveContactAttachment(safeName, res)
    if (!served) {
      throw new AppError('File not found', 404, 'NOT_FOUND')
    }
  }),
)

// ── Uploaded product images (disk in dev; DB fallback in production) ─────────
app.get(
  '/api/uploads/products/:filename',
  asyncHandler(async (req, res) => {
    const served = await serveProductImage(req.params.filename, res)
    if (!served) {
      throw new AppError('File not found', 404, 'NOT_FOUND')
    }
  }),
)

// ── Route namespaces ──────────────────────────────────────────────────────────
app.use('/api/catalog', catalogRoutes)
app.use('/api', routes)

// ── Error handling ────────────────────────────────────────────────────────────
// Re-apply CORS so 4xx/5xx JSON responses still include ACAO for allowed origins.
app.use(cors(corsOptions))
app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
