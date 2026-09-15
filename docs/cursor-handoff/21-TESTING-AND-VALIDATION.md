# Testing and validation

## Checks performed in this audit

| Check | Result | Evidence / limits |
|---|---|---|
| Installed dependencies | PASS | node_modules present; package manifests/lockfile inspected; no install run |
| npm test | PASS | Root tsc build plus Node test runner:157 passed,0 failed,19 test files |
| Root TypeScript build | PASS | Runs as npm test prerequisite |
| npm run web:typecheck | PASS | Next workspace TypeScript check |
| npm run web:build | PASS | Next16.3.1 production compile, typecheck and all44 authored routes generated; repeated final check passed |
| Lint | NOT RUN | No lint script configured in root/web package |
| Standalone root --noEmit command | NOT RUN | Build compiles same project; not reported as separately executed |
| Local migration metadata/indexes | PASS | Read-only query:23 applied, latest20260903000100_scheduled_action_dedupe_constraint; no failed/rolled-back rows |
| Git status/log/diff/branches/tags | NOT RUN | No Git metadata available; repository detection failed |
| Browser interaction/E2E | NOT RUN | No browser regression suite found; screenshots from prior user reports are not fresh tests |
| Live AWS/SNS/DNS/CloudFront acceptance | NOT RUN | No external resource create/delete/send/subscribe action during audit |
| Real Redis queue/concurrency integration | NOT RUN | Static dependency validation identified ID defects; no isolated Redis test suite executed |
| Production load/restore/HA/security penetration | NOT RUN | No infrastructure authorization/environment for these checks |

Builds update generated dist/.next/typecheck cache outputs, not application feature source. Audit support script tmp/cursor-audit-inventory.mjs only reads source/metadata; runtime mode performs read-only DB queries and redacts credential values.

## Test inventory

All files below use the Node test runner. Classification by inspected dependencies: pure-domain unit tests, in-memory service/workflow tests and SDK/provider mocks. A test filename saying workflow, recovery or integration is not proof it uses real PostgreSQL, Redis or AWS.

| File | Test cases | Focus / evidence |
|---|---:|---|
| [tests/advanced-content.test.ts](../../tests/advanced-content.test.ts) | 2 | "advanced content assets, template approvals, and usage stay tenant-scoped"; "system starter templates clone into tenant-owned editable templates and campaigns pin approved snapshots" |
| [tests/audience-workflows.test.ts](../../tests/audience-workflows.test.ts) | 16 | "invitation is tokenized, email-bound, expiring, and accepted once"; "last owner cannot be demoted"; "workspace updates use optimistic concurrency"; see full cases below |
| [tests/audiences.test.ts](../../tests/audiences.test.ts) | 14 | "role permissions keep export and suppression privileged"; "cross-workspace profile reads fail closed"; "email normalization preserves local part while normalizing domain"; see full cases below |
| [tests/automation-operations.test.ts](../../tests/automation-operations.test.ts) | 2 | 'Phase3 materialized segment refresh records deterministic entered/left transitions'; 'Phase3 API keys are scoped, expire/revoke, expose secret only on issue, and touch last-used' |
| [tests/automation-permissions.test.ts](../../tests/automation-permissions.test.ts) | 1 | 'Phase3 uses discrete flow activation and API-key permissions' |
| [tests/automation-workflows.test.ts](../../tests/automation-workflows.test.ts) | 15 | 'Phase3 exact-once flow entry deduplicates the same event'; 'Phase3 testing activation accepts entries but can create only test messages'; 'Phase3 leased due action is recoverable after worker/Redis-style loss'; see full cases below |
| [tests/automation.test.ts](../../tests/automation.test.ts) | 12 | 'Phase3 segment compiler parameterizes hostile user values'; 'Phase3 segment complexity guardrails reject dangerous lookback/depth'; 'generic event schema validates required typed properties and future time'; see full cases below |
| [tests/branded-domain-provisioning.test.ts](../../tests/branded-domain-provisioning.test.ts) | 15 | "V2 derives infrastructure separately and keeps the visible sender on the root"; "root-domain normalization is PSL-aware, IDN-safe, and rejects unsafe inputs"; "DNS helpers canonicalize sets and preserve SOA timing fields"; see full cases below |
| [tests/content.test.ts](../../tests/content.test.ts) | 10 | "structured documents always retain one locked compliance footer"; "preflight blocks profile variables without a fallback"; "preflight blocks unsafe image URLs"; see full cases below |
| [tests/deliverability.test.ts](../../tests/deliverability.test.ts) | 2 | "deliverability health is transparent and fails closed for missing domain, feedback, and holds"; "deliverability metrics always disclose numerator and denominator" |
| [tests/delivery-workflows.test.ts](../../tests/delivery-workflows.test.ts) | 20 | "Phase 2 content persists immutable published versions and restores only draft"; "saved templates and starting points clone into independent mutable drafts"; "template library CRUD is tenant-scoped, audited, and preserves independent copies"; see full cases below |
| [tests/domain-removal.test.ts](../../tests/domain-removal.test.ts) | 1 | "confirmed branded-domain removal cleans platform identities after AWS cleanup" |
| [tests/foundation.test.ts](../../tests/foundation.test.ts) | 17 | "tenant scoped repositories fail closed"; "durable wait survives queue loss/restart and duplicate job submits once"; "unsubscribe during wait blocks final provider submission"; see full cases below |
| [tests/governance-workflows.test.ts](../../tests/governance-workflows.test.ts) | 8 | 'Phase4 hardening gate requires every source-defined hardening family'; 'Phase4 backup restore must meet the initial RPO/RTO objective'; 'Phase4 hardening waiver requires owner and review date'; see full cases below |
| [tests/governance.test.ts](../../tests/governance.test.ts) | 8 | 'Phase4 pilot entry stays locked until prior external gates and hardening evidence pass'; 'Phase4 S0/S1 open security findings block pilot'; 'Phase4 passed launch evidence requires named approver'; see full cases below |
| [tests/home-dashboard.test.ts](../../tests/home-dashboard.test.ts) | 2 | "home period accepts only supported bounded ranges"; "home recommendations prioritize safety blockers and remain deterministic" |
| [tests/object-storage.test.ts](../../tests/object-storage.test.ts) | 1 | "local object store prevents path traversal" |
| [tests/ses-domain-provisioning.test.ts](../../tests/ses-domain-provisioning.test.ts) | 8 | "SES configuration prefers AWS_SES_REGION and preserves IAM role credential mode"; "boolean parsing never treats the string false as enabled"; "domain validation accepts a domain but rejects sender email and URL input"; see full cases below |
| [tests/settings-module.test.ts](../../tests/settings-module.test.ts) | 3 | "Settings permission bundles keep destructive and credential controls server-restricted"; "Settings send-policy validation and quiet-hour fallback semantics are deterministic"; "Settings API credential material is verifiable without persisting plaintext" |

