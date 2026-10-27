/**
 * Database work performed when the API starts.
 *
 * Schema DDL is not run here by default: deployments apply schema changes with
 * the one-off migration task (npm run db:migrate:release) before the API is
 * updated, so the runtime database user needs no DDL privileges.
 * env.runStartupMigrations (RUN_MIGRATIONS=true, development only) restores the
 * legacy catalog DDL at startup.
 *
 * Default reference rows (catalog categories when empty, deal charge configs)
 * are idempotent DML and still run here.
 */
async function initializeDatabase({
  env,
  prisma,
  logger,
  ensureCatalogSchema,
  ensureDefaultCategories,
  ensureDefaultDealChargeConfigs,
}) {
  const result = { schemaDdl: 'skipped', defaults: 'ok' }

  if (env.runStartupMigrations) {
    try {
      await ensureCatalogSchema(prisma)
      result.schemaDdl = 'ok'
      logger.info('[startup] RUN_MIGRATIONS=true — catalog schema ensured (development only)')
    } catch (err) {
      result.schemaDdl = 'failed'
      logger.error({ err }, '[startup] Catalog schema DDL failed')
    }
  }

  try {
    await ensureDefaultCategories()
    await ensureDefaultDealChargeConfigs(prisma)
    logger.info('[startup] Default categories and deal charge configs ensured')
  } catch (err) {
    result.defaults = 'failed'
    logger.error(
      { err },
      '[startup] Failed to ensure default reference rows — has the migration task '
        + '(npm run db:migrate:release) been run against this database?',
    )
  }

  return result
}

module.exports = { initializeDatabase }
