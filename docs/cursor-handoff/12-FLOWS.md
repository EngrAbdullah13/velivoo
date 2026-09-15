# Flows and automation

## Graph and UI

`apps/web/src/components/automation/flow-builder.tsx` implements a custom React/SVG canvas with selection, node palette, inspector, connections and graph controls; it is not ReactFlow. The inspector occupies the left palette area after a node is selected. Preserve canvas dimensions/scroll containment and explicit sidebar behavior when changing it.

FlowManager lists flows, statuses, counts and operational summaries. RunInspector shows executions, branch decisions and messages. Existing page routes include /flows, /flows/:id/builder and /flows/:id/runs.

## Supported execution vocabulary

`packages/domain/src/phase3/flow.ts` is authoritative. Triggers: unconfigured, list_joined, segment_entered, profile_date, generic_event, manual_test. Executable node types: delay, wait_until, conditional, email, end. The trigger is a graph-level definition, not an arbitrary executable node.

Graphs are capped at 100 nodes, must be acyclic, have valid/reachable destinations and required end structure; conditional branches require distinct yes/no destinations. Entry modes include once, once_per_event and cooldown (bounded from 60 seconds to a year). Delays are bounded; profile-date schedules use typed fields and explicit local-time/timezone policy. SMS, webhook, profile-update, split-test and push nodes are not implemented just because related concepts might appear in mock UI/history.

## Versions, publishing and activation

Flow draft graph lives on Flow. Publish validates and creates immutable FlowVersion plus EmailFlowDependency/FlowTriggerDependency and validation evidence. Active flow version and activation time are pinned. Email actions select published EmailVersion IDs. Existing runs retain their original graph after a draft edit.

Activation distinguishes active production, testing and non-sending modes and relies on readiness plus Phase2 external gate evidence. Simulation is a domain/test projection, not an SES live-send proof. Entry rules, cooldown/idempotency and activation-time checks prevent historical list events from becoming new entries by default.

## Runtime path

Phase3RuntimeService creates FlowRun and scheduled node work. FlowNodeExecution records attempts, branch result/evidence and next action. Delay/wait actions are durable ScheduledAction records. Condition evaluation uses typed segment rules against the profile, storing evidence so a resumed branch is not casually re-decided. Email creates canonical Phase2 Message/outbox through PrismaPhase2FlowMessagePort. End, cancellation, exit rules, pause/resume and dead-letter/replay are represented in the service.

Production worker real-phase3-main.ts dispatches generic events through FlowTriggerDependency; list/segment transitions require current active dependencies; profile-date schedules are leased and cancelled if the version is no longer active. Segment transition freshness is checked against current projection evidence. Published runs/messages must survive later graph editing.

## Actual operational gaps

PrismaPhase3Repository.claimDueActions selects pending due ScheduledAction rows without filtering actionType. It can lease sender_domain.verify jobs owned by the domain worker. Its broad lease-recovery operations have the same cross-worker concern. This is a serious shared-scheduler ownership bug.

Phase3JobQueue audience-transition IDs contain four colon-separated segments and fail installed BullMQ validation. The local proof automation worker handles list.joined and selected test-only phase2.message.policy events, not the full generic/segment/date/live path. dev:all does not start the real Phase3 worker/scheduler. A green flow card or successful publish does not prove background execution.

In-memory automation tests cover graph validation, immutable versions, branching, timings, entry rules, exits and operational actions. PostgreSQL claims, Redis dispatch, multi-worker races, real SES feedback and browser canvas behavior are not end-to-end validated.

## Continue without rebuilding

Fix scheduler ownership and queue IDs; add isolated PG/Redis runtime tests; supervise required workers; validate one controlled list entry → wait → email → end with pinned versions. Add new node types only across graph types, validator, editor, runtime, trace, tests and migration/compatibility handling. Do not solve a UI request by creating a second automation engine.

