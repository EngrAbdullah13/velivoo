-- Bounded Deliverability dashboard projections query only tenant-scoped,
-- time-windowed operational facts. These indexes avoid full-table scans as
-- production message and feedback volumes grow.
CREATE INDEX IF NOT EXISTS "suppression_workspace_channel_created_idx"
  ON "suppression"("workspace_id", "channel", "created_at");
CREATE INDEX IF NOT EXISTS "message_workspace_source_submitted_idx"
  ON "message"("workspace_id", "source_type", "submitted_at");
CREATE INDEX IF NOT EXISTS "delivery_event_workspace_type_occurred_idx"
  ON "delivery_event"("workspace_id", "event_type", "occurred_at");
CREATE INDEX IF NOT EXISTS "inbox_message_workspace_source_status_received_idx"
  ON "inbox_message"("workspace_id", "source", "status", "received_at");
