/**
 * Render build script.
 * Ensures DIRECT_URL is set (falling back to DATABASE_URL or unpooled Neon URL)
 * to prevent Prisma P1012 missing env var error and P1002 advisory lock timeout.
 */

const { execSync } = require('child_process')
const { validateMigrationEnv } = require('./check-migration-env.js')

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  // If DIRECT_URL is not explicitly set in environment, derive it from DATABASE_URL
  // Automatically strip '-pooler.' to use direct connection for migrations if using Neon pooler
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace('-pooler.', '.')
}

const migrationEnv = validateMigrationEnv(process.env)
if (!migrationEnv.ok) {
  migrationEnv.errors.forEach((message) => console.error(`[render:build] ${message}`))
  process.exit(1)
}

try {
  console.log('[render:build] 1/3 Generating Prisma client…')
  execSync('npx prisma generate', { stdio: 'inherit', env: process.env })

  console.log('[render:build] 2/3 Deploying Prisma migrations…')
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env })

  console.log('[render:build] 3/3 Running catalog schema migrations…')
  execSync('node src/db/migrate.js', { stdio: 'inherit', env: process.env })

  console.log('[render:build] Render build completed successfully!')
} catch (err) {
  console.error('[render:build] Build failed:', err.message)
  process.exit(1)
}
