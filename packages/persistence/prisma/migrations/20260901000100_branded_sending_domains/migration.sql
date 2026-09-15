ALTER TABLE "sender_domain"
  ADD COLUMN "root_domain" TEXT,
  ADD COLUMN "delegated_subdomain" TEXT,
  ADD COLUMN "provisioning_mode" TEXT NOT NULL DEFAULT 'legacy_ses_records',
  ADD COLUMN "lifecycle_state" TEXT NOT NULL DEFAULT 'created',
  ADD COLUMN "authentication_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "readiness_status" TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN "readiness_reasons_json" JSONB,
  ADD COLUMN "dns_provider" TEXT,
  ADD COLUMN "hosted_zone_reference" TEXT,
  ADD COLUMN "delegation_set_reference" TEXT,
  ADD COLUMN "mail_from_domain" TEXT,
  ADD COLUMN "tracking_domain" TEXT,
  ADD COLUMN "tracking_provider" TEXT,
  ADD COLUMN "tracking_tenant_reference" TEXT,
  ADD COLUMN "tracking_connection_group_reference" TEXT,
  ADD COLUMN "tracking_routing_endpoint" TEXT,
  ADD COLUMN "tracking_certificate_reference" TEXT,
  ADD COLUMN "tracking_certificate_status" TEXT,
  ADD COLUMN "tracking_https_status" TEXT,
  ADD COLUMN "tracking_validation_method" TEXT,
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "last_error_message" TEXT,
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

UPDATE "sender_domain"
SET "root_domain" = "domain",
    "lifecycle_state" = CASE WHEN "status" = 'verified' THEN 'ready' ELSE 'authentication_verifying' END,
    "authentication_status" = CASE WHEN "status" = 'verified' THEN 'verified' ELSE 'pending' END,
    "readiness_status" = CASE WHEN "status" = 'verified' THEN 'ready' ELSE 'not_ready' END,
    "readiness_reasons_json" = CASE WHEN "status" = 'verified' THEN '[]'::jsonb ELSE '["LEGACY_AUTHENTICATION_PENDING"]'::jsonb END;

CREATE INDEX "sender_domain_workspace_id_lifecycle_state_idx" ON "sender_domain"("workspace_id", "lifecycle_state");
CREATE INDEX "sender_domain_workspace_id_readiness_status_idx" ON "sender_domain"("workspace_id", "readiness_status");

CREATE TABLE "sender_domain_dns_evidence" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sender_domain_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "ownership" TEXT NOT NULL,
  "record_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expected_value" TEXT NOT NULL,
  "observed_values_json" JSONB,
  "verification_status" TEXT NOT NULL,
  "customer_action_required" BOOLEAN NOT NULL DEFAULT false,
  "validation_method" TEXT,
  "last_checked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sender_domain_dns_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sender_domain_dns_evidence_sender_domain_id_fkey" FOREIGN KEY ("sender_domain_id") REFERENCES "sender_domain"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "sender_domain_dns_evidence_unique" ON "sender_domain_dns_evidence"("sender_domain_id", "purpose", "record_type", "name", "expected_value");
CREATE INDEX "sender_domain_dns_evidence_workspace_domain_action_idx" ON "sender_domain_dns_evidence"("workspace_id", "sender_domain_id", "customer_action_required");

CREATE TABLE "email_delivery_route" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sender_domain_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_region" TEXT NOT NULL,
  "provider_identity_reference" TEXT,
  "configuration_set_name" TEXT,
  "mail_from_domain" TEXT,
  "tracking_mode" TEXT NOT NULL DEFAULT 'platform',
  "tracking_hostname" TEXT,
  "status" TEXT NOT NULL DEFAULT 'provisioning',
  "hold_reason" TEXT,
  "rate_limit_per_second" INTEGER,
  "warming_daily_limit" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "email_delivery_route_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_delivery_route_sender_domain_id_fkey" FOREIGN KEY ("sender_domain_id") REFERENCES "sender_domain"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "email_delivery_route_workspace_domain_provider_key" ON "email_delivery_route"("workspace_id", "sender_domain_id", "provider");
CREATE INDEX "email_delivery_route_workspace_status_idx" ON "email_delivery_route"("workspace_id", "status");

CREATE TABLE "delivery_capacity_bucket" (
  "id" UUID NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "window_seconds" INTEGER NOT NULL,
  "capacity_limit" INTEGER NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "delivery_capacity_bucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_capacity_bucket_scope_window_key" ON "delivery_capacity_bucket"("scope_type", "scope_id", "window_start", "window_seconds");
CREATE INDEX "delivery_capacity_bucket_window_start_idx" ON "delivery_capacity_bucket"("window_start");

CREATE TABLE "provider_quota_snapshot" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "max_24_hour" DECIMAL(20,4),
  "max_send_rate" DECIMAL(20,4),
  "sent_last_24_hours" DECIMAL(20,4),
  "fetched_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "provider_quota_snapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_quota_snapshot_provider_region_key" ON "provider_quota_snapshot"("provider", "region");
CREATE INDEX "provider_quota_snapshot_expires_at_idx" ON "provider_quota_snapshot"("expires_at");

ALTER TABLE "delivery_attempt" ALTER COLUMN "route_id" TYPE UUID USING NULLIF("route_id", '')::uuid;
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "email_delivery_route"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "delivery_attempt_provider_provider_message_id_key" ON "delivery_attempt"("provider", "provider_message_id");
