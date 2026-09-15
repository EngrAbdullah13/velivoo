-- Phase 1 / WP1: platform + audience foundation.
-- This migration expands the Phase 0 proof schema without deleting Phase 0 evidence.

ALTER TABLE "workspace"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "row_version" BIGINT NOT NULL DEFAULT 1;

ALTER TABLE "profile"
  ADD COLUMN IF NOT EXISTS "last_name" TEXT,
  ADD COLUMN IF NOT EXISTS "locale" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "country_code" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "source_details_json" JSONB,
  ADD COLUMN IF NOT EXISTS "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "engagement_summary_json" JSONB,
  ADD COLUMN IF NOT EXISTS "eligibility_projection_json" JSONB,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

ALTER TABLE "consent_record"
  ADD COLUMN IF NOT EXISTS "jurisdiction" TEXT,
  ADD COLUMN IF NOT EXISTS "evidence_object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_id" UUID;

ALTER TABLE "suppression"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "metadata_json" JSONB;

-- Replace the Phase 0 sender identity proof shape with the Phase 1 domain shape.
CREATE TABLE IF NOT EXISTS "sender_domain" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "domain" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "expected_records_json" JSONB,
  "observed_records_json" JSONB,
  "last_checked_at" TIMESTAMPTZ,
  "verified_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sender_domain_workspace_domain_key" UNIQUE ("workspace_id","domain")
);
CREATE INDEX IF NOT EXISTS "sender_domain_workspace_status_idx" ON "sender_domain"("workspace_id","status");

ALTER TABLE "sender_identity"
  ADD COLUMN IF NOT EXISTS "domain_id" UUID,
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Phase 0's domain_ready is no longer canonical; retain the column for backward migration compatibility.

CREATE TABLE IF NOT EXISTS "user_identity" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "provider_subject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "display_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_identity_provider_subject_key" UNIQUE ("provider","provider_subject")
);
CREATE INDEX IF NOT EXISTS "user_identity_email_idx" ON "user_identity"("email");

CREATE TABLE IF NOT EXISTS "workspace_member" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "invited_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_member_workspace_user_key" UNIQUE ("workspace_id","user_id")
);
CREATE INDEX IF NOT EXISTS "workspace_member_workspace_role_idx" ON "workspace_member"("workspace_id","role","status");

CREATE TABLE IF NOT EXISTS "workspace_invitation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "invited_by" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_invitation_workspace_token_key" UNIQUE ("workspace_id","token_hash")
);
CREATE INDEX IF NOT EXISTS "workspace_invitation_email_idx" ON "workspace_invitation"("workspace_id","email","expires_at");

CREATE TABLE IF NOT EXISTS "profile_identifier" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "normalized_value" TEXT NOT NULL,
  "original_value" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "verified_at" TIMESTAMPTZ,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_identifier_workspace_kind_value_key" UNIQUE ("workspace_id","kind","normalized_value")
);
CREATE INDEX IF NOT EXISTS "profile_identifier_profile_idx" ON "profile_identifier"("workspace_id","profile_id");

CREATE TABLE IF NOT EXISTS "profile_property_definition" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "data_type" TEXT NOT NULL,
  "is_array" BOOLEAN NOT NULL DEFAULT false,
  "validation_json" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_property_definition_workspace_key" UNIQUE ("workspace_id","key")
);

CREATE TABLE IF NOT EXISTS "profile_property_value" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "text_value" TEXT,
  "number_value" NUMERIC(30,10),
  "boolean_value" BOOLEAN,
  "datetime_value" TIMESTAMPTZ,
  "json_value" JSONB,
  "source" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "profile_property_value_workspace_profile_definition_key" UNIQUE ("workspace_id","profile_id","definition_id"),
  CONSTRAINT "profile_property_value_exactly_one" CHECK (
    (("text_value" IS NOT NULL)::int + ("number_value" IS NOT NULL)::int + ("boolean_value" IS NOT NULL)::int + ("datetime_value" IS NOT NULL)::int + ("json_value" IS NOT NULL)::int) = 1
  )
);
CREATE INDEX IF NOT EXISTS "profile_property_value_definition_idx" ON "profile_property_value"("workspace_id","definition_id","profile_id");

CREATE TABLE IF NOT EXISTS "profile_merge" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "canonical_profile_id" UUID NOT NULL,
  "source_profile_id" UUID NOT NULL,
  "policy_json" JSONB NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "profile_merge_canonical_idx" ON "profile_merge"("workspace_id","canonical_profile_id","created_at");

