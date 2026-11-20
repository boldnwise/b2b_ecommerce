-- Replay protection for SSO issue-ticket. Stores accepted nonces, not tickets or secrets.

CREATE TABLE "sso_nonces" (
    "id" TEXT NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_nonces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sso_nonces_nonce_key" ON "sso_nonces"("nonce");

CREATE INDEX "sso_nonces_expires_at_idx" ON "sso_nonces"("expires_at");
