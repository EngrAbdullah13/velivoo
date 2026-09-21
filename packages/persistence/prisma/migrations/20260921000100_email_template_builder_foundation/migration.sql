-- Additive foundation for the replacement template editor. Existing source,
-- design, and approved-version columns are deliberately retained unchanged.
ALTER TABLE "email_template"
  ADD COLUMN IF NOT EXISTS "editor_type" TEXT,
  ADD COLUMN IF NOT EXISTS "source_type" TEXT,
  ADD COLUMN IF NOT EXISTS "draft_schema_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "draft_design_json" JSONB,
  ADD COLUMN IF NOT EXISTS "draft_revision" BIGINT,
  ADD COLUMN IF NOT EXISTS "updated_by" UUID;

ALTER TABLE "email_template_version"
  ADD COLUMN IF NOT EXISTS "editor_type" TEXT,
  ADD COLUMN IF NOT EXISTS "design_schema_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "design_json" JSONB,
  ADD COLUMN IF NOT EXISTS "source_html" TEXT,
  ADD COLUMN IF NOT EXISTS "rendered_html" TEXT;

-- An unmigrated row keeps null in the new columns. A later checkpoint may
-- promote an individual draft only after its rendering has been verified.
-- The existing immutable-version trigger remains in force.
