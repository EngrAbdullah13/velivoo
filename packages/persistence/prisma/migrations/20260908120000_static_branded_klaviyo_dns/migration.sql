-- Klaviyo-style static branded DNS: dual DKIM selectors + rotation state.

ALTER TABLE sender_domain
  ADD COLUMN IF NOT EXISTS dkim_standby_selector TEXT,
  ADD COLUMN IF NOT EXISTS dkim_standby_public_key TEXT,
  ADD COLUMN IF NOT EXISTS dkim_standby_private_key_secret_ref TEXT,
  ADD COLUMN IF NOT EXISTS dkim_rotation_state TEXT,
  ADD COLUMN IF NOT EXISTS dkim_rotation_grace_until TIMESTAMPTZ;

UPDATE sender_domain
SET dkim_rotation_state = 'stable'
WHERE provisioning_mode = 'static_branded'
  AND dkim_rotation_state IS NULL;
