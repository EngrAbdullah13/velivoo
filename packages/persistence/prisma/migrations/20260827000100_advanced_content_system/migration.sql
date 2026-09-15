CREATE TABLE IF NOT EXISTS "universal_block" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "name" TEXT NOT NULL, "category" TEXT,
  "blocks_json" JSONB NOT NULL, "created_by" UUID, "archived_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "universal_block_workspace_active_updated_idx" ON "universal_block"("workspace_id","archived_at","updated_at");

CREATE TABLE IF NOT EXISTS "media_asset" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "name" TEXT NOT NULL, "url" TEXT NOT NULL,
  "alt_text" TEXT NOT NULL DEFAULT '', "mime_type" TEXT NOT NULL DEFAULT 'image/*', "created_by" UUID, "archived_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "media_asset_workspace_active_updated_idx" ON "media_asset"("workspace_id","archived_at","updated_at");

CREATE TABLE IF NOT EXISTS "workspace_brand_kit" (
  "workspace_id" UUID PRIMARY KEY, "logo_url" TEXT, "primary_color" TEXT NOT NULL DEFAULT '#6846ed', "secondary_color" TEXT NOT NULL DEFAULT '#17131c',
  "font_family" TEXT NOT NULL DEFAULT 'Arial, sans-serif', "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "content_variable" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "key" TEXT NOT NULL, "label" TEXT NOT NULL,
  "default_value" TEXT NOT NULL DEFAULT '', "type" TEXT NOT NULL DEFAULT 'text', "created_by" UUID, "archived_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE("workspace_id","key")
);
CREATE INDEX IF NOT EXISTS "content_variable_workspace_active_label_idx" ON "content_variable"("workspace_id","archived_at","label");

CREATE TABLE IF NOT EXISTS "email_template_version" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "template_id" UUID NOT NULL, "version_number" INTEGER NOT NULL,
  "document_json" JSONB NOT NULL, "subject_template" TEXT NOT NULL, "preheader_template" TEXT NOT NULL, "plain_text" TEXT NOT NULL,
  "settings_json" JSONB, "content_hash" TEXT NOT NULL, "approved_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "approved_by" UUID NOT NULL,
  UNIQUE("template_id","version_number")
);
CREATE INDEX IF NOT EXISTS "email_template_version_workspace_template_version_idx" ON "email_template_version"("workspace_id","template_id","version_number");
CREATE OR REPLACE FUNCTION prevent_email_template_version_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'EMAIL_TEMPLATE_VERSION_IMMUTABLE'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS email_template_version_immutable ON "email_template_version";
CREATE TRIGGER email_template_version_immutable BEFORE UPDATE OR DELETE ON "email_template_version" FOR EACH ROW EXECUTE FUNCTION prevent_email_template_version_mutation();

CREATE TABLE IF NOT EXISTS "template_usage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" UUID NOT NULL, "template_id" UUID NOT NULL, "template_version_id" UUID,
  "usage_type" TEXT NOT NULL, "reference_id" UUID NOT NULL, "label" TEXT NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "template_usage_workspace_template_created_idx" ON "template_usage"("workspace_id","template_id","created_at");
