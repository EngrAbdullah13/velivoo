-- Marketing unsubscribe metadata on subscription projection (workspace-scoped).
ALTER TABLE subscription_state
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS unsubscribe_source TEXT,
  ADD COLUMN IF NOT EXISTS unsubscribe_campaign_id UUID,
  ADD COLUMN IF NOT EXISTS unsubscribe_message_id UUID,
  ADD COLUMN IF NOT EXISTS unsubscribe_method TEXT;
