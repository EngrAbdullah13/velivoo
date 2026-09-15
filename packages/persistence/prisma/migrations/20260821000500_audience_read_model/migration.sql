-- Audience Release 1: bounded list reads and version-aware segment evaluation.
ALTER TABLE "audience_list"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "audience_list_workspace_id_status_updated_at_id_idx"
  ON "audience_list" ("workspace_id", "status", "updated_at", "id");

CREATE INDEX IF NOT EXISTS "list_membership_workspace_id_list_id_state_joined_at_id_idx"
  ON "list_membership" ("workspace_id", "list_id", "state", "joined_at", "id");

CREATE TABLE IF NOT EXISTS "segment_evaluation_run" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "segment_id" UUID NOT NULL,
  "segment_version_id" UUID NOT NULL,
  "state" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ(6),
  "evaluated_at" TIMESTAMPTZ(6),
  "member_count" INTEGER,
  "error_code" TEXT
);

CREATE INDEX IF NOT EXISTS "segment_evaluation_run_workspace_id_segment_id_segment_version_id_started_at_idx"
  ON "segment_evaluation_run" ("workspace_id", "segment_id", "segment_version_id", "started_at");
CREATE INDEX IF NOT EXISTS "segment_evaluation_run_workspace_id_segment_id_state_completed_at_idx"
  ON "segment_evaluation_run" ("workspace_id", "segment_id", "state", "completed_at");
