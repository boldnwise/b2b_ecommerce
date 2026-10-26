# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — install ALL deps and generate the Prisma client
# (prisma CLI + schema engine are needed here but not shipped in the final image)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — lean production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Production deps only (prisma is in dependencies so its engines are included)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the pre-generated Prisma client from the builder stage; avoids
# re-running `prisma generate` and pulling in dev tooling at runtime.
COPY --from=builder /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Application source, Prisma schema/migrations, and one-off task scripts
# (scripts/migrate-release.js, scripts/bootstrap-admin.js) in the same image
COPY src     ./src
COPY prisma  ./prisma
COPY scripts ./scripts

# Default: start the API only — no migrations at startup.
# One-off migration task: run this image with the argument `migrate`.
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["./docker-entrypoint.sh"]
