#!/usr/bin/env node
/**
 * Explicit release migration task — run exactly one instance per deployment,
 * against the target database, before updating the application.
 *
 * Order:
 *   0. Validate DATABASE_URL and DIRECT_URL (scripts/check-migration-env.js).
 *   1. prisma migrate deploy        — Prisma-owned `public` schema (connects via DIRECT_URL).
 *   2. node src/db/migrate.js       — idempotent catalog schema SQL (src/db/migrations/*.sql),
 *                                     connected via DIRECT_URL, without --seed.
 *
 * Stops at the first failure and exits non-zero. Never seeds data, truncates
 * catalog tables, or creates an administrator. Never prints connection strings.
 *
 * Usage: npm run db:migrate:release
 */
const path = require('path')
const { spawnSync } = require('child_process')
const { validateMigrationEnv } = require('./check-migration-env.js')

const SERVER_ROOT = path.join(__dirname, '..')
const CATALOG_MIGRATE_SCRIPT = path.join(SERVER_ROOT, 'src/db/migrate.js')

function prismaCliPath() {
  const pkgPath = require.resolve('prisma/package.json', { paths: [SERVER_ROOT] })
  const { bin } = require(pkgPath)
  return path.join(path.dirname(pkgPath), typeof bin === 'string' ? bin : bin.prisma)
}

function buildSteps(source, { prismaCli = prismaCliPath() } = {}) {
  const env = { ...source }
  return [
    {
      name: 'prisma migrate deploy',
      command: process.execPath,
      args: [prismaCli, 'migrate', 'deploy'],
      env,
    },
    {
      name: 'catalog schema migrations',
      command: process.execPath,
      args: [CATALOG_MIGRATE_SCRIPT],
      env: { ...env, DATABASE_URL: env.DIRECT_URL },
    },
  ]
}

function runStep(step) {
  const result = spawnSync(step.command, step.args, {
    cwd: SERVER_ROOT,
    env: step.env,
    stdio: 'inherit',
  })
  if (result.error) return { status: 1, signal: null }
  return { status: result.status ?? 1, signal: result.signal }
}

function runReleaseMigrations({ source = process.env, run = runStep, log = console, prismaCli } = {}) {
  const check = validateMigrationEnv(source)
  if (!check.ok) {
    check.errors.forEach((message) => log.error(`[migrate:release] ${message}`))
    return 1
  }

  const steps = buildSteps(source, prismaCli ? { prismaCli } : undefined)
  for (const [index, step] of steps.entries()) {
    log.log(`[migrate:release] ${index + 1}/${steps.length} ${step.name}…`)
    const { status, signal } = run(step)
    if (status !== 0) {
      log.error(
        `[migrate:release] ${step.name} failed (exit ${status}${signal ? `, signal ${signal}` : ''}). `
          + 'Stopping — remaining steps skipped. Do not deploy the application.',
      )
      return status || 1
    }
  }

  log.log('[migrate:release] All migrations applied.')
  return 0
}

module.exports = { buildSteps, runReleaseMigrations, CATALOG_MIGRATE_SCRIPT }

if (require.main === module) {
  require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') })
  process.exitCode = runReleaseMigrations()
}
