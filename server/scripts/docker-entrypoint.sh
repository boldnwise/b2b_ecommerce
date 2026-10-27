#!/bin/sh
# Docker container entrypoint.
#
# Modes (first argument):
#   serve    (default) start the API server. Never runs migrations or schema DDL
#            in deployed environments (NODE_ENV=production).
#   migrate  run the release migration task once (scripts/migrate-release.js:
#            prisma migrate deploy, then catalog schema SQL) and exit with its
#            status. Run exactly one such task per deployment, before updating
#            the application. Never seeds or creates accounts.
#
# Environment variables:
#   DATABASE_URL     — runtime connection; the API needs no DDL privileges.
#   DIRECT_URL       — migration connection (migrate mode / RUN_MIGRATIONS=true).
#   RUN_MIGRATIONS   — "true" runs the release migration before `serve`.
#                      Development only; refused when NODE_ENV=production.
#                      Default "false".
#   DB_WAIT_ATTEMPTS — connection attempts (2 s apart) before giving up. Default 30.
#   SEED_DB          — "true" seeds development demo data (requires RUN_MIGRATIONS=true).
#                      Refused (container exits before touching the database)
#                      when NODE_ENV=production, i.e. in staging and production.
#                      Deployed environments use the explicit one-off commands
#                      `npm run db:seed:reference` (staging, SEED_REFERENCE_DATA=true)
#                      and `npm run admin:bootstrap`.
set -e

MODE="${1:-serve}"
RUN_MIGRATIONS_VALUE=$(printf '%s' "${RUN_MIGRATIONS:-false}" | tr '[:upper:]' '[:lower:]')

if [ "${SEED_DB:-false}" = "true" ] && [ "${NODE_ENV:-}" = "production" ]; then
  echo "[entrypoint] Refusing to start: SEED_DB=true is not allowed when NODE_ENV=production." >&2
  echo "[entrypoint] Unset SEED_DB. Use 'npm run db:seed:reference' or 'npm run admin:bootstrap' as one-off tasks." >&2
  exit 1
fi

case "$RUN_MIGRATIONS_VALUE" in
  true|false) ;;
  *)
    echo "[entrypoint] RUN_MIGRATIONS must be \"true\" or \"false\"." >&2
    exit 1
    ;;
esac

if [ "$RUN_MIGRATIONS_VALUE" = "true" ] && [ "${NODE_ENV:-}" = "production" ]; then
  echo "[entrypoint] Refusing to start: RUN_MIGRATIONS=true is not allowed when NODE_ENV=production." >&2
  echo "[entrypoint] Run the one-off migration task ('migrate' mode) before deploying the application." >&2
  exit 1
fi

wait_for_database() {
  attempts=0
  max_attempts="${DB_WAIT_ATTEMPTS:-30}"
  echo "[entrypoint] Waiting for database to accept connections..."
  until node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
    c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$max_attempts" ]; then
      echo "[entrypoint] Database not reachable after $attempts attempts." >&2
      exit 1
    fi
    echo "[entrypoint] Database not ready — retrying in 2 s..."
    sleep 2
  done
  echo "[entrypoint] Database is ready."
}

case "$MODE" in
  migrate)
    wait_for_database
    echo "[entrypoint] Running release migrations (one-off task)..."
    exec node scripts/migrate-release.js
    ;;
  serve)
    if [ "${SEED_DB:-false}" = "true" ] && [ "$RUN_MIGRATIONS_VALUE" != "true" ]; then
      echo "[entrypoint] SEED_DB=true requires RUN_MIGRATIONS=true (development only)." >&2
      exit 1
    fi

    if [ "$RUN_MIGRATIONS_VALUE" = "true" ]; then
      wait_for_database
      echo "[entrypoint] RUN_MIGRATIONS=true — running release migrations (development only)..."
      node scripts/migrate-release.js
    fi

    if [ "${SEED_DB:-false}" = "true" ]; then
      echo "[entrypoint] Seeding Prisma demo data (development only)..."
      node prisma/seed.js
      echo "[entrypoint] Seeding catalog demo data..."
      node src/db/migrate.js --seed
    fi

    echo "[entrypoint] Starting API server..."
    exec node src/index.js
    ;;
  *)
    echo "[entrypoint] Unknown mode '$MODE' (expected: serve | migrate)." >&2
    exit 64
    ;;
esac
