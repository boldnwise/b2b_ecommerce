# Deployment & Database Migrations

## Overview

Production deployments must use **Prisma Migrate**, not `prisma db push`.

| Environment | Command |
|-------------|---------|
| Development | `npm run db:migrate` (`prisma migrate dev`) |
| CI / Production | `npm run db:migrate:deploy` (`prisma migrate deploy`) |

## Migration files (apply in order)

| Migration | Purpose |
|-----------|---------|
| `20250715170000_baseline` | Full schema baseline |
| `20250715180000_rfq_production_hardening` | Idempotent RFQ hardening for legacy `db push` DBs |
| `20260531120000_both_bundle_plans` | Subscription bundle plan enums |
| `20260717120000_marketplace_identity` | Buyer/seller marketplace IDs |
| `20260717130000_marketplace_id_counter` | Marketplace ID counter table |
| `20260717140000_rfq_mvp_hardening` | RFQ revisions, CANCELLED status, notification events |
| `20260717150000_rfq_not_selected_status` | `NOT_SELECTED` quote status for multi-seller accept flow |

### Fresh database (CI, new production)

```bash
cd server
npm run db:migrate:deploy
npm run catalog:migrate
npm run catalog:seed   # browse catalog for marketing /products page
npm run db:seed        # non-production only
```

### Existing database (previously synced with `db push`)

1. Back up the database.
2. Mark baseline as applied if objects already exist:
   ```bash
   npx prisma migrate resolve --applied 20250715170000_baseline
   ```
3. Deploy remaining migrations:
   ```bash
   npm run db:migrate:deploy
   npm run catalog:migrate
   ```

### Verify migrations

```bash
cd server
npm run db:migrate:deploy
# Expected: "No pending migrations" or lists newly applied migrations
npm run db:generate
```

## Render / production build

`npm run render:build` runs:

1. `prisma generate`
2. `prisma migrate deploy`
3. Catalog schema migration (`node src/db/migrate.js`)

Start command: `npm start` (`node src/index.js`)

### Required environment variables (server)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon recommended, `?sslmode=require`) |
| `JWT_SECRET` | Long random string (32+ chars) |
| `CLIENT_URL` | Primary frontend origin for CORS + cross-site cookies (e.g. `https://git-repo-gilt.vercel.app`) |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated allowlist merged with `CLIENT_URL`; supports wildcards for Vercel previews (e.g. `https://git-repo-*.vercel.app`) |
| `CORS_ALLOWED_HEADERS` | Optional comma-separated `Access-Control-Allow-Headers` override; default includes `Cache-Control` for credentialed cross-origin requests |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payment gateway (test keys OK in staging) |
| `NODE_ENV` | `production` in production |

Optional: `PORT` (default `3001`), `USE_CROSS_SITE_COOKIES=true` when API and frontend are on different domains.

## Docker

```bash
cp server/.env.example server/.env   # set DATABASE_URL, JWT_SECRET, etc.
docker compose up --build -d server client
```

- **Server:** runs `docker-entrypoint.sh` → `prisma migrate deploy` → starts API on `:3001`
- **Client:** built with `VITE_API_BASE_URL=/api`; nginx proxies `/api/` to `server:3001`

## Frontend production build

| Target | `VITE_API_BASE_URL` |
|--------|----------------------|
| Vercel + Render API | `https://your-service.onrender.com/api` |
| Docker / same-origin nginx | `/api` |
| Local production test | `http://localhost:3001/api` (default in `client/.env.production`) |

## Playwright CI

GitHub Actions (`.github/workflows/ci.yml`):

1. Starts PostgreSQL service
2. Runs `db:ci:setup` (`migrate deploy` + transactional seed + catalog migrate/seed)
3. Builds frontend with `VITE_API_BASE_URL=http://127.0.0.1:3001/api`
4. Playwright starts backend + Vite, runs E2E tests

Local E2E:

```bash
cd server && npm run db:ci:setup
cd ../client && npm run test:e2e:ci
```

## Attachment storage

### RFQ (quote request) files

| Environment | Driver | Storage |
|-------------|--------|---------|
| Local dev | `RFQ_STORAGE_DRIVER=local` (default) | `server/uploads/rfq/` |
| AWS API (staging/production) | `RFQ_STORAGE_DRIVER=s3` | Private S3 bucket |

**API contract (unchanged):** uploads via `POST /api/quote-requests/attachments`; downloads via authenticated `GET /api/quote-requests/attachments/file/:filename`. The API streams from disk or S3 — **no public object URLs** in JSON metadata.

**Required when `RFQ_STORAGE_DRIVER=s3`:**

- `RFQ_S3_BUCKET` — private bucket (Block Public Access enabled)
- `AWS_REGION` — e.g. `ap-south-1`
- `RFQ_S3_PREFIX` — optional, default `rfq/`

**Credentials:** use the EC2 instance IAM role (AWS SDK default credential chain). Do **not** set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` on the API host.

**Least-privilege IAM policy (attach to EC2 role):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/rfq/*"
    }
  ]
}
```

Adjust `Resource` if you use a non-default `RFQ_S3_PREFIX`. Legacy files that exist only on disk are still served when S3 returns `NoSuchKey` (read-only fallback).

Optional virus scanning: set `RFQ_VIRUS_SCAN_URL` when integrating external AV.
