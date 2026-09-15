CREATE TABLE "phase4_hardening_evidence" (
  "id" UUID PRIMARY KEY,
  "check_key" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "owner" TEXT NULL,
  "evidence_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "review_at" TIMESTAMPTZ NULL
);
CREATE INDEX "phase4_hardening_evidence_status_idx" ON "phase4_hardening_evidence"("status","recorded_at");

CREATE TABLE "phase4_pilot_observation" (
  "id" UUID PRIMARY KEY,
  "stage" INTEGER NOT NULL UNIQUE,
  "audience" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "finished_at" TIMESTAMPTZ NOT NULL,
  "health_passed" BOOLEAN NOT NULL,
  "unresolved_alerts" INTEGER NOT NULL,
  "expected_events_received" BOOLEAN NULL,
  "enough_feedback" BOOLEAN NULL,
  "within_warming_ceiling" BOOLEAN NULL,
  "complete_flow_cycle" BOOLEAN NULL,
  "approved_by" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "phase4_pilot_observation_health_idx" ON "phase4_pilot_observation"("health_passed","recorded_at");

CREATE TABLE "phase4_release_state" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'locked',
  "approved_at" TIMESTAMPTZ NULL,
  "approved_by" TEXT NULL,
  "notes" TEXT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO "phase4_release_state" ("id") VALUES ('release1') ON CONFLICT DO NOTHING;

CREATE TABLE "phase4_slo_observation" (
  "id" UUID PRIMARY KEY,
  "indicator" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "window_end" TIMESTAMPTZ NOT NULL,
  "observed_json" JSONB NOT NULL,
  "objective" TEXT NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "phase4_slo_observation_indicator_idx" ON "phase4_slo_observation"("indicator","recorded_at");

CREATE TABLE "phase4_migration_rehearsal" (
  "id" UUID PRIMARY KEY,
  "source_label" TEXT NOT NULL,
  "source_rows" INTEGER NOT NULL,
  "accepted_rows" INTEGER NOT NULL,
  "rejected_rows" INTEGER NOT NULL,
  "duplicate_rows" INTEGER NOT NULL,
  "invalid_rows" INTEGER NOT NULL,
  "missing_consent_rows" INTEGER NOT NULL,
  "suppressed_rows" INTEGER NOT NULL,
  "accepted_profiles" INTEGER NOT NULL,
  "list_memberships" INTEGER NOT NULL,
  "consent_granted" INTEGER NOT NULL,
  "exclusions" INTEGER NOT NULL,
  "reconciled" BOOLEAN NOT NULL,
  "source_of_truth_plan" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "finished_at" TIMESTAMPTZ NOT NULL,
  "owner" TEXT NOT NULL
);
CREATE INDEX "phase4_migration_rehearsal_reconciled_idx" ON "phase4_migration_rehearsal"("reconciled","finished_at");
