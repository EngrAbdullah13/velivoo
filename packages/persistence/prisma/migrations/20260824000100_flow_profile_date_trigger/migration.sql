CREATE TABLE IF NOT EXISTS "flow_date_trigger_schedule" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "flow_id" UUID NOT NULL,
  "flow_version_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "date_field" TEXT NOT NULL,
  "source_date" TIMESTAMPTZ NOT NULL,
  "due_at" TIMESTAMPTZ NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMPTZ,
  "dispatched_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "flow_date_trigger_schedule_version_profile_key" UNIQUE ("flow_version_id", "profile_id")
);

CREATE INDEX IF NOT EXISTS "flow_date_trigger_schedule_due_idx"
  ON "flow_date_trigger_schedule" ("workspace_id", "state", "due_at");
CREATE INDEX IF NOT EXISTS "flow_date_trigger_schedule_flow_idx"
  ON "flow_date_trigger_schedule" ("workspace_id", "flow_id", "flow_version_id");
