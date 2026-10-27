/**
 * Validates the database variables needed by `prisma migrate deploy`.
 *
 * DATABASE_URL — runtime connection used by the API (may go through a pooler).
 * DIRECT_URL   — direct (non-pooled) connection used only by Prisma CLI commands
 *                such as `migrate deploy`; the running API never reads it.
 *
 * Values are never printed — only which rule failed.
 *
 * Usage: node scripts/check-migration-env.js   (exit 1 on failure)
 */

const path = require('path')

const PLACEHOLDER_FRAGMENTS = ['user:password@', 'ep-xxxx', 'replace_me', 'replace-me', 'changeme']

function checkPostgresUrl(name, value) {
  const errors = []
  const raw = String(value ?? '').trim()

  if (!raw) {
    errors.push(`${name} is not set.`)
    return errors
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    errors.push(`${name} is not a valid URL.`)
    return errors
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    errors.push(`${name} must use the postgresql:// scheme.`)
  }
  if (!parsed.hostname) {
    errors.push(`${name} must include a database host.`)
  }
  const lower = raw.toLowerCase()
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    errors.push(`${name} still contains placeholder values from .env.example.`)
  }
  return errors
}

/**
 * @param {Record<string, string|undefined>} source
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateMigrationEnv(source = process.env) {
  const errors = [
    ...checkPostgresUrl('DATABASE_URL', source.DATABASE_URL),
    ...checkPostgresUrl('DIRECT_URL', source.DIRECT_URL),
  ]

  const direct = String(source.DIRECT_URL ?? '')
  if (direct && /-pooler\./i.test(direct)) {
    errors.push('DIRECT_URL must be a direct (non-pooled) connection; remove the "-pooler" host suffix.')
  }

  return { ok: errors.length === 0, errors }
}

if (require.main === module) {
  // Same .env source Prisma CLI uses locally; never overrides real environment variables.
  require('dotenv').config({ path: path.join(__dirname, '../.env') })

  const { ok, errors } = validateMigrationEnv(process.env)
  if (!ok) {
    for (const message of errors) {
      console.error(`[migration-env] ${message}`)
    }
    console.error('[migration-env] Refusing to run migrations. See server/docs/DEPLOYMENT.md.')
    process.exit(1)
  }
  console.log('[migration-env] DATABASE_URL and DIRECT_URL look valid.')
}

module.exports = { validateMigrationEnv }
