# Deployment & Database Migrations

## Overview

Production and AWS staging deployments must use **Prisma Migrate**, not `prisma db push`.

When `NODE_ENV=production`, the API **`serve` path does not run migrations**. Apply schema changes with an explicit one-off task **before** starting (or replacing) the application process.

| Environment | Command |
|-------------|---------|
| Development | `npm run db:migrate` (`prisma migrate dev`) |
| Release (staging / production / AWS) | `npm run db:migrate:release` (`scripts/migrate-release.js`) |
| CI test database | `npm run db:ci:setup` |
| Render build helper | `npm run render:build` (generate + migrate deploy + catalog SQL during **build**, not `serve`) |

### Release migration (`npm run db:migrate:release`)

Validated against `server/package.json` and `server/scripts/migrate-release.js`. From `server/`:

```bash
cd server
npm run db:migrate:release
```

That script:

1. Validates `DATABASE_URL` and `DIRECT_URL` (`scripts/check-migration-env.js`).
2. Runs `prisma migrate deploy` (via `DIRECT_URL`).
3. Runs catalog schema SQL (`node src/db/migrate.js`, no `--seed`).

It does **not** seed data, create admin accounts, or start the API. Stop on first failure.

Docker equivalent (same task):

```bash
docker compose run --rm server migrate
```

(`scripts/docker-entrypoint.sh` mode `migrate` execs `node scripts/migrate-release.js`.)

### Start the API (no auto-migrate)

```bash
cd server
npm start
# node src/index.js
```

Docker default entrypoint mode is **`serve`**: starts `node src/index.js` only. With `NODE_ENV=production`, `RUN_MIGRATIONS=true` and `SEED_DB=true` are **refused**.

Health: `GET /api/health` (200 and `"status":"ok"` when the process and database are ready).

## Migration files (Prisma, apply in order via `migrate deploy`)

| Migration | Purpose |
|-----------|---------|
| `20250715170000_baseline` | Full schema baseline |
| `20250715180000_rfq_production_hardening` | Idempotent RFQ hardening for legacy `db push` DBs |
| `20260531120000_both_bundle_plans` | Subscription bundle plan enums |
| `20260717120000_marketplace_identity` | Buyer/seller marketplace IDs |
| `20260717130000_marketplace_id_counter` | Marketplace ID counter table |
| `20260717140000_rfq_mvp_hardening` | RFQ revisions, CANCELLED status, notification events |
| `20260717150000_rfq_not_selected_status` | `NOT_SELECTED` quote status for multi-seller accept flow |
| `20260718120000_portal_user_id` | Portal user id |
| `20260718163000_deal_management` | Deal management |
| `20260718170000_deal_management_finalize` | Deal management finalize |
| `20260718180000_product_upload_persistence` | Product upload persistence |
| `20260718200000_contact_message_replies` | Contact message replies |
| `20260719120000_category_request_parent_id` | Category request parent |
| `20260722120000_product_uom_user_soft_delete` | Product UOM / user soft-delete |
| `20260722153000_product_uom_user_soft_delete` | Follow-up UOM / soft-delete |
| `20260724000000_update_subscription_plan_enum` | Subscription plan enum |
| `20260724120000_payment_razorpay_payment_id_unique` | Unique Razorpay payment id |

RFQ private S3 storage does **not** add a Prisma migration (attachment metadata remains JSON on `QuoteRequest`).

### Fresh database (CI, new environment)

```bash
cd server
npm run db:migrate:release
# Optional: npm run catalog:seed
# Loads demo/browse catalog rows into this database. Skip on a real staging/production
# RDS unless you explicitly want that sample catalog.
# npm run db:seed      # development / CI only — not for NODE_ENV=production serve
```

### Existing database (previously synced with `db push`)

1. Back up the database.
2. Mark baseline as applied if objects already exist:
   ```bash
   npx prisma migrate resolve --applied 20250715170000_baseline
   ```
3. Deploy remaining migrations:
   ```bash
   npm run db:migrate:release
   ```

### Verify migrations

```bash
cd server
npm run db:migrate:release
# Expected: success with no pending Prisma migrations, catalog SQL applied
npm run db:generate
```

## Environment variables (server)

Read from `server/src/config/env.js` unless noted. Do not set variables the process does not read.

### Always required to start

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL URL for the running API (use TLS as required by the host, e.g. `sslmode=require`) |
| `JWT_SECRET` | ≥32 characters; production rejects placeholders (`replace-with`, `changeme`, `example`, …) |

