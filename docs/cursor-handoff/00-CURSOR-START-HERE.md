# Velivoo: start here

Audit date: 2026-09-03. This is an executable-source audit, not a production certification. Repository root is the inner `email-marketing-platform-release1-complete` directory containing `package.json`. No Git metadata was available. No application feature logic, database schema/data, credentials, or AWS resources were changed by this audit.

## One-page orientation

Velivoo is a multi-workspace email marketing product for marketers, operations teams, and developers. Its direction is Klaviyo-style audience, content, and event-driven automation; it is not yet feature-equivalent. The current product has real profile/list/import storage, template and email editing, immutable versions, flow execution, SES integration, domain provisioning, durable feedback, suppression, click tracking, and operational dashboards. Billing, commerce integrations, SMS, a true campaign broadcast scheduler, and open-pixel tracking are not implemented.

The architecture is a TypeScript npm workspace: Next.js frontend; a Node HTTP gateway and four API modules; separate public callbacks; application/domain packages; Prisma/PostgreSQL; BullMQ/Redis; local object storage; SES, Route 53, and optional CloudFront adapters. The product UI says Velivoo; root package/older docs still say Omni Present. See [repository map](02-REPOSITORY-MAP.md).

Current local configuration is **proof runtime with real SES sending enabled**, delivery queue disabled, Route 53 and SES setup enabled, and platform tracking. Proof mode is not a no-AWS guarantee. Local-password and development-header identity are enabled; production OIDC configuration is absent. Real feedback gate records are incomplete. All 157 repository tests, root compilation, frontend typecheck, and frontend production build passed. Most tests use in-memory stores/fake providers. Production readiness is **PARTIAL**, with blocking code defects and unverified external infrastructure.

## Source-of-truth hierarchy

1. Current executable source code.
2. Database schema and migrations.
3. Tests.
4. Current project documentation.
5. [CURSOR_PROJECT_CONTEXT.md](../../CURSOR_PROJECT_CONTEXT.md).
6. These Cursor handoff documents.
7. Historical comments and legacy documentation.

When evidence disagrees, report the conflict and inspect the executing entrypoint. A passing gate row, old README, marketing screenshot, or phase name is not proof of a live working system.

## Ten decisions to retain

1. V2 From is `user@customer.com`; `send.customer.com` is delegated infrastructure.
2. SES Easy DKIM uses provider-returned SigningHostedZone, not a guessed suffix.
3. New V3 customer DNS is four vanity NS records for `send.customer.com` plus the `_amazonses.customer.com` ownership TXT record. Existing V2 rows keep four NS plus three root-domain DKIM CNAME records.
4. MAIL FROM is `bounce.send.customer.com`; customer DMARC remains at the root.
5. Workspace identity, consent, subscription projection, and list membership are different concepts.
6. Published email/flow/template versions are immutable; a draft edit must not mutate running work.
7. Intent, rendered artifact, provider submission, and delivery outcome are different records/states.
8. Readiness and suppression are enforced server-side, including a final send-time check.
9. Persist inbound feedback before acknowledging; SNS routes are on the separate public server.
10. V1 records retain their discriminator and compatibility path; do not bulk relabel them V2.

## Ten things not to break

1. Tenant authorization on every query, including search, export, and diagnostics.
2. Stable provisioning CallerReference, domain lease ownership, and unique domain claims.
3. Root-domain From validation against the selected domain and immutable route authority.
4. Protected complaint/unsubscribe/hard-bounce suppression and pre-submit cancellation.
5. Unknown SES submission must not be blindly retried.
6. Signature/topic checks and durable InboxMessage deduplication.
7. Shared Route 53 delegation sets, shared configuration infrastructure, and unrelated DNS records.
8. Published content, consent/audit history, and delivery evidence during domain disconnect.
9. Profiles-based Arial typography, full-width white content, and explicit-only sidebar opening.
10. Existing service/repository/provider boundaries; repair them rather than creating parallel systems.

## Current phase and immediate work

This is a hardening/integration phase, not a greenfield rebuild. First address cross-tenant read/admin authorization, concurrent submission, scheduled-action ownership, invalid BullMQ IDs, missing worker orchestration, and gateway route conflicts. Then prove one end-to-end V2 domain and controlled SES send/feedback cycle. See [issues](20-KNOWN-ISSUES-AND-TECH-DEBT.md) and [ordered plan](22-NEXT-DEVELOPMENT-PLAN.md).

Exact SNS callback: **POST /public/v1/provider/ses**, implemented in `apps/public-api/src/real-server.ts`. For the supplied tunnel use **https://enjoyable-iphone-zeppelin.ngrok-free.dev/public/v1/provider/ses** and route the tunnel to public API port 4001, not the 4000 gateway.

## Reading order and complete index

Read the master context, domain/send/feedback chapters, implementation status, known issues, and development plan first. Open remaining inventories as needed.

- [PRODUCT OVERVIEW](01-PRODUCT-OVERVIEW.md)
- [REPOSITORY MAP](02-REPOSITORY-MAP.md)
- [FRONTEND ARCHITECTURE](03-FRONTEND-ARCHITECTURE.md)
- [BACKEND ARCHITECTURE](04-BACKEND-ARCHITECTURE.md)
- [DATABASE MODEL](05-DATABASE-MODEL.md)
- [DOMAIN ONBOARDING V2](06-DOMAIN-ONBOARDING-V2.md)
- [DOMAIN ONBOARDING V3 — FIVE CUSTOMER RECORDS](23-DOMAIN-ONBOARDING-V3.md)
- [EMAIL SENDING PIPELINE](07-EMAIL-SENDING-PIPELINE.md)
- [FEEDBACK SNS SUPPRESSION](08-FEEDBACK-SNS-SUPPRESSION.md)
- [TRACKING](09-TRACKING.md)
- [AUDIENCE](10-AUDIENCE.md)
- [CONTENT AND TEMPLATES](11-CONTENT-AND-TEMPLATES.md)
- [FLOWS](12-FLOWS.md)
- [DELIVERABILITY AND SENDERS](13-DELIVERABILITY-AND-SENDERS.md)
- [SETTINGS AUTH AND TENANCY](14-SETTINGS-AUTH-AND-TENANCY.md)
- [ENVIRONMENT AND INFRASTRUCTURE](15-ENVIRONMENT-AND-INFRASTRUCTURE.md)
- [API INVENTORY](16-API-INVENTORY.md)
- [JOBS QUEUES WORKERS](17-JOBS-QUEUES-WORKERS.md)
- [IMPLEMENTATION STATUS](18-IMPLEMENTATION-STATUS.md)
- [LEGACY AND MIGRATIONS](19-LEGACY-AND-MIGRATIONS.md)
- [KNOWN ISSUES AND TECH DEBT](20-KNOWN-ISSUES-AND-TECH-DEBT.md)
- [TESTING AND VALIDATION](21-TESTING-AND-VALIDATION.md)
- [NEXT DEVELOPMENT PLAN](22-NEXT-DEVELOPMENT-PLAN.md)
- [FILE INDEX](23-FILE-INDEX.md)