### All named cases

#### tests/advanced-content.test.ts

- advanced content assets, template approvals, and usage stay tenant-scoped
- system starter templates clone into tenant-owned editable templates and campaigns pin approved snapshots

#### tests/audience-workflows.test.ts

- invitation is tokenized, email-bound, expiring, and accepted once
- last owner cannot be demoted
- workspace updates use optimistic concurrency
- profile pagination cursor is bounded and stable
- profile timeline includes consent and suppression evidence
- list remove preserves provenance and archive prevents new membership
- subscription projection follows latest consent record
- protected suppression cannot be manually revoked
- temporary manual suppression can expire
- staged import requires mapping and consent evidence
- staged import validates, commits, records results, and is idempotent
- import rollback never removes consent added by import
- export supports selected scope and arbitrary approved fields
- domain normalization rejects malformed values
- readiness exposes individual blockers rather than one opaque flag
- audit log is permission-gated and records high-risk operations

#### tests/audiences.test.ts

- role permissions keep export and suppression privileged
- cross-workspace profile reads fail closed
- email normalization preserves local part while normalizing domain
- typed custom properties reject type conflicts
- list membership never creates consent
- granted consent permits eligibility until a protected suppression exists
- CSV preview rejects duplicate headings and flags duplicate rows
- re-import with identical mutation policy is idempotent
- profile merge preserves consent suppression and list provenance
- export is workspace scoped, formula-safe, permission protected and expires
- sender identity requires a verified matching domain
- a workspace keeps one current sending domain
- CSV validation honors the selected Email Address mapping
- readiness requires operational evidence beyond sender foundation

#### tests/automation-operations.test.ts

- Phase3 materialized segment refresh records deterministic entered/left transitions
- Phase3 API keys are scoped, expire/revoke, expose secret only on issue, and touch last-used

#### tests/automation-permissions.test.ts

- Phase3 uses discrete flow activation and API-key permissions

#### tests/automation-workflows.test.ts

- Phase3 exact-once flow entry deduplicates the same event
- Phase3 testing activation accepts entries but can create only test messages
- Phase3 leased due action is recoverable after worker/Redis-style loss
- Phase3 run stays pinned to entry Flow and Email versions after active version changes
- Phase3 duplicate node execution creates no more than one business message
- Phase3 branches and exits are deterministic and explainable
- Phase3 exit rule exits active run before an action and records evidence
- Phase3 pause future actions holds exact actions and resume has explicit overdue policy
- Phase3 cancel pending runs reports exact counts and cancels pending flow messages
- Phase3 run trace alone explains entry, branch/message progression and completion
- Phase3 wait-until timezone calculation handles DST gaps deterministically
- Phase3 profile-date trigger resolves its calendar date at the recipient local time
- Phase3 dead-letter replay preserves business identity and retries failed node as a new execution attempt
- shared typed rule compiler covers version-pinned engagement, audience, events, counts and bounded groups
- conditional split evaluates the immutable Flow Version rule once, records evidence, and follows only the selected branch

