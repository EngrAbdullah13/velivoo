# Product overview

## Purpose and audience

Velivoo joins customer data, reusable email content, automation, and sending operations in one workspace. Marketers manage profiles and messages; operations staff manage domains, sender identities, consent/suppression, and readiness; developers ingest versioned events with scoped credentials. Klaviyo-style breadth is the product direction supplied by the owner, not a claim of current parity.

The current application is an email-first operations platform. Do not infer commerce, billing, SMS, WhatsApp, revenue attribution, or contact-company support from historical reference screenshots or the public marketing page.

## Current product surface

| Module | Current implementation | Important limitation |
|---|---|---|
| Home | Database-backed metrics, recommendations, recent work and readiness | Provider health may explicitly be unknown; marketing landing statistics are illustrative |
| Audiences | Profiles, properties, consent, lists, imports/exports, segments and events | No native tags/phone/company schema; some detail routes are misrouted |
| Content | Templates, approval/version snapshots, media references, reusable blocks, structured email editor | “Create campaign” creates an EmailDefinition; no campaign broadcast model/scheduler |
| Automations | Versioned graphs, triggers, branch/wait/email/end nodes, run traces | Runtime job dispatch and ownership defects; future palette concepts are not executable nodes |
| Transactional menu | Deliverability overview/domains/holds/suppression | Label is not evidence of a separate transactional-email product |
| Analytics | Message/delivery/flow projections and CSV export | No implemented open-pixel collection or order/revenue source |
| Settings | Workspace details, members, sender identities, keys, audit, policy and dangerous actions | Production login UX and comprehensive tenant authorization are incomplete |
| Public endpoints | SES SNS, unsubscribe, signed clicks, API-key events | Separate process/deployment; workers required to finish feedback |

Evidence: `apps/web/src/components/app-shell.tsx`, `apps/api/src/platform-api.ts`, `apps/api/src/automation-api.ts`, `apps/api/src/delivery-api.ts`, and `packages/persistence/prisma/schema.prisma`.

## Product philosophy already represented in code

Consent is explicit evidence, not inferred from import/list membership. Message submission is not delivery. Immutable versions preserve the exact content and flow a customer entered. Provider outcomes and operational decisions are auditable. The tenant is a Workspace and resource access must be authorized at that boundary; existing violations are bugs, not alternative policy.

The backend has substantial real implementations alongside proof/test adapters. Preserve useful abstractions: pure domain policies, application services, repository ports, Prisma adapters, and provider ports. New UI should bind to the existing APIs after verifying gateway reachability.

## Future scope versus completion

A serious production release still needs reliable queue orchestration, concurrent-send guarantees, complete authorization, external AWS validation, deployment hardening, and operational recovery. A dedicated campaign audience-snapshot/scheduling product, real open tracking, scalable streaming imports, production account onboarding, billing and commerce integrations are later additions. Do not describe them as completed because a marketing page names them.

This audit uses COMPLETE only for narrowly bounded behavior with source/test evidence, not for an entire subsystem whose AWS operation or production recovery was not demonstrated.

