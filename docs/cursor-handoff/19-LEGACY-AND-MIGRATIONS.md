# Legacy architecture and migrations

## Canonical boundary

V2_ROOT_SENDER_DELEGATED_INFRA means SES identity/root visible From customer.com, delegated send.customer.com, MAIL FROM bounce.send.customer.com and tracking click.send.customer.com. V1_LEGACY_SEND_SUBDOMAIN can mean visible user@send.customer.com and a delegated-domain SES identity. provisioningMode is a separate field. The Prisma default remains V1 for compatibility; the new domain service explicitly creates V2.

## Legacy inventory

| File / area | Behavior | Reachable? / data dependency | Risk | Recommended treatment |
|---|---|---|---|---|
| packages/provider-email/src/ses/ses-domain-provider.ts | Legacy regional sender-domain provider and expected-record handling | Retained Phase1 compatibility selection | Old identities/region assumptions and DKIM target logic may differ | Keep for V1; use ses-email-domain-provider for new V2 |
| packages/application/src/phase1/phase1-service.ts | Version-aware create/verify/identity compatibility | Current platform service; existing V1 records may depend on it | Removing fallback can strand domains/senders | Preserve discriminator; explicit migration only |
| packages/application/src/phase2/email-routing-service.ts | Root V2 versus delegated legacy From/identity route selection | Current send path | Relabeling records can invalidate historic send authority | Keep pinned route/sender snapshots |
| packages/domain/src/phase1/branded-domain.ts | V1/V2 constants and V2 derivation | Current | Prefix env is not a schema migration | New records use root identity |
| packages/persistence/prisma/schema.prisma and domain migrations | V1 default, version/backfill and archive-sensitive claims | Existing DB | Blind schema push can remove partial indexes/constraints | Review SQL and data migration plan |
| apps/api/src/server.ts; apps/public-api/src/server.ts | File-backed phase0 proof HTTP and simulated feedback | Separate explicit entrypoints, not canonical gateway | Unsafe reset/proof behavior if exposed | Local proof only; never route production callbacks here |
| apps/api/src/real-server.ts; apps/worker/src/real-executor.ts | Older real-service flow proof/executor | Explicit legacy runtime | Uses legacy global sender/region fallbacks | Keep until consumers/data audited; not new automation engine |
| apps/worker/src/real-main.ts; apps/scheduler/src/real-main.ts | Mixed legacy execution and real durable feedback | Feedback path still current | Deleting “phase0” wholesale would remove feedback processing | Split only through a tested migration; document launch coverage now |
| packages/domain/src/flow-validator.ts, flow-simulator.ts, entities.ts | Earlier proof flow vocabulary | Proof service/tests | Newer Phase3 graph differs | Do not reuse for new graph features |
| packages/persistence/src/proof; packages/application/src/phase1/in-memory-platform.ts | In-memory/file proof repositories | Test suites/proof | Tests do not exercise Prisma SQL constraints/locks | Retain test doubles, add real integration coverage |
| packages/queue/src/proof/file-queue.ts | File dispatch | Proof | Not distributed/durable enough for production | Keep isolated |
| apps/web/src/lib/phase4-api.ts | Separate dev-header-only client/env aliases | Legacy governance component | Auth differs from shared client | Consolidate when governance is reconnected securely |
| apps/web/src/components/governance/launch-readiness.tsx | Old launch evidence UI | Current settings/launch points elsewhere | Dead UI may mislead completion claims | Inventory before removal or reactivation |
| root package.json / README and old phase docs | Omni Present name and phase completion wording | Developer-facing | Historical statements overstate present readiness | Treat code/tests/current evidence as authoritative |
| SES_FROM_EMAIL / SES_CONFIGURATION_SET and phase0 env | Global proof sender/config fallback | Legacy real proof paths | Bypasses intended workspace mapping if reused | No new production dependencies |
| standard_staging_fallback tracking mode | Compatibility configuration | Parsed; mode-dependent adapter behavior | Not verified branded TLS | Explicit migration/deprecation plan |

No current BYODKIM implementation was found. Amazon-managed Easy DKIM CNAME targets are expected; V2 uses SES SigningHostedZone. Do not “white-label” them by guessing a different DKIM hostname.

## Migration history available

Git history was unavailable: no .git metadata, so branches/tags/diffs cannot be reconstructed from this checkout. SQL migrations are the reliable historical record. Twenty-three were applied in the inspected local DB; latest is 20260903000100_scheduled_action_dedupe_constraint. Full filenames are in chapter23.

Recent domain migrations add delegated infrastructure, V2 root identity/version fields, archive-safe domain claims and provisioning recovery. The scheduled-action migration fixes a Prisma upsert/partial-index mismatch without deleting records. Outbox still has a partial dedupe index versus Prisma @unique. Do not mark all schema/native-upsert compatibility fixed based on the ScheduledAction repair.

## Safe V1 migration requirements

Inventory active V1 domains, identities, drafts, published versions, active routes, attempts, flow dependencies and customer DNS. Prepare root SES identity and three root DKIM records; verify real delegation/SES/MAIL FROM; establish new route/config/tracking readiness; update future drafts/identities deliberately; leave published/running historical snapshots intact. Define rollback, unknown-submission handling and controlled cutover. Do not silently change a live customer's visible From suffix.

Archived same-root recreation can retain stale provider refs/DNS evidence and deserves tests. Disconnect removes owned external resources while retaining audit/history. Shared delegation set/configuration infrastructure must survive customer deletion.

