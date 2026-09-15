# SNS feedback, unsubscribe and suppression

## Exact endpoint and deployment

**POST /public/v1/provider/ses** is handled in `apps/public-api/src/real-server.ts`.

For the supplied ngrok host, enter:

`https://enjoyable-iphone-zeppelin.ngrok-free.dev/public/v1/provider/ses`

The default upstream is the **public API on port 4001**. The private gateway on 4000 does not mount this path. EMAIL_PLATFORM_PUBLIC_BASE_URL is used to construct advertised URLs; it does not register an SNS subscription, create TLS, or configure a tunnel. Set it to the HTTPS origin without an extra path prefix and expose the public process. The exact path is supported by source inspection; this audit did not POST to AWS or verify the live tunnel.

## Receive/verify/persist sequence

SES configuration set → configured SNS event destination/topic → signed SNS HTTPS envelope → public route → InboxMessage → feedback.apply queue → transactional event/state/suppression projection.

The endpoint requires EMAIL_PLATFORM_SNS_TOPIC_ARN. Without it, it refuses with 503. `packages/provider-email/src/ses/sns-verifier.ts` verifies configured TopicArn equality, allowed HTTPS SNS certificate host/path, and RSA signature over SNS canonical fields. Certificate redirects are refused. Signature versions 1/2 use SHA-1/SHA-256 respectively; unknown versions currently fall through to SHA-1 rather than being explicitly rejected. Certificate payload size is capped after read; there is no explicit fetch timeout or timestamp-age rejection.

Do not replace this with unsigned JSON processing or trust x-amz-sns headers alone. A provider message tag is not tenant authorization.

| SNS envelope | Implementation |
|---|---|
| SubscriptionConfirmation | Signature checked, raw control envelope persisted as source sns-control, allowed SubscribeURL confirmed, inbox processed, signature/subscription gate evidence recorded |
| Notification | Signature checked, SES payload normalized, durable source ses InboxMessage saved before supported event acknowledgment |
| UnsubscribeConfirmation | Signature verified but currently returns successful empty outcomes; not persisted/reconciled as a subscription state change |

Only recognized normalized events are persisted in the SES event inbox. Do not claim every arbitrary Notification is durably retained: unsupported event types are ignored. The raw complete Notification envelope is not stored in the same way as subscription control; the persisted payload is normalized, with a normalized payload hash.

## Supported SES events

`packages/provider-email/src/ses/normalize-feedback.ts` normalizes delivery, bounce, complaint, reject and delay/DeliveryDelay. SES SEND and RENDERING_FAILURE destinations may be configured but are not normalized into this pipeline. SES open/click events are not the implemented tracking source.

A supported event is deduplicated by InboxMessage (source,externalId), using the SNS MessageId. It starts with no workspace. Correlation is based on a stored DeliveryAttempt provider=ses/providerMessageId, then its Message workspace and optional pinned route authority. A forged or mismatched tag cannot pick a workspace.

Unmatched events remain unmatched; authority mismatches are rejected; already processed events return duplicate. Matched received events enqueue feedback.apply. Redis failure returns a deferred accepted result while the database inbox remains recoverable. Persist-before-ack therefore protects matched supported events against queue outages.

However, early feedback arriving before provider-ID persistence becomes unmatched and is not automatically re-correlated. The scheduler retries only received rows with a workspace; it does not sweep unmatched/rejected records. Tag-based recovery elsewhere cannot repair an event that never reaches that worker.

## Worker transaction and state projection

`apps/worker/src/real-feedback.ts` writes a unique DeliveryEvent and applies message status, suppression, cancellation, processed inbox and trace in one Prisma transaction. Complaints protect terminal status against later delivery. Hard/permanent bounce creates a protected delivery-scope suppression; complaint creates protected global-scope suppression; soft bounce does not create the hard-bounce suppression. Reject and delay are persisted outcomes, not instructions to blindly resend.

“Global” suppression means all relevant marketing sending within that workspace/profile, not a global cross-customer blacklist. Tenant keys remain required.

Read-before-transaction projection and no explicit message lock deserve concurrent out-of-order tests. Catching P2002 inside a PostgreSQL transaction and then issuing further statements can also interact badly with an aborted transaction. The separately tested Phase2Service.applyFeedback is not the public worker path; do not use one path's tests as proof of the other's semantics.

## Current dispatch blocker

The feedback queue's custom job ID is feedback.apply:<inboxId>, two colon-separated segments. Installed BullMQ 6.1.2 rejects colon-containing custom IDs unless they have exactly three segments. This makes actual enqueue fail/defer. The same queue adapter also creates a four-segment scheduled-action ID. This is a code blocker, not evidence of disabled AWS keys.

`apps/scheduler/src/real-main.ts` retries received inbox jobs; `apps/worker/src/real-main.ts` consumes feedback. Neither is launched by the default dev:all orchestration. Both job-ID validation and process coverage must be fixed/verified before feedback is considered operational.

## Unsubscribe

GET /public/v1/unsubscribe?token=:token displays a form; POST performs the change. `real-unsubscribe-handler.ts` validates the HMAC payload (workspace/profile/marketing/version), deduplicates by token hash, appends consent withdrawal, inserts protected global_unsubscribe suppression, cancels presubmit messages, and persists inbox/trace transactionally. GET alone must not withdraw consent, because scanners follow links.

The transaction does not update SubscriptionState projection, so UI subscription summaries may lag the protected suppression. Final sending eligibility still checks protected suppression. Fix the projection without weakening the durable source of consent/suppression.

## Evidence and external prerequisites

SNS topic is present in current local env, but signature/subscription evidence rows are absent in the inspected DB. real.feedback.endpoint is passed; tracking/unsubscribe endpoint gates are blocked. Those stored values are not independent live verification.

Before production: validate real signed subscription, delivery, bounce, complaint, reject and delay fixtures; duplicate delivery; Redis outage/replay; unmatched reconciliation; timestamp/certificate error cases; and concurrent terminal-state ordering. Do not fabricate evidence rows to make the dashboard green.
