# Testing Guide — B2B Marketplace

This repository contains two separate applications:

| App | Path | Stack |
|-----|------|-------|
| Frontend | `client/` | React + Vite + Vitest + Playwright |
| Backend | `server/` | Express + Prisma + Jest + Supertest |

Business logic is **not** modified by the test infrastructure. Tests validate existing behaviour only.

---

## Prerequisites

- **Node.js 22.x**
- **PostgreSQL** (required for Playwright E2E and optional integration runs)
- Demo seed data (`server/prisma/seed.js`) for authenticated E2E flows

---

## Quick start (from repo root)

```bash
npm ci --prefix server
npm ci --prefix client
cd client && npx playwright install --with-deps && cd ..

cd server
npm run db:ci:setup
cd ..

npm run test:ci
```

---

## Backend tests (Jest + Supertest)

```
server/src/__tests__/     # legacy integration tests
server/tests/api/         # API route tests
server/tests/integration/ # catalog integration
server/tests/security/    # authz + validation
```

```bash
cd server
npm test
npm run test:api
npm run test:integration
npm run test:security
npm run test:coverage
npm run lint
```

ESLint is scoped to **test infrastructure files** (`tests/`, `src/__tests__/`, config files) so existing application source is not modified to satisfy lint rules.

---

## Frontend unit tests (Vitest)

```bash
cd client
npm test
npm run test:coverage
npm run lint
```

---

## Playwright E2E

```
client/tests/smoke/
client/tests/regression/
client/tests/e2e/
client/tests/fixtures/
```

Config: `client/playwright.config.js`

Features: Chromium, Firefox, WebKit · retries in CI · trace on retry · screenshots/video on failure · HTML report.

```bash
cd client
npm run test:smoke
npm run test:regression
npm run test:e2e
npm run test:e2e:ci
npx playwright show-report
```

### Test database

Playwright starts the API against `DATABASE_URL` (default `postgresql://test:test@127.0.0.1:5432/test_db`).
The config refuses any database that is not on `localhost`/`127.0.0.1` or whose name does not
contain `test`, and it never reads `server/.env`. The tests write to this database: they create
SSO users, tickets, and RFQs.

The seed scripts load `server/.env` for any variable that is not already set, so set
`DATABASE_URL` and `DIRECT_URL` in the same shell first. `db:reset` deletes and re-seeds every row
in that database.

PowerShell:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://<user>:<password>@127.0.0.1:5432/test_db'
$env:DIRECT_URL = $env:DATABASE_URL

cd server
npx prisma generate
npx prisma migrate deploy
npm run db:reset           # destructive
npm run catalog:migrate
npm run catalog:seed

cd ../client
npm run test:e2e:ci
```

bash: `export` the same three variables, then run the same commands. `npm run db:ci:setup` runs the five
server steps in one go, as CI does.

To keep an existing test database instead of resetting it, run the safe seed and then upsert the
Playwright catalog listings (20 `E2E-*` products for `seller.premium1@test.com`, needed by the RFQ
flow). Neither command deletes data, and both can be re-run:

```powershell
cd server
npm run db:seed                # safe seed: users, addresses, subscriptions
npm run db:seed:e2e-products   # E2E listings only; refuses non-local or non-"test" databases
```

### API server and test SSO secret

Buyers and sellers sign in through a test SSO handoff. Playwright starts the API with
`SSO_S2S_SECRET` (`client/tests/fixtures/sso.js`, override with `PLAYWRIGHT_SSO_S2S_SECRET`) and
`SSO_HANDOFF_ALLOWED_ORIGINS` set to a stand-in Authify origin (`http://localhost:4599`, override with
`PLAYWRIGHT_AUTHIFY_ORIGIN`).

If something already listens on port 3001, the run fails instead of reusing it. To reuse a server
you started yourself, start it with the two values above and set `PLAYWRIGHT_REUSE_API_SERVER=1`
(or `PLAYWRIGHT_SKIP_WEBSERVER=1`). `tests/global-setup.js` then sends a signed probe and stops the
run unless the API holds the test secret. The probe makes no database writes.

### Seeded accounts (`server/prisma/seed/constants.js`)

| Account | Sign-in | Subscription |
|---------|---------|--------------|
| `buyer.premium1@test.com` | Test SSO, Authify ID `900000000001` | Buyer lifetime |
| `seller.premium1@test.com` | Test SSO, Authify ID `900000000002` | Seller lifetime |
| `both.premium1@test.com` | Test SSO, Authify ID `900000000007` | Both lifetime |
| `admin@b2b.local` | Password at `/admin/login` | — |

Buyer and seller password login is refused (`SSO_REQUIRED`).

---

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml`

On every push/PR: lint → `migrate deploy` + seed → build → Jest → Vitest → Playwright (auto-starts API + Vite via `webServer`) → upload coverage + HTML reports.

---

## Manual tests still required

- Razorpay payment verification with real keys
- File uploads (product images, contact attachments)
- Production cross-origin cookie behaviour (Vercel + Render)
- Load/stress testing
- Full WCAG accessibility audit
