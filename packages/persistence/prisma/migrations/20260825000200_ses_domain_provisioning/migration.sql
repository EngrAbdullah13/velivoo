-- Provider-neutral, workspace-scoped sending-domain evidence and SES mapping.
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "provider_identity_reference" TEXT;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "provider_region" TEXT;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "provider_status" TEXT;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "provider_evidence_json" JSONB;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "dkim_status" TEXT;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "mail_from_status" TEXT;
ALTER TABLE "sender_domain" ADD COLUMN IF NOT EXISTS "dmarc_status" TEXT;
CREATE INDEX IF NOT EXISTS "sender_domain_provider_reference_idx" ON "sender_domain"("provider_identity_reference");

CREATE TABLE IF NOT EXISTS "workspace_provider_config" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "ses_tenant_name" TEXT,
  "configuration_set_name" TEXT,
  "provider_status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_provider_config_workspace_provider_key" UNIQUE ("workspace_id", "provider")
);
CREATE INDEX IF NOT EXISTS "workspace_provider_config_workspace_status_idx" ON "workspace_provider_config"("workspace_id", "provider_status");
