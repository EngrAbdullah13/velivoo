-- SES open events are durable recipient engagement facts. Keep these values on
-- the send record itself so campaign and flow analytics can query them without
-- parsing provider payloads.
ALTER TABLE "message"
  ADD COLUMN IF NOT EXISTS "first_opened_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "last_opened_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "open_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "message_workspace_source_opened_idx"
  ON "message" ("workspace_id", "source_type", "source_id", "first_opened_at");
