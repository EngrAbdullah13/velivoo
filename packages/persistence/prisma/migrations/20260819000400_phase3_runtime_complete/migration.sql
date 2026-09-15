-- Phase 3 completion: durable execution controls, stable scheduled-action identity,
-- segment transitions and operator-safe dead-letter evidence.
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "entry_state" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "execution_state" TEXT NOT NULL DEFAULT 'running';
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMPTZ;
ALTER TABLE "scheduled_action" ADD COLUMN IF NOT EXISTS "deduplication_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_action_deduplication_key_key" ON "scheduled_action"("deduplication_key") WHERE "deduplication_key" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "segment_membership_transition" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"segment_id" UUID NOT NULL,"segment_version_id" UUID NOT NULL,"profile_id" UUID NOT NULL,
  "transition" TEXT NOT NULL,"transition_key" TEXT NOT NULL UNIQUE,"occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "segment_transition_workspace_idx" ON "segment_membership_transition"("workspace_id","segment_id","occurred_at");
CREATE TABLE IF NOT EXISTS "dead_letter_item" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),"workspace_id" UUID NOT NULL,"resource_type" TEXT NOT NULL,"resource_id" UUID NOT NULL,"job_type" TEXT NOT NULL,"business_key" TEXT NOT NULL,
  "error_json" JSONB NOT NULL,"state" TEXT NOT NULL DEFAULT 'open',"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"replayed_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "dead_letter_workspace_idx" ON "dead_letter_item"("workspace_id","state","created_at");
