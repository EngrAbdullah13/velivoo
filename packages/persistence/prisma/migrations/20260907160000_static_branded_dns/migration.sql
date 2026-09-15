-- Static branded DNS onboarding fields for BYODKIM + Velivoo DNS infrastructure.

ALTER TABLE sender_domain
  ADD COLUMN IF NOT EXISTS dkim_public_key TEXT,
  ADD COLUMN IF NOT EXISTS dkim_private_key_secret_ref TEXT,
  ADD COLUMN IF NOT EXISTS setup_mode TEXT,
  ADD COLUMN IF NOT EXISTS routing_id TEXT,
  ADD COLUMN IF NOT EXISTS ownership_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS ownership_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS ownership_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dns_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sender_domain_routing_id_key ON sender_domain (routing_id) WHERE routing_id IS NOT NULL;

UPDATE sender_domain
SET setup_mode = 'MANAGED_DELEGATION'
WHERE setup_mode IS NULL AND provisioning_mode = 'branded_delegation';

UPDATE sender_domain
SET setup_mode = 'STATIC_BRANDED'
WHERE setup_mode IS NULL AND provisioning_mode = 'static_branded';