### Required when `NODE_ENV=production` (`npm start`)

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` on AWS API hosts (cookie/CORS production rules) |
| `CLIENT_URL` | Browser origin for CORS + cookies (comma-separated allowed). **Must match the frontend Origin exactly** (no trailing slash). HTTPS non-localhost origins enable `SameSite=None; Secure`. **There is no `USE_CROSS_SITE_COOKIES` env var** — that flag is derived from `CLIENT_URL` / `CORS_ALLOWED_ORIGINS`. Localhost is rejected in production. |

These are **not** required for `npm start`. They change behavior or are used only by the migration task.

| Variable | When it is needed |
|----------|-------------------|
| `APP_ENV` | Optional at runtime. When `NODE_ENV=production`: must be `staging` or `production` if set; **default `production`** if omitted. Invalid values refuse startup. Use `staging` to skip live Razorpay at boot. |
| `CORS_ALLOWED_ORIGINS` | Optional extra origins merged with `CLIENT_URL` |
| `CORS_ALLOWED_HEADERS` | Optional `Access-Control-Allow-Headers` override |
| `PORT` | Optional; default `3001` |
| `CSRF_PROTECTION_ENABLED` | Optional; default on |
| `DIRECT_URL` | **Not read by `npm start`.** Required only for **`npm run db:migrate:release`** (unpooled / non-`-pooler` URL). Set it on the migration task, not as a substitute for `DATABASE_URL`. |

### Razorpay (unchanged product scope)

| `APP_ENV` | Startup |
|-----------|---------|
| `production` or omitted | Live `RAZORPAY_KEY_ID` (`rzp_live_*`), `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` are **required** or the process exits |
| `staging` | Process **may start** without Razorpay. Checkout returns **503 `RAZORPAY_NOT_CONFIGURED`** until key id + secret are set. Missing webhook secret keeps **503 `WEBHOOK_NOT_CONFIGURED`**. Test keys are allowed at startup on staging only; they do **not** fake payment success or skip signature checks |

Dummy deal payments stay **disabled** whenever `NODE_ENV=production` (including staging).

### RFQ attachments

| Variable | Description |
|----------|-------------|
| `RFQ_STORAGE_DRIVER` | `local` (default, `server/uploads/rfq/`) or `s3` |
| `RFQ_S3_BUCKET` | **Required** if driver is `s3` |
| `AWS_REGION` | **Required** if driver is `s3` |
| `RFQ_S3_PREFIX` | Optional object-key prefix; default `rfq/` (a trailing slash is added if missing) |

`S3Client` is constructed with `{ region }` only (`server/src/services/rfqAttachmentStorage.js`). Credentials come from the **AWS SDK default provider chain** (EC2 instance profile / IAM role). **Do not** set `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` on the API host.

Optional: `RFQ_VIRUS_SCAN_URL` — if set, uploads fail closed until a scanner is wired (`rfqFileValidation.js`).

## AWS staging / production (manual)

Target: HTTPS frontend on S3 + CloudFront; API on EC2 behind an ALB; private RDS; private RFQ bucket. Hostinger DNS: **new staging names only**; do not change Main Portal records unless separately approved.

### Frontend build (`VITE_API_BASE_URL`)

Validated in `client/src/constants/env.js` / `client/vite.config.js`. Production builds need an absolute URL ending in `/api`:

Unix-like shells:

```bash
cd client
VITE_API_BASE_URL=https://YOUR_API_HOST/api npm run build
```

PowerShell:

```powershell
cd client
$env:VITE_API_BASE_URL = "https://YOUR_API_HOST/api"
npm run build
```

| Target | `VITE_API_BASE_URL` |
|--------|----------------------|
| CloudFront SPA + ALB/EC2 API | `https://<api-hostname>/api` |
| Docker / same-origin nginx | `/api` |
| Local production-mode test | `http://localhost:3001/api` |

Rebuild after changing `VITE_*`. `VITE_BACKEND_URL` is **dev-server proxy only**, not the production API base.

Set API `CLIENT_URL` to the **CloudFront (or other HTTPS) origin** the browser uses, not the S3 website endpoint if that is not the Origin header.

### RFQ private S3

| Environment | Driver | Bytes |
|-------------|--------|--------|
| Local development | `local` (default) | `server/uploads/rfq/` |
| AWS API | `s3` | Private bucket; API URLs unchanged |