#### tests/automation.test.ts

- Phase3 segment compiler parameterizes hostile user values
- Phase3 segment complexity guardrails reject dangerous lookback/depth
- generic event schema validates required typed properties and future time
- generic event ingestion is exactly-once by workspace/source/idempotency key
- segment publish is immutable-versioned and estimate exposes eligible count/freshness
- flow validator requires labeled conditional branches and rejects cycles
- flow simulation is pure, deterministic and branch-explainable
- Phase3 production activation is locked until external Phase2 gate passes
- production activation becomes possible only after Phase2 gate plus readiness
- workspace API key helper returns secret once and verifies only hashed material
- conditional split rejects a shared Yes/No target so each branch has an independent path
- starter Flow recipes may remain incomplete only while they are drafts

#### tests/branded-domain-provisioning.test.ts

- V2 derives infrastructure separately and keeps the visible sender on the root
- root-domain normalization is PSL-aware, IDN-safe, and rejects unsafe inputs
- DNS helpers canonicalize sets and preserve SOA timing fields
- readiness separates authentication from operational delivery
- business information and required DMARC are blocking readiness evidence
- missing branded capability fails only the invoked provisioning operation
- V3 rewrites Easy DKIM CNAME names into the delegated zone
- V3 lifecycle maps DNS, ownership, SES, DKIM, ready, and delete states
- new V3 onboarding shows four NS records plus the ownership TXT record
- an existing V2 domain keeps its seven-record Easy DKIM contract
- V3 readiness requires NS, ownership TXT, SES identity, and Easy DKIM success
- SES ownership TXT uses v1 verification attributes without disabling Easy DKIM
- V3 delete removes SES, tracking, and Route 53 resources then marks DELETED
- CloudFront SaaS tracking uses the real connection-group endpoint without inventing a challenge
- CloudFront persists an AWS-returned challenge rather than deriving one
- CloudFront disconnect disables and deletes only the domain tenant
- SES reuses one workspace configuration set and repairs its feedback destination
- SES Easy DKIM targets use the provider SigningHostedZone
- Route 53 enforces the reusable delegation mapping and writes vanity apex NS/SOA
- public DNS checks classify NXDOMAIN timeout and SERVFAIL and expose two diagnostics
- Route 53 teardown deletes the child zone without touching the shared delegation set

#### tests/content.test.ts

- structured documents always retain one locked compliance footer
- preflight blocks profile variables without a fallback
- preflight blocks unsafe image URLs
- structured compiler escapes author content
- structured compiler renders header, footer, and responsive-safe columns
- preview resolves safe variables and labels its sample source
- publishing creates immutable increasing versions
- restore creates a new mutable draft without mutating version history
- test sends are explicitly excluded from production analytics
- html/source mode remains blocked until owner decision enables it

#### tests/deliverability.test.ts

- deliverability health is transparent and fails closed for missing domain, feedback, and holds
- deliverability metrics always disclose numerator and denominator

#### tests/delivery-workflows.test.ts

- Phase 2 content persists immutable published versions and restores only draft
- saved templates and starting points clone into independent mutable drafts
- template library CRUD is tenant-scoped, audited, and preserves independent copies
- draft test snapshots use the same render pipeline and honor pinned tracking settings
- Content v2 never rewrites a published Flow v1; existing Runs use v1 and new Runs use explicitly published Flow v2
- controlled send re-evaluates policy, renders compliant MIME, and submits once under duplicate execution
- a historical sender domain cannot submit a new message
- unsubscribe or protected suppression immediately blocks a later production message
- workspace operational hold prevents new submissions and can be released
- frequency reservation prevents concurrent messages from exceeding cap
- unknown provider outcome reconciles without blind second submission
- duplicate and out-of-order provider feedback is idempotent and complaint wins
- hard bounce creates protected suppression and blocks the next marketing message
- final submission re-evaluates the canonical policy after rendering
- configured stale-feedback safety is a stable final policy hold
- test messages bypass marketing consent but remain excluded from production analytics
- analytics facts keep submitted separate, exclude tests, and count late feedback once
- tracking tokens are opaque, expiring and HTTPS destination validation rejects unsafe links
- MIME rejects header injection
- message trace connects policy, render and provider submission

#### tests/domain-removal.test.ts

- confirmed branded-domain removal cleans platform identities after AWS cleanup

#### tests/foundation.test.ts

