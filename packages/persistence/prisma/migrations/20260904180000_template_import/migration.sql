-- Template import metadata and audit trail
ALTER TABLE "email_template"
  ADD COLUMN IF NOT EXISTS "template_type" TEXT NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS "import_method" TEXT,
  ADD COLUMN IF NOT EXISTS "original_filename" TEXT,
  ADD COLUMN IF NOT EXISTS "original_source_html" TEXT,
  ADD COLUMN IF NOT EXISTS "sanitized_html" TEXT,
  ADD COLUMN IF NOT EXISTS "conversion_status" TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS "import_warnings_json" JSONB,
  ADD COLUMN IF NOT EXISTS "imported_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "imported_by_user_id" UUID;

CREATE INDEX IF NOT EXISTS "email_template_workspace_id_template_type_updated_at_idx"
  ON "email_template"("workspace_id", "template_type", "updated_at");

CREATE TABLE IF NOT EXISTS "template_import_audit" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "import_method" TEXT NOT NULL,
  "filename" TEXT,
  "template_id" UUID,
  "processing_result" TEXT NOT NULL,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "template_import_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "template_import_audit_workspace_id_created_at_idx"
  ON "template_import_audit"("workspace_id", "created_at");

ALTER TABLE "media_asset" ADD COLUMN IF NOT EXISTS "object_key" TEXT;
