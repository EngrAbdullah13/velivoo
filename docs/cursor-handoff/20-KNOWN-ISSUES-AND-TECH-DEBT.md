# Known issues and technical debt

Severity: P0 immediate tenant/security or uncontrolled-send risk; P1 core workflow/reliability blocker; P2 important hardening/UX/data gap; P3 maintenance. Static findings identify reachable code and an unguarded interleaving; they are not claims of observed exploitation. No fixes were applied during this audit.

## Code blockers

| ID | Priority | Finding and impact | Concrete evidence | Next verification / repair |
|---|---|---|---|---|
| SEC-01 | P0 | Authenticated user can query another workspace's home/search without membership | apps/api/src/platform-api.ts:338; actor only authenticates | Add tenant guard and cross-tenant HTTP test |
| SEC-02 | P0 | Export metadata direct read lacks membership gate | platform-api.ts:397 | Guard status and download consistently; test B→A access |
| SEC-03 | P0 | Workspace admins can reach global operational/governance data/actions | requireInfrastructureAdmin in platform-api; governance-api auth; phase4-repository global models | Separate platform operator authorization and tenant scope |
| SEND-01 | P0 | Two submitters can use one created attempt and both call SES; crash-after-accept window can resend | phase2-service.ts submit; phase2-repository.ts createAttempt; ses-provider.ts | Atomic exclusive claim/fencing plus unknown outcome policy; PG concurrency test |
| JOB-01 | P1 | Phase3 claims and recovers ScheduledAction rows without action-type ownership, including domain jobs | packages/persistence/src/prisma/phase3-repository.ts claimDueActions/releaseExpiredLeases | Partition predicates, lease ownership tests with both workers |
| JOB-02 | P1 | Selected BullMQ custom IDs invalid: feedback2 segments, phase0 scheduled4, audience transition4 | phase0-runtime.ts; phase3-job-queue.ts; installed bullmq job validation | Safe stable encoded/hash IDs; real Redis enqueue tests |
| JOB-03 | P1 | dev:all omits feedback, Phase1 and real Phase3 process pairs | apps/api/src/dev-all.ts | Explicit supervised process manifest; liveness/backlog tests |
| ROUTE-01 | P1 | Profile messages/flow-runs and policy GET/PATCH routed to wrong modules | app-server.ts phaseFor; platform-api versus delivery/automation | Registry/contract tests at gateway |
| ROUTE-02 | P1 | /segments/rule-registry consumed by /segments/:id | automation-api.ts ordered branches | Reorder/specific route and regression test |
| FEED-01 | P1 | Early/unmatched feedback never re-correlated; worker recovery unreachable for these rows | public real-server ingest; scheduler real-main received-only sweep | Durable bounded unmatched recovery with trusted attempt authority |
| FEED-02 | P1 | Concurrent out-of-order event projection can race; P2002 catch inside transaction needs PG validation | apps/worker/src/real-feedback.ts | Lock/CAS terminal state and transactional duplicate integration test |
| DOMAIN-01 | P1 | Missing tracking adapter treated ready; absent CloudFront config can silently pass | domain-provisioning-service.ts !this.tracking; platform composition | Explicit mode/fail-closed checks |
| DOMAIN-02 | P1 | Disconnect retry after zone deletion may fail; archived recreate retains stale refs/evidence | route53-dns-provider deleteZoneSafely; phase1-repository upsertDomain | Failure injection at each external/persistence step |
| DOMAIN-03 | P1 | Zone-by-name adoption lacks explicit platform ownership tags/check | route53-dns-provider ensureDelegatedZone | Prove ownership before modification; preserve unmanaged resources |
| SEND-02 | P1 | Generic message intent without jobs persists with no dispatch fallback | delivery-api.ts POST /messages | Refuse unavailable dispatch or add reliable outbox use |
| AUTH-01 | P1 | Production OIDC browser login/session UX incomplete; dev login not production auth | dev-bootstrap; local-session-auth; oidc-jwt-provider | Production identity integration and negative tests |
| SECRET-01 | P1 | .env secret material present; insecure local fallback signing/pepper constants | .env (values withheld); env.ts/private APIs/workers | Exposure assessment, rotation if shared, production required-secret validation |
| READY-01 | P1 | Global/stale gate rows and permissive probes can overstate readiness | workspaceOperationalReadiness; infrastructure-readiness; CloudFront HTTPS probe | Real scoped evidence, freshness, strict expected response |
| SEND-03 | P2 | Frequency count/reserve and capacity reservation/retry semantics need concurrency proof | phase2-service/repository; capacity bucket transaction | Real simultaneous sends and serialization-error tests |
| WEBHOOK-01 | P2 | SNS no timestamp window/fetch timeout; unknown signature version falls back SHA1 | packages/provider-email/src/ses/sns-verifier.ts | Reject unknown versions, bound fetch, replay policy |
| FEED-03 | P2 | UnsubscribeConfirmation no-op; SES send/rendering_failure ignored | public real-server; normalize-feedback.ts | Persist/control subscription lifecycle; decide event schema coverage |
| CONSENT-01 | P2 | Public unsubscribe updates evidence/suppression but not SubscriptionState projection | real-unsubscribe-handler.ts | Transactional projection update/rebuild test |
| IMPORT-01 | P2 | Buffered import and line parser fail multiline CSV; large upload limits risk memory | platform-api upload/preview; phase1-service; phase1/csv.ts | Streaming RFC-compatible parser, bounds/backpressure |
| ERROR-01 | P2 | Raw unknown Prisma/SDK messages can reach customer responses | platform-api publicErrorMessage fallback; client friendly fallback | Safe diagnostic mapping and server-only detail |
| TRACK-01 | P2 | Open tracking flags exist without pixel/collector | phase2 content/tracking; public route inventory | Separate designed feature, not flag-only “completion” |
| DOMAIN-04 | P2 | Region/prefix settings inconsistent with V2 derivation; transfer recovery incomplete | env.ts; branded-domain.ts; service constructor/transfer | Pin region, reject unsupported config, transfer integration tests |
| DATA-01 | P2 | Outbox partial unique index disagrees with Prisma native-upsert inference | SQL indexes versus schema @unique | Audit call sites; migration only after explicit review |
| STORAGE-01 | P2 | Local artifact storage not a complete distributed production object service | packages/object-store/src/local-object-store.ts | Durable shared store, access/retention/recovery |
| CSV-01 | P2 | Analytics CSV quoting does not itself neutralize formula-leading user content | analytics-dashboard.ts export helper | Spreadsheet injection test/safe escaping |
| UI-01 | P2 | No browser tests for sidebar, page typography, canvas inspector and drawers | tests inventory; globals.css/app-shell | Add focused browser regression suite |
| DEBT-01 | P3 | Duplicate APIs/helpers, long compressed source/CSS and historical names complicate maintenance | platform/delivery duplicates; phase4-api; globals.css; package name | Consolidate incrementally after contract tests |
| BUILD-01 | P3 | Root compilation input exclusions mean standalone runtimes need explicit coverage | tsconfig.json | Dedicated worker/public typecheck targets |

## External blockers and unknowns (not code defects)

CloudFront distribution/group IDs are empty; configured platform tracking is an intentional local mode. OIDC issuer/audience absent. SNS topic exists in env but current subscription/signature evidence is absent. Tracking/unsubscribe endpoint gates are blocked. Live AWS credentials/IAM, SES sandbox status, provider quotas, vanity mapping ownership, customer DNS, TLS and ngrok forwarding were not independently checked.

PostgreSQL is accessible locally and 23 migrations are applied. No production deployment, backups, restore, Redis failover or load test was validated. Do not “clear” these blockers with invented passed evidence.

## Resolved historical issue, not an open finding

The earlier ScheduledAction upsert 42P10 failure came from a partial unique index. Migration 20260903000100_scheduled_action_dedupe_constraint is applied locally and restores a compatible full unique constraint. Domain Add UI now preserves its field on failed operations. These prior fixes do not establish that every domain/AWS workflow now succeeds.