**API contract:** `POST /api/quote-requests/attachments` (authenticated buyer); `GET /api/quote-requests/attachments/file/:filename` (authenticated; authorized before GetObject). JSON stores relative API paths — **not** public object URLs. Uploads do not set object ACLs.

**Bucket (operations, not created by this repo):** Block Public Access on; no public ACLs; encryption as chosen (SSE-S3 or SSE-KMS). If the bucket uses KMS, the instance role also needs decrypt/generate-data-key on that key (not expressed in application code).

**Least-privilege IAM (attach to the EC2 role; replace bucket and prefix):**

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

### Legacy local files and orphan objects (not solved in application code)

- **Legacy:** If `RFQ_STORAGE_DRIVER=s3` and S3 returns `NoSuchKey` / `NotFound`, the API may serve a file still on **this instance** under `uploads/rfq/` (path-safe). AccessDenied and other S3 errors do **not** use that fallback. A new EC2 host has an empty disk unless you copy files. There is **no** built-in bulk migrate-from-disk job.
- **Orphans:** Upload persists bytes **before** RFQ create writes JSON. Abandoned or failed creates can leave S3 objects (or local files). There is **no** `DeleteObject` or lifecycle cleanup in the app. Unreferenced keys remain **403** for non-admin downloads.

## Render / production build (legacy PaaS)

`npm run render:build` (`scripts/render-build.js`) runs `prisma generate`, `prisma migrate deploy`, and catalog SQL **at build time**. That is **not** the AWS `serve` path. AWS/EC2 should use **`db:migrate:release` then `npm start`**.

## Docker

```bash
cp server/.env.example server/.env
# Set DATABASE_URL, DIRECT_URL, JWT_SECRET, CLIENT_URL, NODE_ENV, APP_ENV as needed.
docker compose run --rm server migrate    # one-off: db:migrate:release
docker compose up -d server client        # serve does not migrate when NODE_ENV=production
```

Use `docker compose up -d --build server client` when the image must be rebuilt (Dockerfile, `package-lock.json`, or application source changed since the last build). `up -d` without `--build` reuses the existing image and can run a stale API.

- **Server:** `docker-entrypoint.sh` default **`serve`** → `node src/index.js` on `:3001`.
- **Client image:** typically `VITE_API_BASE_URL=/api` with nginx proxying `/api/` to `server:3001` (same-origin). Split CloudFront/ALB hosting uses a client **build** with an absolute `https://…/api` URL instead of this compose client.

## Playwright CI

GitHub Actions (`.github/workflows/ci.yml`):

1. Starts PostgreSQL service
2. Runs `db:ci:setup`
3. Builds frontend with `VITE_API_BASE_URL=http://127.0.0.1:3001/api`
4. Playwright starts backend + Vite (Chromium, then Firefox & WebKit)

Browser OS deps are installed via `.github/scripts/ci-playwright-install.sh` (bounded `install-deps`, Azure-mirror retry).

Local E2E:

```bash
cd server && npm run db:ci:setup
cd ../client && npm run test:e2e:ci
```

## Staging smoke tests (after AWS resources exist)

Manual; does not replace CI. Use a real buyer (and a second user without access) on the staging API + frontend.

1. `GET https://<api-host>/api/health` — 200, database ok.
2. Authenticated RFQ attachment upload (allowed type/size) — 201; JSON `url` is `/api/quote-requests/attachments/file/…` (not an `s3.amazonaws.com` URL).
3. Authorized download of that file — 200, expected bytes/type.
4. Other authenticated user without RFQ ownership — **403**; must not receive the object.
5. Unauthenticated download — **401**.
6. Invalid type / MIME mismatch / oversized image (>5 MB) or document (>10 MB) — **400**; no successful S3 put for rejected files.
7. Confirm IAM: missing GetObject permission should surface as **503** storage unavailable, **not** a silent local-disk fallback (AccessDenied is not treated as a missing key).
8. Restart the API process; authorized download of a file uploaded **to S3** still succeeds (bytes are not only on ephemeral disk).
9. Optional: create RFQ JSON pointing at a filename that exists only on old disk — fallback only if that file is on **this** host.
10. Note any upload-without-create as an **orphan**; do not expect automatic cleanup.

Razorpay checkout is **out of scope** until explicitly enabled; with `APP_ENV=staging` and no keys, checkout stays 503.
