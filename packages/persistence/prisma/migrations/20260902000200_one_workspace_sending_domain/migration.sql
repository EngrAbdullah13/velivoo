-- Preserve historical sender-domain rows while designating one current domain
-- for each workspace. New setup is constrained by the partial unique index.
ALTER TABLE "sender_domain"
  ADD COLUMN IF NOT EXISTS "workspace_primary" BOOLEAN NOT NULL DEFAULT FALSE;

WITH selected AS (
  SELECT DISTINCT ON (workspace_id) id
  FROM "sender_domain"
  WHERE archived_at IS NULL
  ORDER BY workspace_id,
    CASE WHEN readiness_status = 'ready' THEN 0 WHEN status = 'verified' THEN 1 ELSE 2 END,
    updated_at DESC,
    created_at ASC,
    id ASC
)
UPDATE "sender_domain" domain
SET workspace_primary = EXISTS (SELECT 1 FROM selected WHERE selected.id = domain.id)
WHERE domain.archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "sender_domain_one_current_domain_per_workspace"
  ON "sender_domain" (workspace_id)
  WHERE workspace_primary AND archived_at IS NULL;
