-- Phase 3 / WP3: typed segments, generic events, flow identity and activation gate.
CREATE TABLE IF NOT EXISTS "segment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL REFERENCES "workspace"("id") ON DELETE RESTRICT,"name" TEXT NOT NULL,"description" TEXT NOT NULL DEFAULT '',"status" TEXT NOT NULL DEFAULT 'draft',"draft_rule_json" JSONB NOT NULL,"row_version" BIGINT NOT NULL DEFAULT 1,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "segment_workspace_status_idx" ON "segment"("workspace_id","status","updated_at");
CREATE TABLE IF NOT EXISTS "segment_version" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"segment_id" UUID NOT NULL REFERENCES "segment"("id") ON DELETE RESTRICT,"version_number" INTEGER NOT NULL,"rule_ast_json" JSONB NOT NULL,"rule_schema_version" INTEGER NOT NULL DEFAULT 1,"published_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"published_by" UUID,CONSTRAINT "segment_version_key" UNIQUE("segment_id","version_number")
);
CREATE TABLE IF NOT EXISTS "segment_membership_projection" (
  "workspace_id" UUID NOT NULL,"segment_id" UUID NOT NULL,"segment_version_id" UUID NOT NULL,"profile_id" UUID NOT NULL,"is_member" BOOLEAN NOT NULL,"evaluated_at" TIMESTAMPTZ NOT NULL,"evaluation_revision" BIGINT NOT NULL DEFAULT 1,PRIMARY KEY("segment_version_id","profile_id")
);
CREATE INDEX IF NOT EXISTS "segment_projection_workspace_idx" ON "segment_membership_projection"("workspace_id","segment_id","is_member","evaluated_at");
CREATE TABLE IF NOT EXISTS "event_schema" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"event_name" TEXT NOT NULL,"schema_version" INTEGER NOT NULL,"property_schema_json" JSONB NOT NULL,"status" TEXT NOT NULL DEFAULT 'active',"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "event_schema_key" UNIQUE("workspace_id","event_name","schema_version")
);
CREATE TABLE IF NOT EXISTS "event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"event_name" TEXT NOT NULL,"external_event_id" TEXT NOT NULL,"profile_id" UUID,"source" TEXT NOT NULL,"source_version" TEXT,"occurred_at" TIMESTAMPTZ NOT NULL,"received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"properties_json" JSONB NOT NULL,"schema_version" INTEGER NOT NULL,"idempotency_key" TEXT NOT NULL,"processing_status" TEXT NOT NULL DEFAULT 'accepted',CONSTRAINT "event_idempotency_key" UNIQUE("workspace_id","source","idempotency_key")
);
CREATE INDEX IF NOT EXISTS "event_workspace_name_time_idx" ON "event"("workspace_id","event_name","occurred_at");
CREATE TABLE IF NOT EXISTS "api_credential" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"name" TEXT NOT NULL,"prefix" TEXT NOT NULL,"secret_hash" TEXT NOT NULL,"scopes_json" JSONB NOT NULL,"created_by" UUID,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"last_used_at" TIMESTAMPTZ,"expires_at" TIMESTAMPTZ,"revoked_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "api_credential_workspace_idx" ON "api_credential"("workspace_id","revoked_at","expires_at");
CREATE TABLE IF NOT EXISTS "flow" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL REFERENCES "workspace"("id") ON DELETE RESTRICT,"name" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'draft',"draft_graph_json" JSONB NOT NULL,"active_version_id" UUID,"row_version" BIGINT NOT NULL DEFAULT 1,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "flow_workspace_status_idx" ON "flow"("workspace_id","status","updated_at");
ALTER TABLE "flow_version" ADD COLUMN IF NOT EXISTS "entry_policy_json" JSONB,ADD COLUMN IF NOT EXISTS "exit_rules_json" JSONB,ADD COLUMN IF NOT EXISTS "published_by" UUID;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "trigger_event_id" UUID;
CREATE TABLE IF NOT EXISTS "phase3_gate_evidence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"check_key" TEXT NOT NULL UNIQUE,"status" TEXT NOT NULL,"evidence_json" JSONB NOT NULL,"checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
