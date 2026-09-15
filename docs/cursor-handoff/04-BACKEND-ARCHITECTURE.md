# Backend architecture

## Processes and routing

`apps/api/src/app-server.ts` is a Node HTTP reverse-proxy gateway, not Express/Fastify/Nest. It binds 127.0.0.1:4000 by default and spawns platform (4101), delivery (4102), automation (4103), and governance (4104) child processes. Child ports are assigned by this gateway. It supplies CORS for the configured frontend origin.

The public callback server is `apps/public-api/src/real-server.ts`, default 4001. Setting EMAIL_PLATFORM_PUBLIC_BASE_URL advertises a URL; it does not make port 4000 serve public callbacks or provision HTTPS. A deployment reverse proxy must explicitly expose the public process.

| Module | Main responsibilities | Application/persistence |
|---|---|---|
| platform-api.ts | Identity/bootstrap, profiles, imports/exports, lists, content, domains, senders, dashboard, settings, deliverability | Phase1Service; BrandedDomainProvisioningService; PrismaPhase1Repository; direct Prisma query helpers |
| delivery-api.ts | Email draft/preflight/publish, tests, intents, traces and message controls | Phase2Service, PrismaPhase2Repository, SES/disabled send adapter, Phase2JobQueue |
| automation-api.ts | Segments, event schema/ingestion, credentials, flow graph/version/run operations, analytics | Phase3Service, Phase3RuntimeService, segment projection, PrismaPhase3Repository |
| governance-api.ts | Launch/recovery/security/privacy/pilot/release evidence | Phase4 service/repository; several tables and queries are global |
| public real-server.ts | Signed SNS, unsubscribe, click redirect, API-key events | InboxMessage, delivery attempts/events; feedback queue; dedicated public handlers |

## Service and storage boundaries

Domain functions validate email/profile data, import policy, consent, content documents, graph structure, segment rules, message policy, sender routes, and domain names. Application services sequence those decisions and call ports. Prisma adapters persist tenant data, immutable artifacts, append-only histories, outbox/inbox work, leases and projections. Provider adapters translate AWS response/error semantics into platform contracts.

Not every API follows that boundary. platform-api includes direct Prisma reads and write helpers; some do not invoke membership authorization. Services are therefore not a universal security perimeter. Authorization must be reviewed at each route, including nested resources.

## Request and error handling

Private modules accept development identity in nonproduction only when enabled, local sessions in development, or configured OIDC Bearer tokens. Membership and permission checks are generally explicit service calls, not gateway middleware. JSON success shapes vary: individual object, {items}, overview, or mutation result. BigInt serialization is handled in primary modules but is not consistently shared with governance.

Routes use ordered regex/exact-string branches. Body parsing is handwritten; there is no single runtime request schema/OpenAPI specification. Field constraints often live in services/domain validators. Unknown service errors often become HTTP 400 with the raw error message as code/detail. Domain-friendly translations exist but do not cover arbitrary Prisma/provider failures. See [API inventory](16-API-INVENTORY.md) and [issues](20-KNOWN-ISSUES-AND-TECH-DEBT.md).

## Proven dispatch conflicts

The gateway routes any nested “messages” to delivery and “flow-runs” to automation. This makes platform handlers for /profiles/:id/messages and /profiles/:id/flow-runs unreachable through 4000. /send-policy GET/PATCH is also sent to delivery, whose handler accepts POST only, shadowing the platform versions. /api-keys has duplicate implementations and resolves to automation. In automation, the generic GET /segments/:id precedes /segments/rule-registry and consumes that literal.

These are code-reachable failures even with valid AWS/DB keys. Do not diagnose them as external credentials.

## Consistency and reliability

Durable message/inbox/outbox records and unique keys are good foundations. They do not alone guarantee exactly-once external side effects. The send submission path lacks an exclusive transition before SES; Phase3 scheduler claims domain actions; selected BullMQ IDs are invalid; public-feedback jobs are not part of dev:all. Repair these existing paths instead of adding another delivery engine.

Production deployment additionally needs process supervision, health separation, graceful shutdown, TLS ingress, shared artifact storage, correct worker startup, and controlled DB migrations. Existing health checks and evidence rows are not independent production certification.

## Actual platform error mapping

