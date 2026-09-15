-- The runtime writes idempotent audience-transition outbox events.  Older
-- local databases were created before this field existed, so add it without
-- altering or deleting prior events.
ALTER TABLE "outbox_event"
  ADD COLUMN IF NOT EXISTS "deduplication_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "outbox_event_deduplication_key_key"
  ON "outbox_event"("deduplication_key")
  WHERE "deduplication_key" IS NOT NULL;
