# Jobs, queues and workers

## Durable authority

PostgreSQL ScheduledAction, InboxMessage and OutboxEvent are durable work authority. Redis/BullMQ is dispatch, not the only record of required work. Stable queue IDs collapse duplicate dispatch only within queue retention; business idempotency still belongs in the database/service.

| Queue / mechanism | Payload / job types | Consumer / producer | Concurrency and retry |
|---|---|---|---|
| phase0.dispatch | JobEnvelope: jobType/version, workspaceId, resourceId/type, correlationId, attempt; feedback.apply and scheduled.execute | public real-server / real scheduler → worker real-main | Default2; feedback3 attempts exponential500ms; scheduled1; retain1000 completed/failed |
| phase1.background | phase1.import.commit {workspaceId,importId,actorId}; phase1.export.generate {workspaceId,exportId,actorId} | platform-api → real-phase1-main | Default2;5 attempts exponential1000ms; retain100 completed/500failed |
| phase2.messages | phase2.message.policy/render/submit/reconcile {workspaceId,messageId} | delivery-api/outbox → real-phase2-main | Default4; enqueue helper non-submit5/submit1; worker-chain reconcile10 after30s with5000ms exponential backoff; successful unknown return is not retried |
| phase3.automation | flow.execute actionId; segment.refresh segmentId; event.route eventId; date.route scheduleId; audience.transition transitionId/audienceType; all workspace-scoped | automation-api / real-phase3 scheduler → real-phase3-main | Default4;5 attempts exponential1000ms; retain1000 |
| Domain verification SQL polling | sender_domain.verify ScheduledAction with domain/workspace IDs | Domain service → branded-domain-verification-worker | Due claim SKIP LOCKED; batch100; poll5000ms; lease120000ms; serial loop |
| Local proof automation SQL polling | Selected list.joined and test-only phase2.message.policy outbox; flow actions | local-proof-automation.ts | Local development path; not full production worker replacement |
| Proof FileQueue | JSON/NDJSON envelopes | phase0 main/scheduler/server | File-based local proof only |

Sources: packages/queue/src/bullmq/*.ts; apps/worker/src; apps/scheduler/src. Queue flags alone do not launch consumers.

## Actual launch coverage

dev:all starts private gateway, public server, Next web and domain verification worker. It starts Phase2 worker only when deliveryQueueEnabled. Outside production with queues disabled it starts local-proof-automation. It does **not** launch real-main feedback consumer, real-main feedback scheduler, real-phase1 import/export worker, or real-phase3 worker/scheduler.

Documented existing process entrypoints (start only with approved environment/data):

- npm run dev:api — private gateway and four child modules.
- npm run dev:web — frontend.
- npm run dev:domain-worker — SQL domain verification.
- npm run dev:worker — Phase2 message queue consumer.
- node --env-file=.env --import tsx apps/public-api/src/real-server.ts — public callbacks.
- node --env-file=.env --import tsx apps/worker/src/real-main.ts — mixed legacy execution/feedback queue consumer.
- node --env-file=.env --import tsx apps/scheduler/src/real-main.ts — durable feedback retry and legacy schedule handling.
- node --env-file=.env --import tsx apps/worker/src/real-phase1-main.ts — import/export consumer.
- node --env-file=.env --import tsx apps/worker/src/real-phase3-main.ts and apps/scheduler/src/real-phase3-main.ts — full automation pair.

Do not run duplicate competing workers casually: current action claims are not properly partitioned. Production needs a supervised explicit process manifest and queue backlog/failure alerts.

## Confirmed dispatch defects

Installed BullMQ6.1.2 job validation permits colon-containing custom IDs only when exactly three segments exist. Phase0 feedback uses two, Phase0 scheduled runtime uses four, and Phase3 audience-transition uses four: those IDs fail validation. Phase1/Phase2 and other Phase3 three-segment IDs do not share this exact defect. BullMqDispatchQueue's legacy three-segment adapter is also distinct from phase0-runtime's invalid scheduled ID.

PrismaPhase3Repository.claimDueActions and broad expired-lease recovery do not restrict actionType. They can claim/release sender_domain.verify work. Domain worker itself filters its action type. Local proof runtime uses the same Phase3 repository and can exhibit the collision.

## Recovery and idempotency

Feedback endpoint persists matched supported inbox data before enqueue and defers on Redis error; scheduler can retry received matched inbox rows. Unmatched feedback is stranded without a re-correlation sweep. Phase3 creates messages/outbox transactionally and supports dead-letter/replay; this does not protect concurrent SES submission automatically.

ScheduledAction leases need ownership checks on completion, correct expiry and work-type partition. Requeued domain work must not be overwritten completed. Unique dedupe keys protect row creation, not provider exactly-once side effects. Add isolated real PostgreSQL/Redis tests for these interleavings before scaling concurrency.

Current deliveryQueueEnabled=false allows inline nonproduction test-send dispatch, but generic POST /messages only stores intents with no equivalent fallback. Production test-send refuses missing durable queue. This mismatch must be explicit to operators.
