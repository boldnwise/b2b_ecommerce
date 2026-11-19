# B2B Ecommerce API

Production-oriented REST API: **Express**, **PostgreSQL**, **Prisma**, **JWT** auth (roles: `BUYER`, `SELLER`, `ADMIN`).

## Setup

1. **PostgreSQL** — use [Neon](https://neon.tech) (recommended) or any PostgreSQL 14+ instance.

2. **Environment**

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your Neon connection string (pooled host, `?sslmode=require`),
   `JWT_SECRET` (long random string), and optionally `PORT` / `CLIENT_URL`.

3. **Install & database**

   ```bash
   npm install
   npx prisma generate
   npm run db:migrate:deploy
   npm run catalog:migrate
   npm run db:seed
   ```

   Seed creates an admin user (only if missing): `admin@b2b.local` / `admin123` — **change or remove in production**.

4. **Run**

   ```bash
   npm run dev
   ```

   Default: `http://localhost:3001`

## API overview

Base URL: `/api`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness |
| POST | `/auth/register` | — | Always 403 `REGISTRATION_DISABLED`; accounts are created through Authify SSO |
| POST | `/auth/login` | — | Admin password login. Buyers and sellers get 403 `SSO_REQUIRED` |
| GET | `/auth/me` | JWT | Current user |
| GET | `/products` | Optional | List products (pagination, `search`, `sellerId`, `mine`, `includeInactive` for seller/admin) |
| GET | `/products/:id` | Optional | Product detail |
| POST | `/products` | Seller / Admin | Create product (`sellerId` required if admin) |
| PATCH | `/products/:id` | Seller / Admin | Update product |
| DELETE | `/products/:id` | Seller / Admin | Delete product |
| POST | `/orders` | Buyer / Admin | Create order (single seller per order; `buyerId` if admin) |
| GET | `/orders` | JWT | Buyer: own orders; Seller: own orders; Admin: all |
| GET | `/orders/:id` | JWT | Order detail (participant or admin) |
| PATCH | `/orders/:id/status` | Seller / Admin | Update status |

Send JWT as: `Authorization: Bearer <token>`

## Error format

```json
{
  "success": false,
  "error": {
    "message": "…",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

Validation failures (`code: VALIDATION_ERROR`) include Zod `details` in development-friendly shape.

---

## Catalog module (`/api/catalog`)

Browse-only reference catalog backed by **raw PostgreSQL** (`pg`) in the `catalog` schema. Mounted at `/api/catalog` (see `server/src/routes/catalog.routes.js`).

### Setup

```bash
npm run catalog:migrate
npm run catalog:seed   # optional sample data
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/catalog/products` | Cursor-paginated product list (`q`, `category`, `brand`, `cursor`, `limit`) |
| `GET` | `/api/catalog/products/:id` | Product detail |
| `GET` | `/api/catalog/products/:id/alternative-sellers` | Multi-seller listings for RFQ |
| `GET` | `/api/catalog/categories` | Category list |
| `GET` | `/api/catalog/brands` | Brand list |

### Example

```bash
curl "http://localhost:3001/api/catalog/products?limit=10"
curl "http://localhost:3001/api/catalog/products?category=laptops"
```

Response shape:

```json
{
  "success": true,
  "data": {
    "products": [ /* ... */ ],
    "nextCursor": "opaque-cursor-or-null"
  }
}
```

### Code layout

```
server/src/
├── db/
│   ├── pool.js
│   ├── migrate.js
│   └── migrations/001_catalog.sql
├── services/catalogProductService.js
├── controllers/catalogController.js
└── routes/catalog.routes.js    # mounted at /api/catalog in app.js
```

