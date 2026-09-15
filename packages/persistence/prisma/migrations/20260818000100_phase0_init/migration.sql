CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "workspace" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "legal_name" TEXT NOT NULL,
  "business_address" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sending_enabled" BOOLEAN NOT NULL DEFAULT false,
  "sender_ready" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "profile" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspace"("id") ON DELETE RESTRICT,
  "normalized_email" TEXT NOT NULL,
  "original_email" TEXT NOT NULL,
  "first_name" TEXT,
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "profile_workspace_email_key" UNIQUE ("workspace_id", "normalized_email")
);
CREATE INDEX "profile_workspace_created_idx" ON "profile"("workspace_id","created_at","id");

CREATE TABLE "consent_record" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "source_details_json" JSONB
);
CREATE INDEX "consent_lookup_idx" ON "consent_record"("workspace_id","profile_id","channel","purpose","occurred_at");

CREATE TABLE "suppression" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "source_reference" TEXT,
  "protected" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ
);
CREATE INDEX "suppression_lookup_idx" ON "suppression"("workspace_id","profile_id","channel","revoked_at");

CREATE TABLE "sender_identity" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "from_name" TEXT NOT NULL,
  "from_email" TEXT NOT NULL,
  "reply_to" TEXT NOT NULL,
  "domain_ready" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sender_identity_workspace_from_key" UNIQUE ("workspace_id","from_email")
);

CREATE TABLE "email_version" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "email_definition_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "subject_template" TEXT NOT NULL,
  "compiled_html" TEXT NOT NULL,
  "compiled_text" TEXT NOT NULL,
  "sender_identity_id" UUID NOT NULL,
  "content_hash" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "email_version_definition_version_key" UNIQUE ("email_definition_id","version_number")
);
CREATE INDEX "email_version_workspace_idx" ON "email_version"("workspace_id","id");

CREATE TABLE "flow_version" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "graph_json" JSONB NOT NULL,
  "graph_schema_version" INTEGER NOT NULL DEFAULT 1,
  "graph_hash" TEXT NOT NULL,
  "published_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "flow_version_flow_version_key" UNIQUE ("flow_id","version_number")
);
CREATE INDEX "flow_version_workspace_flow_idx" ON "flow_version"("workspace_id","flow_id");

CREATE TABLE "flow_run" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "flow_version_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "deduplication_key" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "current_node_id" TEXT NOT NULL,
  "entered_at" TIMESTAMPTZ NOT NULL,
  "next_action_at" TIMESTAMPTZ,
  "ended_at" TIMESTAMPTZ,
  "exit_reason" TEXT,
  "row_version" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "flow_run_dedupe_key" UNIQUE ("workspace_id","flow_version_id","deduplication_key")
);
CREATE INDEX "flow_run_state_idx" ON "flow_run"("workspace_id","state","next_action_at");

CREATE TABLE "flow_node_execution" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_run_id" UUID NOT NULL,
  "node_id" TEXT NOT NULL,
  "attempt_sequence" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "scheduled_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "input_snapshot_json" JSONB,
  "evaluation_result_json" JSONB,
  "error_json" JSONB,
  CONSTRAINT "flow_node_execution_key" UNIQUE ("flow_run_id","node_id","attempt_sequence")
);
CREATE INDEX "flow_node_execution_workspace_idx" ON "flow_node_execution"("workspace_id","flow_run_id");

CREATE TABLE "scheduled_action" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "action_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "due_at" TIMESTAMPTZ NOT NULL,
  "state" TEXT NOT NULL,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "payload_version" INTEGER NOT NULL DEFAULT 1,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX "scheduled_due_idx" ON "scheduled_action"("state","due_at");
CREATE INDEX "scheduled_workspace_aggregate_idx" ON "scheduled_action"("workspace_id","aggregate_id");

CREATE TABLE "message" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "flow_run_id" UUID,
  "node_id" TEXT,
  "profile_id" UUID NOT NULL,
  "email_version_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "policy_decision_json" JSONB,
  "rendered_hash" TEXT,
  "scheduled_for" TIMESTAMPTZ NOT NULL,
  "rendered_at" TIMESTAMPTZ,
  "submitted_at" TIMESTAMPTZ,
  "final_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_workspace_idempotency_key" UNIQUE ("workspace_id","idempotency_key")
);
CREATE INDEX "message_workspace_profile_idx" ON "message"("workspace_id","profile_id","created_at");

CREATE TABLE "delivery_attempt" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "route_id" TEXT,
  "request_fingerprint" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "state" TEXT NOT NULL,
  "submitted_at" TIMESTAMPTZ,
  "response_at" TIMESTAMPTZ,
  "error_class" TEXT,
  "error_code" TEXT,
  CONSTRAINT "delivery_attempt_message_attempt_key" UNIQUE ("message_id","attempt_number")
);
CREATE INDEX "delivery_attempt_provider_id_idx" ON "delivery_attempt"("workspace_id","provider_message_id");

CREATE TABLE "delivery_event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL,
  "normalized_payload_json" JSONB,
  CONSTRAINT "delivery_event_provider_event_key" UNIQUE ("provider","provider_event_id")
);
CREATE INDEX "delivery_event_message_idx" ON "delivery_event"("workspace_id","message_id","occurred_at");

CREATE TABLE "outbox_event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL DEFAULT 1,
  "payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT
);
CREATE INDEX "outbox_unpublished_idx" ON "outbox_event"("published_at","created_at");

CREATE TABLE "inbox_message" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" TEXT NOT NULL,
  "workspace_id" UUID,
  "external_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ,
  "status" TEXT NOT NULL,
  "error_code" TEXT,
  CONSTRAINT "inbox_source_external_key" UNIQUE ("source","external_id")
);

CREATE TABLE "trace_event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "detail_json" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "trace_workspace_aggregate_idx" ON "trace_event"("workspace_id","aggregate_id","occurred_at");

CREATE TABLE "phase0_gate_evidence" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "check_key" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "suppression_active_reason_unique"
ON "suppression"("workspace_id","profile_id","channel","reason")
WHERE "revoked_at" IS NULL;
