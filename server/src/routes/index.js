const { Router } = require('express')
const authRoutes             = require('./auth.routes.js')
const productRoutes          = require('./product.routes.js')
const orderRoutes            = require('./order.routes.js')
const adminRoutes            = require('./admin.routes.js')
const subscriptionRoutes     = require('./subscription.routes.js')
const addressRoutes          = require('./address.routes.js')
const categoryRequestRoutes  = require('./categoryRequest.routes.js')
const contactRoutes          = require('./contact.routes.js')
const quoteRequestRoutes     = require('./quoteRequest.routes.js')
const dealRoutes             = require('./deal.routes.js')
const sellerDealRoutes       = require('./sellerDeal.routes.js')
const adminDealRoutes        = require('./adminDeal.routes.js')
const shopCategoryRoutes     = require('./shopCategory.routes.js')
const { getSnapshot }        = require('../middleware/metrics.js')
const { prisma }             = require('../config/database.js')
const { asyncHandler }       = require('../utils/asyncHandler.js')
const env                    = require('../config/env.js')
const { consumeTicket }      = require('../controllers/ssoController.js')
const { ssoConsumeLimiter }  = require('../middleware/authRateLimiter.js')

const router = Router()

router.post('/sso/consume-ticket', ssoConsumeLimiter, consumeTicket)
router.use('/auth',               authRoutes)
router.use('/products',           productRoutes)
router.use('/orders',             orderRoutes)
router.use('/admin',              adminRoutes)
router.use('/subscriptions',      subscriptionRoutes)
router.use('/profile',            require('./profile.routes.js'))
router.use('/addresses',          addressRoutes)
router.use('/category-requests',  categoryRequestRoutes)
router.use('/shop-categories',    shopCategoryRoutes)
router.use('/contact',            contactRoutes)
router.use('/quote-requests',     quoteRequestRoutes)
router.use('/v1/deals',           dealRoutes)
router.use('/v1/seller/deals',     sellerDealRoutes)
router.use('/v1/admin',           adminDealRoutes)
router.use('/v1/integrations',    require('./integration.routes.js'))
router.use('/v1/integration',     require('./integration.routes.js'))
router.use('/v1',                 require('./integration.routes.js'))

/**
 * GET /api/health
 *
 * Public liveness + readiness probe.  Returns:
 *  - status          "ok" always (if the process is alive)
 *  - version         from package.json
 *  - uptimeSec       seconds since the process started
 *  - requests        total / success / clientError / serverError counters
 *  - responseTime    avg, p50, p95, p99 in ms over the last 1 000 requests
 *  - memory          heap and RSS in MB
 *
 * Health-check hits are suppressed from the request logger to avoid log noise.
 */
router.get('/health', asyncHandler(async (req, res) => {
  const { version } = require('../../package.json')

  let database = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'error'
  }

  const overallStatus = database === 'ok' ? 'ok' : 'degraded'

  res.status(database === 'ok' ? 200 : 503).json({
    success: database === 'ok',
    data: {
      status: overallStatus,
      database,
      monitoring: env.sentryDsn ? 'sentry_configured' : 'logs_only',
      version,
      timestamp: new Date().toISOString(),
      ...getSnapshot(),
    },
  })
}))

module.exports = router
