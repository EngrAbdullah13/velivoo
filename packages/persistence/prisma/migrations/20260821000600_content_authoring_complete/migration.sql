ALTER TABLE "email_definition"
  ADD COLUMN IF NOT EXISTS "plain_text_mode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "plain_text_stale" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "last_preflight_json" JSONB,
  ADD COLUMN IF NOT EXISTS "last_preflight_fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "last_preflight_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "archived_by" UUID;

ALTER TABLE "email_version"
  ADD COLUMN IF NOT EXISTS "tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "open_tracking_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "sender_snapshot_json" JSONB;

CREATE TABLE IF NOT EXISTS "email_test_snapshot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "email_definition_id" UUID NOT NULL,
  "draft_row_version" BIGINT NOT NULL,
  "source_document_json" JSONB NOT NULL,
  "subject_template" TEXT NOT NULL,
  "preheader_template" TEXT NOT NULL DEFAULT '',
  "compiled_html" TEXT NOT NULL,
  "compiled_text" TEXT NOT NULL,
  "sender_identity_id" UUID NOT NULL,
  "reply_to" TEXT NOT NULL,
  "sender_snapshot_json" JSONB NOT NULL,
  "tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "content_hash" TEXT NOT NULL,
  "compiler_version" TEXT NOT NULL,
  "preflight_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "email_flow_dependency" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "email_definition_id" UUID NOT NULL,
  "email_version_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "flow_version_id" UUID NOT NULL,
  "node_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("flow_version_id", "node_id")
);

ALTER TABLE "message"
  ALTER COLUMN "email_version_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "email_test_snapshot_id" UUID;

CREATE INDEX IF NOT EXISTS "email_definition_workspace_archive_updated_idx" ON "email_definition"("workspace_id", "archived_at", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "email_version_workspace_definition_version_idx" ON "email_version"("workspace_id", "email_definition_id", "version_number");
CREATE INDEX IF NOT EXISTS "email_test_snapshot_workspace_definition_created_idx" ON "email_test_snapshot"("workspace_id", "email_definition_id", "created_at");
CREATE INDEX IF NOT EXISTS "email_flow_dependency_workspace_definition_idx" ON "email_flow_dependency"("workspace_id", "email_definition_id");
CREATE INDEX IF NOT EXISTS "message_workspace_email_version_idx" ON "message"("workspace_id", "email_version_id");
CREATE INDEX IF NOT EXISTS "message_workspace_email_test_snapshot_idx" ON "message"("workspace_id", "email_test_snapshot_id");

CREATE OR REPLACE FUNCTION prevent_email_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EMAIL_VERSION_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_version_immutable_update ON "email_version";
CREATE TRIGGER email_version_immutable_update BEFORE UPDATE OR DELETE ON "email_version"
FOR EACH ROW EXECUTE FUNCTION prevent_email_version_mutation();
