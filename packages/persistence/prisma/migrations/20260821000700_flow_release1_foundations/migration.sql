ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "active_version_activated_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "flow_trigger_dependency" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "flow_version_id" UUID NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "reference_id" UUID,
  "event_name" TEXT,
  "schema_version" INTEGER,
  "date_field" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "flow_trigger_dependency_version_type_key" UNIQUE ("flow_version_id", "trigger_type")
);
CREATE INDEX IF NOT EXISTS "flow_trigger_dependency_reference_idx" ON "flow_trigger_dependency"("workspace_id", "trigger_type", "reference_id");
CREATE INDEX IF NOT EXISTS "flow_trigger_dependency_event_idx" ON "flow_trigger_dependency"("workspace_id", "trigger_type", "event_name", "schema_version");

CREATE TABLE IF NOT EXISTS "flow_validation_result" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "row_version" BIGINT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "issues_json" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "flow_validation_result_flow_version_key" UNIQUE ("flow_id", "row_version")
);
CREATE INDEX IF NOT EXISTS "flow_validation_result_lookup_idx" ON "flow_validation_result"("workspace_id", "flow_id", "checked_at");

CREATE INDEX IF NOT EXISTS "flow_run_flow_entered_idx" ON "flow_run"("workspace_id", "flow_id", "entered_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "message_flow_run_created_idx" ON "message"("workspace_id", "flow_run_id", "created_at" DESC, "id" DESC);

CREATE OR REPLACE FUNCTION "prevent_flow_version_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PUBLISHED_FLOW_VERSION_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "flow_version_immutable" ON "flow_version";
CREATE TRIGGER "flow_version_immutable" BEFORE UPDATE OR DELETE ON "flow_version"
  FOR EACH ROW EXECUTE FUNCTION "prevent_flow_version_mutation"();
