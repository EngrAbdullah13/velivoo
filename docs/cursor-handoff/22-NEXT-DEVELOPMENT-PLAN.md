# Ordered continuation plan

Do not rebuild the platform. Preserve versioned content, tenant boundaries, suppression, root-sender V2 and durable inbox/outbox. Each task requires tests against the real executing entrypoint, not only a mock service.

## NOW — next ten tasks in priority order

1. **Close tenant authorization gaps.** Guard home search, export metadata and every direct Prisma route; separate platform-admin governance/infrastructure operations. Acceptance: Workspace B user gets403/404 for A resources across gateway APIs.
2. **Make SES submission exclusive.** Add an atomic claim/lease/fencing transition and unknown-outcome recovery around existing DeliveryAttempt. Acceptance: simultaneous workers and crash-after-accept tests do not blindly duplicate sends.
3. **Partition scheduled work ownership.** Restrict Phase3 claim/recovery to its action types; enforce lease ownership. Acceptance: domain and flow workers run together without consuming each other's actions.
4. **Repair invalid BullMQ IDs.** Use stable safe encoding/hash for feedback, legacy scheduled and audience-transition jobs. Acceptance: actual installed BullMQ + isolated Redis enqueue/dedupe/retry tests pass.
5. **Define complete process orchestration.** Explicitly supervise public API, feedback consumer/retry scheduler, imports, domain verification, delivery and automation/outbox processes. Acceptance: health and backlog show missing workers clearly.
6. **Fix gateway/ordered-route contracts.** Profile message/run panels, send-policy methods, duplicate keys and segment rule registry. Acceptance: HTTP tests on4000—not direct child ports—exercise each route.
7. **Harden durable feedback recovery.** Re-correlate early unmatched events safely; serialize terminal projections; test duplicate transaction errors and unsubscribe projection. Acceptance: Redis outage and out-of-order events recover correctly.
8. **Harden domain lifecycle boundaries.** Strict tracking-mode configuration, ownership-safe zone adoption, delete/recreate retries and pinned-region transfer. Acceptance: failure injection preserves recoverability without modifying unrelated DNS/shared resources.
9. **Secure production configuration/auth/errors.** Remove unsafe production fallbacks, integrate OIDC browser login, sanitize raw errors, define secret rotation/object-store access. Acceptance: missing secrets fail closed and no customer sees credential/provider internals.
10. **Run one controlled end-to-end AWS acceptance.** After code blockers are fixed, use an approved test domain/mailbox to prove V2 DNS, SES/MAIL FROM, signed SNS subscription, delivery/bounce/complaint/reject/delay, suppression, unsubscribe and clicks. Acceptance evidence must come from real observations; no fabricated gate rows.

## NEXT

Complete a production-oriented campaign audience snapshot/scheduling layer using canonical Message intent/outbox, not direct SES. Add streaming CSV import with multiline support and size/backpressure limits. Add frontend regression tests for compact sidebar navigation, typography, domain form feedback and canvas/inspector containment. Clean duplicate API helpers only after contract coverage exists.

## BEFORE PRODUCTION

Obtain/verify SES production access and quotas, least-privilege IAM, vanity/reusable delegation configuration, SNS topic policy and HTTPS subscription, stable public origin, Postgres backups/restore, Redis durability, supervised workers and durable shared artifacts. Configure optional CloudFront base resources separately and prove tenant TLS redirects. Test tenant isolation, concurrency, rate limits, privacy/retention, recovery/replay, secret rotation and deployment rollback.

Replace global/stale readiness evidence with scoped/fresh observations as appropriate. A build pass, healthy badge, or stored passed flag is not an acceptance test.

## LATER

Design open tracking deliberately with privacy/retention semantics; add commerce/revenue attribution, billing, richer campaign reporting and additional channels only after email foundations are stable. Future flow nodes require schema, validator, editor, executor, trace, compatibility and tests together.

## Working protocol for Cursor

Read CURSOR_PROJECT_CONTEXT.md first, then the relevant handoff chapter and source. Follow code → schema/migrations → tests → current docs precedence. Inspect existing .env key names without sharing values. Never run AWS create/delete or migrations merely to understand a feature. Treat unresolved external choices as explicit configuration work. Keep code fixes in focused changes with reproducible evidence.

