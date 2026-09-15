-- Phase 2 / WP2: content and controlled-delivery expansion.

CREATE TABLE IF NOT EXISTS "email_definition" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "authoring_mode" TEXT NOT NULL DEFAULT 'structured',
  "draft_document_json" JSONB NOT NULL,
  "draft_html_source" TEXT,
  "draft_subject" TEXT NOT NULL DEFAULT '',
  "draft_preheader" TEXT NOT NULL DEFAULT '',
  "draft_sender_identity_id" UUID,
  "draft_reply_to" TEXT NOT NULL DEFAULT '',
  "draft_plain_text" TEXT NOT NULL DEFAULT '',
  "tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
  "open_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "email_definition_workspace_updated_idx" ON "email_definition"("workspace_id","updated_at","id");

ALTER TABLE "email_version"
  ADD COLUMN IF NOT EXISTS "authoring_mode" TEXT NOT NULL DEFAULT 'structured',
  ADD COLUMN IF NOT EXISTS "authoring_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "source_document_json" JSONB,
  ADD COLUMN IF NOT EXISTS "sanitized_source" TEXT,
  ADD COLUMN IF NOT EXISTS "preheader_template" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reply_to" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "compiler_version" TEXT NOT NULL DEFAULT 'phase2-structured-v1',
  ADD COLUMN IF NOT EXISTS "sanitizer_version" TEXT NOT NULL DEFAULT 'phase2-conservative-v1',
  ADD COLUMN IF NOT EXISTS "preflight_json" JSONB,
  ADD COLUMN IF NOT EXISTS "published_by" UUID;

CREATE TABLE IF NOT EXISTS "send_policy" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "frequency_window_seconds" INTEGER NOT NULL DEFAULT 86400,
  "frequency_max" INTEGER NOT NULL DEFAULT 3,
  "quiet_hours_json" JSONB,
  "timezone_fallback" TEXT NOT NULL DEFAULT 'workspace',
  "warming_json" JSONB,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "send_policy_workspace_version_key" UNIQUE ("workspace_id","policy_version")
);
CREATE INDEX IF NOT EXISTS "send_policy_workspace_active_idx" ON "send_policy"("workspace_id","active","created_at");

CREATE TABLE IF NOT EXISTS "operational_hold" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT,
  "reason" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMPTZ,
  "release_reason" TEXT
);
CREATE INDEX IF NOT EXISTS "operational_hold_workspace_idx" ON "operational_hold"("workspace_id","state","scope_type","created_at");

CREATE TABLE IF NOT EXISTS "frequency_reservation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'marketing',
  "reserved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "released_at" TIMESTAMPTZ,
  CONSTRAINT "frequency_reservation_workspace_message_key" UNIQUE ("workspace_id","message_id")
);
CREATE INDEX IF NOT EXISTS "frequency_reservation_profile_idx" ON "frequency_reservation"("workspace_id","profile_id","purpose","reserved_at");

CREATE TABLE IF NOT EXISTS "rendered_message_artifact" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "mime_hash" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "compiler_version" TEXT NOT NULL,
  "sanitizer_version" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rendered_message_artifact_workspace_message_key" UNIQUE ("workspace_id","message_id")
);

CREATE TABLE IF NOT EXISTS "tracking_link" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "destination" TEXT NOT NULL,
  "destination_hash" TEXT NOT NULL,
  "token_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "tracking_link_message_idx" ON "tracking_link"("workspace_id","message_id");
CREATE INDEX IF NOT EXISTS "tracking_link_dedupe_idx" ON "tracking_link"("workspace_id","message_id","destination_hash");

CREATE TABLE IF NOT EXISTS "phase2_gate_evidence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_key" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