Source: apps/api/src/platform-api.ts status(code), publicErrorMessage(code,message), and packages/domain/src/phase1/branded-domain.ts DOMAIN_REASON_CODES. This is the private platform module's mapping, not a uniform contract across all modules. A readiness reason may be returned inside a successful200 view; HTTP below applies when the code is thrown through this handler.

| Internal code/category | HTTP | Customer behavior | Retry interpretation |
|---|---:|---|---|
| AUTH_* |401|Authentication required/failed|Authenticate, not blind retry|
| FORBIDDEN*, WORKSPACE_ACCESS_DENIED |403|Permission failure|Change authorization, not credentials to AWS|
| NOT_FOUND, *_NOT_FOUND |404|Missing resource|Check ID/tenant/archive state|
| *CONFLICT*, DOMAIN_ALREADY_CLAIMED, DOMAIN_HAS_ACTIVE_SENDS |409|Conflicting claim or active/unknown send|Resolve conflict/reconcile; do not delete evidence|
| DOMAIN_RATE_LIMITED |429|Too many checks|Wait before retry|
| REQUEST_TOO_LARGE |413|Rejected request size|Reduce upload/body|
| AWS_ACCESS_DENIED, PROVIDER_AUTHENTICATION_FAILED |502|Administrator/provider authentication attention|Fix IAM/credentials; not automatic success|
| AWS_THROTTLED |503|Temporarily delayed|Retryable by domain worker|
| SES_PROVIDER_UNAVAILABLE |503|Provider unavailable; unmapped detail may fall through|Investigate provider/network; not necessarily disabled keys|
| DNS_TIMEOUT, DNS_SERVFAIL |503|Resolver timeout/SERVFAIL|Domain worker retries|
| DNS_DELEGATION_PENDING |400|Publish the shown NS and ownership TXT records|Pending, domain worker retries every 5s|
| OWNERSHIP_VERIFICATION_PENDING |400|Publish the ownership TXT record|Pending, domain worker retries every 5s|
| DKIM_RECORDS_PENDING |400|Publish exact DKIM records|Customer DNS fix; not in every worker retry allowlist|
| SES_VERIFICATION_PENDING |400|DNS visible, SES still processing|Domain worker retries|
| SES_VERIFICATION_FAILED |400|Review DNS/verification|Investigate, not blanket retry|
| MAIL_FROM_PENDING |400|Branded routing still finishing|Domain worker retries|
| ROUTE53_CREATE_FAILED |400|Could not prepare domain|Investigate ownership/IAM/provider; explicit recheck|
| VANITY_NS_NOT_APPLIED |400|Infrastructure preparing|Check mapping and actual record propagation|
| DOMAIN_PROVISIONING_IN_PROGRESS |400|Already being checked|Wait for lease; not concurrent provisioning|
| DOMAIN_REMOVAL_CONFIRMATION_REQUIRED |400|Type exact domain|User confirmation required|
| DOMAIN_HAS_SENDER_IDENTITIES |400|Old remove/move identity message retained|Compatibility error string; current removal cascades identities after safe cleanup|
| DOMAIN_PROVIDER_NOT_CONFIGURED, SES_REGION_NOT_CONFIGURED |400|Server setup not configured|Configuration correction|
| Invalid domain/email/URL/root input codes |400|Enter registrable root, not URL/email/subdomain|Correct input|
| Other codes, including WORKSPACE_SENDING_DOMAIN_EXISTS |400 default|Fallback can return raw message|Classify explicitly; avoid leaking raw Prisma/SDK details|

The V2 reason-code list additionally includes DNS_PROVIDER_NOT_CONFIGURED, VANITY_NAMESERVERS_NOT_CONFIGURED, VANITY_NAMESERVER_MAPPING_INVALID, HOSTED_ZONE_PROVISIONING, DNS_DELEGATION_MISMATCH, EMAIL_IDENTITY_PENDING, DKIM_PENDING, TRACKING_CERTIFICATE_PENDING, TRACKING_HTTPS_PENDING, DMARC_WARNING, BUSINESS_INFORMATION_MISSING, FEEDBACK_NOT_READY, UNSUBSCRIBE_NOT_READY, SENDER_IDENTITY_MISSING, ROUTE_NOT_ACTIVE, WORKSPACE_HELD and SOA_VERIFICATION_PENDING. These are capability/evidence concepts, not necessarily separate HTTP failures. See the domain service's explicit retry list rather than assuming every pending label retries automatically.