- tenant scoped repositories fail closed
- durable wait survives queue loss/restart and duplicate job submits once
- unsubscribe during wait blocks final provider submission
- unknown provider outcome reconciles without blind resend
- duplicate feedback is idempotent and complaint/bounce can suppress
- unsubscribe token is signed and tamper resistant
- SNS signature canonicalization verifies signed envelope
- one-click unsubscribe is idempotent
- proof store transaction rolls back partial outbox state
- flow and rule guardrails reject unsafe definitions
- CSV proof is streamed row by row
- SNS topic allowlist rejects a validly signed event from the wrong topic
- SES feedback normalization retains internal correlation tags
- feedback retry re-applies a durably received but unprocessed inbox item
- out-of-order feedback cannot downgrade a complaint
- typed rule compiler parameterizes user values
- flow simulation is deterministic and side-effect free

#### tests/governance-workflows.test.ts

- Phase4 hardening gate requires every source-defined hardening family
- Phase4 backup restore must meet the initial RPO/RTO objective
- Phase4 hardening waiver requires owner and review date
- Phase4 migration rehearsal must reconcile source rows and source-of-truth ownership
- Phase4 pilot stage completion requires recorded stage-specific observation evidence
- Phase4 Stage 1 enforces at least 48 hours or enough feedback
- Phase4 release approval is impossible before completed pilot and eight-area launch review
- Phase4 final approval becomes blocked again if a severe finding is reopened before approval

#### tests/governance.test.ts

- Phase4 pilot entry stays locked until prior external gates and hardening evidence pass
- Phase4 S0/S1 open security findings block pilot
- Phase4 passed launch evidence requires named approver
- Phase4 active stop signal immediately holds a running pilot
- Phase4 capacity evidence records measured safe ceiling and rejects invented ceiling above observed
- Phase4 privacy deletion places hold before deletion and enforces sequential tombstone workflow
- Phase4 deletion cannot skip required states
- Phase4 recovery evidence captures explicit RPO/RTO instead of assuming recovery

#### tests/home-dashboard.test.ts

- home period accepts only supported bounded ranges
- home recommendations prioritize safety blockers and remain deterministic

#### tests/object-storage.test.ts

- local object store prevents path traversal

#### tests/ses-domain-provisioning.test.ts

- SES configuration prefers AWS_SES_REGION and preserves IAM role credential mode
- boolean parsing never treats the string false as enabled
- domain validation accepts a domain but rejects sender email and URL input
- SES provisioning creates an identity once and persists real DKIM evidence
- SES adapter separates access denial from missing provider configuration
- SES verification remains authoritative when a supplemental DNS lookup is stale
- SES adapter removes the provider identity using the domain's pinned region
- regional SES provisioning rejects a browser-selected region outside the platform allowlist

#### tests/settings-module.test.ts

- Settings permission bundles keep destructive and credential controls server-restricted
- Settings send-policy validation and quiet-hour fallback semantics are deterministic
- Settings API credential material is verifiable without persisting plaintext


## Coverage assessment

Good bounded coverage: domain normalization/derivation, mocked NS/SOA/DKIM reconciliation, content schema/compiler/preflight, immutable version behavior, consent/list rules, graph validation/branch/timing/exit policy, role permissions in services, in-memory imports/rollback, and local object-store safeguards.

Partial: domain cleanup/recreation/transfer failure recovery, unsubscribe versus subscription projection, feedback ordering, provider errors, dashboard calculations and governance evidence logic.

Missing: actual gateway tenant isolation, route ordering/method contracts, SQL partial-index/native-upsert behavior for all models, two-worker send races, SQL action ownership, installed BullMQ/Redis dispatch, matched/unmatched SNS recovery, real TLS/cert failures, browser sidebar/editor behavior and production login. Root tsconfig exclusions require separate standalone runtime coverage; transitive imports mean not every excluded source is necessarily uncompiled.

## Safe next validation sequence

First fix P0/P1 code defects. Use isolated PostgreSQL/Redis test databases/queues, seeded synthetic profiles and fake providers for concurrency/failure injection. Verify no test can contact real SES accidentally: proof mode alone is not protection; set real-send/setup flags off and isolate credentials.

Only with explicit approval for a controlled test domain/mailbox: verify IAM/region/sandbox read-only; publish the exact DNS instructions; confirm signed SNS subscription; perform one allowed SES send; exercise controlled delivery/bounce/complaint/reject/delay fixtures or simulator where appropriate; prove persisted-before-ack and worker suppression; test unsubscribe/clicks through actual public HTTPS. Do not manually create passed gate rows.

Before release, demonstrate duplicate/late feedback, Redis outage, worker crash, unknown submission, lease expiry, domain cleanup retry, unrelated DNS preservation, cross-tenant denial, secret redaction, backup restore and rollback. Record actual evidence, dates, inputs and environment, without secrets.

