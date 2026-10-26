const app    = require('./app.js')
const env    = require('./config/env.js')
const logger = require('./config/logger.js')
const { initMonitoring } = require('./config/monitoring.js')
const { prisma } = require('./config/database.js')
const { pool }   = require('./db/pool.js')

initMonitoring()

// ─── Startup ──────────────────────────────────────────────────────────────────

const server = app.listen(env.port, async () => {
  logger.info(
    {
      port: env.port,
      env: env.nodeEnv,
      appEnv: env.isProd ? env.appEnv : undefined,
      paymentProvider: env.paymentProvider,
      startupSchemaDdl: env.runStartupMigrations,
      crossSiteCookies: env.useCrossSiteCookies,
      corsAllowedOrigins: env.corsAllowedOrigins,
      corsAllowedHeaders: env.corsAllowedHeaders,
    },
    '[startup] API listening',
  )

  const path = require('path')
  const { initializeDatabase } = require('./db/startupInit.js')
  const { ensureCatalogSchema } = require(path.join(__dirname, '../prisma/seed/catalog.js'))
  const { ensureDefaultCategories } = require('./services/shopCategoryDbService.js')
  const { ensureDefaultDealChargeConfigs } = require('./services/dealChargeService.js')
  await initializeDatabase({
    env,
    prisma,
    logger,
    ensureCatalogSchema,
    ensureDefaultCategories,
    ensureDefaultDealChargeConfigs,
  })
})

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    logger.fatal(
      { port: env.port },
      `[startup] Port ${env.port} is already in use. Run "npm run free:port" then retry.`,
    )
  } else {
    logger.fatal({ err }, '[startup] Server error')
  }
  process.exit(1)
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false

async function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info({ signal }, '[shutdown] Starting graceful shutdown')

  // Force-exit safety valve — if cleanup takes longer than 15 s something is
  // stuck.  Exit code 1 tells the process manager the stop was not clean.
  const forceTimer = setTimeout(() => {
    logger.error('[shutdown] Cleanup timed out after 15 s — forcing exit (code 1)')
    process.exit(1)
  }, 15_000)
  forceTimer.unref()

  try {
    // 1 — Stop accepting new HTTP connections; let in-flight requests finish
    logger.info('[shutdown] 1/3 Closing HTTP server…')
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    logger.info('[shutdown] 1/3 HTTP server closed')

    // 2 — Drain Prisma's internal connection pool
    logger.info('[shutdown] 2/3 Disconnecting Prisma…')
    await prisma.$disconnect()
    logger.info('[shutdown] 2/3 Prisma disconnected')

    // 3 — Drain the raw pg Pool used by the catalog service
    logger.info('[shutdown] 3/3 Closing PostgreSQL pool…')
    await pool.end()
    logger.info('[shutdown] 3/3 PostgreSQL pool closed')

    clearTimeout(forceTimer)
    logger.info('[shutdown] Cleanup complete — exiting cleanly (code 0)')
    process.exit(0)
  } catch (err) {
    logger.error({ err }, '[shutdown] Error during cleanup')
    process.exit(1)
  }
}

// ─── Signal handlers ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// ─── Unhandled errors ────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, '[process] Unhandled promise rejection — shutting down')
  shutdown('unhandledRejection')
})

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[process] Uncaught exception — shutting down')
  shutdown('uncaughtException')
})
