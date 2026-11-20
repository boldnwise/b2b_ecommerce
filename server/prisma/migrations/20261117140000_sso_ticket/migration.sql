-- SSO phase 1: Authify internal id and one-time ticket hashes.
-- Does not alter existing user ids, portal_user_id, or business foreign keys.

ALTER TABLE "users" ADD COLUMN "authify_user_id" VARCHAR(32);

CREATE UNIQUE INDEX "users_authify_user_id_key" ON "users"("authify_user_id");

CREATE TABLE "sso_tickets" (
    "id" TEXT NOT NULL,
    "ticket_hash" VARCHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "audience" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sso_tickets_ticket_hash_key" ON "sso_tickets"("ticket_hash");

CREATE INDEX "sso_tickets_user_id_idx" ON "sso_tickets"("user_id");

CREATE INDEX "sso_tickets_expires_at_idx" ON "sso_tickets"("expires_at");

ALTER TABLE "sso_tickets" ADD CONSTRAINT "sso_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
