-- Analytics reads are bounded, tenant-scoped projections over canonical facts.
-- Keep these read paths index-supported and separate from delivery write paths.
CREATE INDEX IF NOT EXISTS "message_workspace_source_created_idx"
  ON "message"("workspace_id", "source_type", "created_at");
CREATE INDEX IF NOT EXISTS "flow_run_workspace_flow_entered_idx"
  ON "flow_run"("workspace_id", "flow_id", "entered_at");
CREATE INDEX IF NOT EXISTS "flow_run_workspace_flow_ended_idx"
  ON "flow_run"("workspace_id", "flow_id", "ended_at");
CREATE INDEX IF NOT EXISTS "flow_node_execution_workspace_completed_idx"
  ON "flow_node_execution"("workspace_id", "completed_at");
CREATE INDEX IF NOT EXISTS "trace_event_workspace_kind_occurred_idx"
  ON "trace_event"("workspace_id", "kind", "occurred_at");
