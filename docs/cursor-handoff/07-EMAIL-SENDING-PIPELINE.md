# Email sending pipeline

## Entry and sequence

Primary files: `apps/api/src/delivery-api.ts`, `packages/application/src/phase2/phase2-service.ts`, `packages/domain/src/phase2/message-policy.ts`, `packages/persistence/src/prisma/phase2-repository.ts`, `packages/application/src/phase2/email-routing-service.ts`, `packages/provider-email/src/ses/ses-provider.ts`, `apps/worker/src/real-phase2-main.ts`.

UI/email editor → API draft/preflight/publish or test snapshot → Message intent → policy → immutable rendering/artifact → final policy/route/capacity check → DeliveryAttempt → SES SendEmail → provider ID → SNS inbox → DeliveryEvent/suppression/analytics.

Flow email nodes use PrismaPhase2FlowMessagePort to create the same Message and phase2.message.policy OutboxEvent transactionally. They do not implement a second direct SES sender.

## Content, intent and routing

EmailDefinition is a mutable draft with optimistic rowVersion and preflight fingerprint. Published EmailVersion preserves immutable content, compiler/sanitizer information and sender snapshot. EmailTestSnapshot isolates an unpublished test. FlowVersion dependencies pin EmailVersion IDs.

createMessageIntent hashes workspace, source type/ID, profile, version and sequence into an idempotency key. The database unique (workspaceId,idempotencyKey) prevents duplicate intent rows. This is not an SES exactly-once key.

EmailRoutingService resolves the workspace's current domain and route, checks identity/domain correspondence and readiness, and uses the ROOT sender address for V2. Legacy verified sender-domain compatibility remains. Route authority includes provider region, identity/configuration set and domain/route references. Test sending is explicitly distinguished from production.

## Eligibility and compliance

The policy evaluates cancellation/exit, holds, invalid profile, suppression, consent, sender readiness, provider readiness, feedback freshness, frequency, quiet hours and warming. Test messages bypass marketing consent/frequency/quiet/warming/freshness restrictions but retain hard safety gates such as suppression, sender/provider readiness and holds. A test is not permission to contact a suppressed recipient.

Rendered HTML/text includes compliance information and signed unsubscribe links/one-click headers. Structured content is sanitized/compiled; variables resolve from profile and workspace inputs. A RenderedMessageArtifact and local .eml object retain hashes, byte size and tracking metadata. TrackingLink stores the actual destination; signed click URLs reference it. The final policy is checked again immediately before provider submission.

Capacity uses PostgreSQL transactions and buckets for provider-region, workspace, domain and route limits, with quota headroom. Frequency reservation and capacity behavior need real concurrent tests; count-then-reserve and serialization failure handling are not a complete exactly-once guarantee.

## Modes and dispatch

| Configuration | Actual behavior |
|---|---|
| EMAIL_PLATFORM_EMAIL_SEND_ENABLED=false | Disabled provider path; no real-send assumption |
| EMAIL_PROVIDER=ses and send enabled | Real SES can run even when runtime mode is proof |
| Delivery queue enabled + Redis | Queue policy/render/submit/reconcile jobs; worker required |
| Queue disabled, nonproduction test-send | In-process fire-and-forget proof dispatch through policy/render/submit |
| Queue disabled, production test-send | Refuses with queue-required error |
| POST /messages without a jobs adapter | Persists an intent but does not dispatch a fallback pipeline |
| Flow execution | Creates message/outbox; an outbox dispatcher and Phase2 worker/local proof handler must consume it |

`dev:all` conditionally starts the Phase2 worker, but does not start all feedback and automation processes. A successful HTTP intent response is not proof a worker consumed it.

## SES submission and retries

The SES adapter sends raw MIME using SendEmail, not SendBulkEmail. It attaches platformMessageId/fingerprint/workspace/domain/route tags and applies the resolved configuration set. Provider MessageId is persisted on DeliveryAttempt; Message becomes submitted, not delivered. A timeout or uncertain provider result becomes unknown and must not trigger an unqualified retry. lookupSubmission currently always returns unknown; reconciliation cannot query an authoritative SES per-message status.

The Phase2 enqueue helper gives submit one attempt and other jobs five with exponential1000ms backoff. The worker chains render with five attempts (without an explicit backoff on that add), submit with one, and unknown-result reconcile after30seconds with ten attempts and exponential5000ms backoff. These attempts retry thrown failures: reconcileUnknown currently returns successfully when SES lookup remains unknown, so it does not automatically perform ten status polls. Retryable send errors are held rather than blindly resubmitted; a comprehensive automatic hold-release/resume policy is not established by the code. Suppression and cancellation are rechecked before sending.

## Critical concurrency limitation

Prisma createAttempt first reads the unique message/attempt row, returning it if already present. submit guards submitted/unknown but has no atomic exclusive claim of an existing created attempt before SES. Two concurrent submitters can both cross the provider boundary, and a crash after SES accepts but before provider ID persistence can leave an apparently unsent attempt. Sequential in-memory tests do not cover that interleaving.

Fix the transition/lease/fencing and unknown-outcome recovery in this pipeline. Do not add a duplicate sender service or claim the provider fingerprint supplies AWS idempotency. Frequency checks and delivery-event projection also need concurrency tests.

## Persistence and observability

Message is intent/state; DeliveryAttempt is provider interaction; RenderedMessageArtifact is immutable output; TrackingLink is a redirect reference; DeliveryEvent is provider outcome; TraceEvent explains transitions; InboxMessage is external durable receipt; OutboxEvent schedules local consequences. FlowRun/FlowNodeExecution connect automation intent to the same message evidence.

Published snapshots and provider facts survive domain removal. Never change a submitted message's historical sender/route because a workspace later changes domains. See [feedback](08-FEEDBACK-SNS-SUPPRESSION.md) for outcomes and [tests](21-TESTING-AND-VALIDATION.md) for evidence limits.
