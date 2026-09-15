ALTER TABLE "sender_domain"
  ADD COLUMN "ownership_verification_token" TEXT,
  ADD COLUMN "dkim_signing_mode" TEXT,
  ADD COLUMN "dkim_signing_domain" TEXT,
  ADD COLUMN "dkim_selector" TEXT;

CREATE TABLE "sender_domain_dkim_key" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sender_domain_id" UUID NOT NULL,
  "selector" TEXT NOT NULL,
  "signing_domain" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'rsa-sha256',
  "public_key" TEXT NOT NULL,
  "private_key_ciphertext" TEXT,
  "private_key_iv" TEXT,
  "private_key_tag" TEXT,
  "key_version" INTEGER NOT NULL DEFAULT 1,
  "state" TEXT NOT NULL DEFAULT 'active',
  "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retired_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sender_domain_dkim_key_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sender_domain_dkim_key_sender_domain_fkey"
    FOREIGN KEY ("sender_domain_id") REFERENCES "sender_domain"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sender_domain_dkim_key_sender_domain_id_selector_key"
  ON "sender_domain_dkim_key"("sender_domain_id", "selector");

CREATE INDEX "sender_domain_dkim_key_workspace_id_sender_domain_id_state_idx"
  ON "sender_domain_dkim_key"("workspace_id", "sender_domain_id", "state");
