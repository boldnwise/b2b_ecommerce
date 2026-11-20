## B2B Marketplace Frontend (Vite + React)

Production B2B marketplace UI: React 19, React Router 7, Redux Toolkit, Axios, React Hook Form + Yup.

### Environment variables

Copy the example and adjust for your environment:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE_URL` | Production builds | Full API URL (`https://host.onrender.com/api`) or `/api` for Docker/nginx proxy |
| `VITE_API_URL` | No | Legacy alias for `VITE_API_BASE_URL` |
| `VITE_AUTHIFY_FRONTEND_URL` | No | Authify Main Portal origin for the "Continue to Authify" link (staging: `https://app-staging.boldnwise.com`) |
| `VITE_BACKEND_URL` | Dev only | Vite dev-server proxy target (default `http://localhost:3001`) |

**Local development** — no `.env` required; Vite proxies `/api` to `localhost:3001`.

**Production build** — `client/.env.production` defaults to `http://localhost:3001/api`. Override in CI/Vercel/Docker:

```bash
VITE_API_BASE_URL=https://your-api.onrender.com/api npm run build
```

### Scripts

```bash
npm run dev          # Vite dev server (port 5173)
npm run build        # Production bundle → dist/
npm run preview      # Preview production build
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
```

### Architecture notes

- **Routing:** lazy-loaded routes in `src/router/AppRoutes.jsx`
- **API:** all HTTP via `src/services/api.js` (cookie auth, `withCredentials: true`)
- **Auth:** JWT in httpOnly cookie; Redux auth slice in `src/store/slices/authSlice.js`
- **Protected routes:** `src/router/ProtectedRoute.jsx` (role, workspace, subscription guards)

### Deployment

- **Vercel:** set `VITE_API_BASE_URL` to your Render API URL (must end with `/api`). Rebuild after changing env vars.
- **Docker:** build with `VITE_API_BASE_URL=/api`; nginx proxies `/api` to the backend service.

Ensure backend CORS allows your frontend origin (`CLIENT_URL` on the server).
