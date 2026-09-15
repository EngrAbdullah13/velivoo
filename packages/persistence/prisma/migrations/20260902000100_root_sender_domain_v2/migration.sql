ALTER TABLE "sender_domain"
  ADD COLUMN "provisioning_version" TEXT NOT NULL DEFAULT 'V1_LEGACY_SEND_SUBDOMAIN',
  ADD COLUMN "provisioning_caller_reference" TEXT,
  ADD COLUMN "provisioning_lease_owner" TEXT,
  ADD COLUMN "provisioning_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "verification_status" TEXT,
  ADD COLUMN "delegation_status" TEXT,
  ADD COLUMN "soa_status" TEXT,
  ADD COLUMN "dkim_tokens_json" JSONB,
  ADD COLUMN "dkim_signing_hosted_zone" TEXT,
  ADD COLUMN "dmarc_observation_json" JSONB,
  ADD COLUMN "disconnect_status" TEXT;

CREATE UNIQUE INDEX "sender_domain_active_v2_root_unique"
  ON "sender_domain" (lower("root_domain"))
  WHERE "archived_at" IS NULL AND "provisioning_version" = 'V2_ROOT_SENDER_DELEGATED_INFRA';
CREATE INDEX "sender_domain_provisioning_lease_idx" ON "sender_domain" ("provisioning_lease_expires_at");

CREATE TABLE "sender_domain_transfer" (
  "id" UUID NOT NULL,
  "sender_domain_id" UUID NOT NULL,
  "from_workspace_id" UUID NOT NULL,
  "to_workspace_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "challenge_hash" TEXT,
  "expires_at" TIMESTAMPTZ(6),
  "approved_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sender_domain_transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sender_domain_transfer_sender_domain_id_fkey" FOREIGN KEY ("sender_domain_id") REFERENCES "sender_domain"("id") ON DELETE RESTRICT
);
CREATE INDEX "sender_domain_transfer_domain_status_idx" ON "sender_domain_transfer"("sender_domain_id", "status");
CREATE INDEX "sender_domain_transfer_target_status_idx" ON "sender_domain_transfer"("to_workspace_id", "status");