CREATE TABLE IF NOT EXISTS "audience_list" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "audience_list_workspace_status_idx" ON "audience_list"("workspace_id","status","created_at");

CREATE TABLE IF NOT EXISTS "list_membership" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "list_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "state" TEXT NOT NULL,
  "joined_at" TIMESTAMPTZ NOT NULL,
  "left_at" TIMESTAMPTZ,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT,
  "actor_id" UUID,
  CONSTRAINT "list_membership_workspace_list_profile_key" UNIQUE ("workspace_id","list_id","profile_id")
);
CREATE INDEX IF NOT EXISTS "list_membership_profile_idx" ON "list_membership"("workspace_id","profile_id","state");

CREATE TABLE IF NOT EXISTS "subscription_state" (
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "current_status" TEXT NOT NULL,
  "effective_at" TIMESTAMPTZ NOT NULL,
  "source_consent_record_id" UUID NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY ("workspace_id","profile_id","channel","purpose")
);

CREATE TABLE IF NOT EXISTS "import_job" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "object_key" TEXT,
  "original_name" TEXT,
  "checksum" TEXT,
  "content_hash" TEXT,
  "state" TEXT NOT NULL,
  "mapping_json" JSONB,
  "policy_json" JSONB,
  "totals_json" JSONB,
  "error_object_key" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "import_job_workspace_idx" ON "import_job"("workspace_id","created_at","id");
CREATE INDEX IF NOT EXISTS "import_job_content_hash_idx" ON "import_job"("workspace_id","content_hash","state");

CREATE TABLE IF NOT EXISTS "import_chunk" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "import_job_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "row_start" INTEGER NOT NULL,
  "row_end" INTEGER NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "import_chunk_job_index_key" UNIQUE ("import_job_id","chunk_index")
);
CREATE INDEX IF NOT EXISTS "import_chunk_state_idx" ON "import_chunk"("workspace_id","import_job_id","state");

CREATE TABLE IF NOT EXISTS "import_row_result" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "import_job_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "profile_id" UUID,
  "errors_json" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_row_result_job_row_key" UNIQUE ("import_job_id","row_number")
);
CREATE INDEX IF NOT EXISTS "import_row_result_state_idx" ON "import_row_result"("workspace_id","import_job_id","state");

CREATE TABLE IF NOT EXISTS "import_change" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "import_job_id" UUID NOT NULL,
  "profile_id" UUID,
  "change_type" TEXT NOT NULL,
  "field_key" TEXT,
  "before_json" JSONB,
  "after_json" JSONB,
  "revision" BIGINT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "import_change_job_idx" ON "import_change"("workspace_id","import_job_id","id");

CREATE TABLE IF NOT EXISTS "export_job" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "state" TEXT NOT NULL,
  "scope_json" JSONB NOT NULL,
  "fields_json" JSONB NOT NULL,
  "purpose" TEXT,
  "object_key" TEXT,
  "token_hash" TEXT,
  "record_count" INTEGER,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "export_job_workspace_idx" ON "export_job"("workspace_id","created_at","id");

CREATE TABLE IF NOT EXISTS "audit_event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_id" UUID,
  "action" TEXT NOT NULL,
  "object_type" TEXT NOT NULL,
  "object_id" TEXT,
  "risk_level" TEXT NOT NULL,
  "before_json" JSONB,
  "after_json" JSONB,
  "request_id" TEXT,
  "correlation_id" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "support_access_grant_id" UUID
);
CREATE INDEX IF NOT EXISTS "audit_event_workspace_time_idx" ON "audit_event"("workspace_id","occurred_at","id");
CREATE INDEX IF NOT EXISTS "audit_event_action_idx" ON "audit_event"("workspace_id","action","occurred_at");

CREATE TABLE IF NOT EXISTS "workspace_readiness_check" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "check_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "evidence_json" JSONB,
  "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_readiness_workspace_check_key" UNIQUE ("workspace_id","check_key")
);
CREATE INDEX IF NOT EXISTS "workspace_readiness_status_idx" ON "workspace_readiness_check"("workspace_id","status");

-- Phase 1 adds a useful safety invariant: only one active suppression for a specific reason.
DROP INDEX IF EXISTS "suppression_active_reason_unique";
CREATE UNIQUE INDEX "suppression_active_reason_unique"
ON "suppression"("workspace_id","profile_id","channel","reason")
WHERE "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "phase1_gate_evidence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_key" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
