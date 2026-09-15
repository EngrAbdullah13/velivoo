-- Prisma upsert targets a unique constraint, not a partial unique index.
-- PostgreSQL permits multiple NULL values in a normal UNIQUE constraint, so this
-- keeps the original optional-key behavior while allowing ON CONFLICT to work.
ALTER TABLE "scheduled_action"
  DROP CONSTRAINT IF EXISTS "scheduled_action_deduplication_key_key";

DROP INDEX IF EXISTS "scheduled_action_deduplication_key_key";

ALTER TABLE "scheduled_action"
  ADD CONSTRAINT "scheduled_action_deduplication_key_key"
  UNIQUE ("deduplication_key");
