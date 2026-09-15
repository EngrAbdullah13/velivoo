-- Release 1 Content reusable workspace templates.  Templates store only the
-- supported structured document and are always cloned into a mutable draft.
CREATE TABLE IF NOT EXISTS "email_template" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "document_json" JSONB NOT NULL,
  "subject_template" TEXT NOT NULL DEFAULT '',
  "preheader_template" TEXT NOT NULL DEFAULT '',
  "plain_text" TEXT NOT NULL DEFAULT '',
  "settings_json" JSONB,
  "created_by" UUID,
  "archived_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "email_template_workspace_active_updated_idx"
  ON "email_template"("workspace_id", "archived_at", "updated_at", "id");
