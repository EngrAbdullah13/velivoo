# Velivoo root-domain onboarding V2 — audit and implementation report

Date: 2026-09-02

Canonical architecture for new domains:

- visible From / SES identity: `customer.com`
- delegated infrastructure: `send.customer.com`
- custom MAIL FROM: `bounce.send.customer.com`
- branded tracking: `click.send.customer.com`
- initial customer work: exactly four vanity NS records and three SES Easy DKIM CNAME records

## 1. Before audit

| Area | Existing files | Before status | Existing behavior / risk | Resolution |
|---|---|---:|---|---|
| Domain persistence and tenant ownership | `schema.prisma`, `phase1-repository.ts` | PARTIAL | Workspace scoping existed, but no V2 evidence, transfer model, global active-root constraint, or durable provisioning lease | Extended the existing model/repository and added one migration; no parallel domain store |
| Domain normalization | `dns.ts` | PARTIAL | Basic syntax checks were not Public Suffix List-aware | Added PSL-aware registrable-root, IDN/Punycode, reserved-name, URL/path/port/IP/wildcard validation |
| Domain naming | `branded-domain.ts` | WRONG_ARCHITECTURE | `send.<root>` was used as the sending/visible domain | Added V2 derivation helpers and kept V1 behavior explicit |
| Route 53 child zone | `route53-dns-provider.ts` | PARTIAL | Child zone and shared delegation foundation existed; caller reference and SOA handling needed hardening | Stable caller reference, shared-set verification, safe SOA primary rewrite, vanity NS reconciliation |
| SES identity / DKIM | `ses-email-domain-provider.ts` | WRONG_ARCHITECTURE | SES identity was the infrastructure subdomain; DKIM target could be hard-coded | V2 identity is root; targets use provider `SigningHostedZone`; tokens/zone are persisted |
| Customer DNS records | provisioning service/UI | WRONG_ARCHITECTURE | DKIM was treated as child-zone-managed and customer work was ambiguous | Customer receives exactly 4 NS + 3 root DKIM CNAME records |
| Public DNS recheck | Route 53 provider/service | PARTIAL | Provider state and application evidence could be conflated | Added independent NS/SOA/CNAME/TXT resolution and mismatch/NXDOMAIN/timeout/SERVFAIL classifications |
| Multi-resolver diagnostics | none | MISSING | No cross-resolver perspective | Added Cloudflare and Google recursive NS diagnostic perspectives |
| MAIL FROM | SES/Route 53 provisioning | PARTIAL | Support existed, tied to the old identity architecture | Root identity plus `bounce.send.<root>`, automatic MX/SPF, `REJECT_MESSAGE`, SES readiness polling |
| DMARC | provisioning | WRONG_ARCHITECTURE | Child-domain DMARC could be managed as if equivalent to root policy | Root DMARC is observed and persisted; it is never overwritten |
| Lifecycle/readiness | domain helpers/service | PARTIAL | Coarse statuses existed | Canonical V2 lifecycle and evidence-backed capability gates |
| Configuration set/SNS/feedback | SES provider, API, workers | COMPLETE | Durable provider feedback and suppression pipeline already existed | Preserved and reconciled with V2 identity/route |
| Tracking | CloudFront provider | PARTIAL | Provision/check existed; teardown was incomplete | Kept AWS-returned validation only and added tenant disable/delete on disconnect |
| Sender UI/API | sender identity manager/service | WRONG_ARCHITECTURE | New sender addresses could resolve to `@send.<root>` | V2 sender is `localPart@root`; V1 remains supported |
| Send path | routing/Phase 2 | PARTIAL | Route gating existed but identity/domain consistency was not explicit enough | Enforced active domain, ready route, matching root From domain, and matching provider identity |
| Recheck worker | branded verification worker | PARTIAL | Durable lease existed; retryable exceptions could terminate the schedule | Retryable DNS/AWS/provider failures reschedule without permanent failure |
| Disconnect | service/provider/repository | PARTIAL | Archival existed; tracking and active-attempt safety were missing | Hold route first, reject active attempts, remove tenant/SES/managed child zone, preserve shared infrastructure, then release claim |
| Transfer | none | MISSING | DNS match could not safely imply ownership | Added explicit source request + authenticated target approval + expiry + audit trail |
| API protection | `platform-api.ts`, services | PARTIAL | Authentication/authorization existed | Added bounded create/recheck rate limits, safe error mappings, transfer checks, tenant-scoped detail endpoints |
| Admin readiness/customer UI | existing deliverability components | COMPLETE/PARTIAL | Useful screens existed, but V2 names/statuses needed alignment | Reused pages; exposed business-safe root/infra distinctions and hid AWS internals |
| Automated coverage | test suite | PARTIAL | Broad product tests existed; V2 architecture and teardown gaps were uncovered | Added V2 domain, PSL/IDN, DKIM zone, DNS failure, diagnostics, CloudFront teardown, and shared delegation safety tests |

## 2. Implemented changes

### Database

- Added provisioning version/caller reference, lease, public-verification, DKIM, DMARC, and disconnect evidence to `SenderDomain`.
- Added `SenderDomainTransfer` with source/target, state, expiry, and approval evidence.
- Added a partial unique index that prevents two active workspaces from claiming the same normalized V2 root.
- Kept existing rows as V1 unless deliberately migrated; new branded domains are V2.

### Backend and AWS orchestration

- Converted new provisioning to root SES identity plus delegated infrastructure child zone.
- Reconciles existing resources before create and persists stable provider references immediately.
- Uses one configured reusable delegation set and a stable `sender-domain:<id>` caller reference.
- Replaces only the SOA primary token while preserving all timing/hostmaster fields.
- Reads SES Easy DKIM tokens and `SigningHostedZone`; no Amazon DKIM hostname is hard-coded.
- Writes backend-managed MAIL FROM MX/SPF only after public DNS, root SES identity, and DKIM are ready.
- Preserves per-workspace SES configuration set and SNS event-destination behavior.

### DNS verification and readiness

- Public NS comparison is canonical, exact-set, order-independent, and rejects extras.
- Public SOA primary and every DKIM CNAME are checked independently of Route 53 API state.
- DNS failures distinguish NXDOMAIN, timeout, SERVFAIL, pending, and mismatch.
- Optional propagation diagnostics use two independent public recursive resolver perspectives.
- Every meaningful recheck refreshes SES root identity, VerifiedForSending, DKIM, and MAIL FROM state.
- Root DMARC is observed and surfaced as guidance without mutation.

### API, frontend, sender identity, and send pipeline

- Customer views separate root, infra, MAIL FROM, and tracking domains.
- V2 DNS setup displays only the seven customer-controlled records.
- V2 sender creation and selectors use `@rootDomain`; legacy records retain V1 semantics.
- Campaign/flow send resolution validates domain readiness and provider identity consistency server-side.
- Domain create/recheck uses bounded in-process request throttling and customer-safe errors.
- Transfer requires an authenticated source request and separate target-workspace approval.

### Disconnect and security

- Route is held before cleanup so no new send can resolve it.
- Disconnect rejects unresolved `created`/`unknown` delivery attempts.
- CloudFront teardown disables and deletes only the customer distribution tenant.
- SES identity and managed child-zone records are removed only after send safety checks.
- The reusable delegation set, vanity NS mappings, shared feedback infrastructure, and global tracking distribution are never deleted.
- All AWS operations remain server-side; no credentials or AWS identifiers were added to client responses.

## 3. Files changed

| File | Purpose / main change |
|---|---|
| `package.json`, `package-lock.json` | Added `tldts` for PSL-aware normalization |
| `packages/domain/src/phase1/dns.ts` | Registrable-root/IDN validation and DNS canonical/SOA helpers |
| `packages/domain/src/phase1/branded-domain.ts` | V1/V2 architecture constants, canonical lifecycle, domain derivations |
| `packages/application/src/ports/dns-provider.ts` | Public DNS evidence and optional multi-resolver diagnostics contract |
| `packages/application/src/ports/email-domain-provider.ts` | SES verification/DKIM signing-zone evidence contract |
| `packages/application/src/ports/domain-provisioning-repository.ts` | V2 persistence, lock, route-hold, active-attempt, archive operations |
| `packages/application/src/ports/phase1-repository.ts` | V2 sender-domain read model |
| `packages/application/src/ports/phase2-repository.ts` | V2 route/send-domain read model |
| `packages/application/src/ports/tracking-domain-provisioner.ts` | Tracking teardown contract |
| `packages/application/src/phase1/domain-provisioning-service.ts` | End-to-end V2 orchestration, recheck, readiness, retry, disconnect |
| `packages/application/src/phase1/phase1-service.ts` | V2 sender identity and readiness gates |
| `packages/application/src/phase2/email-routing-service.ts` | Send-time root/route/provider identity consistency checks |
| `packages/persistence/prisma/schema.prisma` | V2 evidence/lease/transfer schema |
| `packages/persistence/prisma/migrations/20260902000100_root_sender_domain_v2/migration.sql` | Forward database migration and global active-root constraint |
| `packages/persistence/src/prisma/phase1-repository.ts` | Atomic claims, V2 evidence, safe disconnect, active-send lookup |
| `packages/persistence/src/prisma/phase2-repository.ts` | Root/version mapping for send routing |
| `packages/provider-email/src/route53/route53-dns-provider.ts` | Shared delegation, vanity NS/SOA, public verification, diagnostics, safe delete |
| `packages/provider-email/src/ses/ses-email-domain-provider.ts` | Root SES identity, Easy DKIM signing zone, MAIL FROM, config set |
| `packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.ts` | AWS-authoritative validation and tenant teardown |
| `apps/api/src/platform-api.ts` | Safe errors, throttles, detail/transfer endpoints |
| `apps/api/src/deliverability-dashboard.ts` | Customer-safe V2 readiness projection |
| `apps/web/src/components/deliverability-console.tsx` | V2 seven-record setup and lifecycle UI |
| `apps/web/src/components/sender-identity-manager.tsx` | V2 root-domain sender UX with V1 compatibility |
| `tests/branded-domain-provisioning.test.ts` | V2, DNS, provider, diagnostics, teardown coverage |

## 4. Migration behavior

- Applied migration: `20260902000100_root_sender_domain_v2`.
- Existing sender domains are not silently converted or destroyed; null/legacy versions follow V1 behavior.
- All newly created branded domains receive `V2_ROOT_SENDER_DELEGATED_INFRA`.
- A later operator-controlled migration can reconcile a legacy domain after verifying current sender/SES/Route 53 dependencies; this implementation deliberately does not mutate active legacy identities automatically.
- Active V2 root ownership is released only after completed archival.

## 5. Remaining external prerequisites

The Route 53 reusable delegation set and all four `ns1.velivoo.com`–`ns4.velivoo.com` mappings are now configured and verified. A real `lahorixsolutions.com` proof remains blocked until the deployment supplies:

- server IAM permission for the listed Route 53, SES v2, SNS, and CloudFront operations (without delegation-set deletion);
- SES production access in the configured region;
- shared SNS topic/subscription and public feedback endpoint;
- CloudFront multi-tenant distribution/connection group when branded tracking is enabled;
- customer publication of the generated four NS and three DKIM records.

No live customer DNS or AWS resources were created during the local automated run.

## 6. Environment variables

All AWS/configuration fields below are server-only unless marked public.

| Name | Required | Purpose | Example format |
|---|---:|---|---|
| `DNS_PROVIDER` | V2 | Select Route 53 capability | `route53` |
| `ROUTE53_DNS_ENABLED` | V2 | Enable branded DNS orchestration | `true` |
| `ROUTE53_DELEGATION_SET_ID` | V2 | Existing shared reusable delegation set | `N123EXAMPLE` |
| `ROUTE53_BRANDED_NS_DOMAIN` | V2 | Validate vanity NS suffix | `velivoo.com` |
| `ROUTE53_VANITY_NS_MAPPING` | V2 | Four vanity-to-provider NS mappings | JSON object or `vanity=provider,...` |
| `ROUTE53_EXPECTED_NAME_SERVERS` | fallback | Four expected vanity NS values | comma-separated FQDNs |
| `EMAIL_PROVIDER` | V2 | Select SES provider | `ses` |
| `EMAIL_PLATFORM_SES_DOMAIN_SETUP_ENABLED` | V2 | Enable SES domain setup | `true` |
| `AWS_SES_REGION` | V2 | SES identity/MAIL FROM region | `us-east-1` |
| `AWS_REGION` | V2 | AWS SDK region used by Route 53 and other server clients | `us-east-1` |
| `EMAIL_PLATFORM_SES_SUPPORTED_REGIONS` | recommended | Server allowlist | `us-east-1,eu-west-1` |
| `EMAIL_PLATFORM_SNS_TOPIC_ARN` | production | Shared feedback topic | `arn:aws:sns:region:account:topic` |
| `SENDING_DOMAIN_PREFIX` | legacy/config | Infrastructure prefix; V2 canonical value is `send` | `send` |
| `SES_DEFAULT_MAIL_FROM_PREFIX` | legacy/config | MAIL FROM prefix; V2 canonical value is `bounce` | `bounce` |
| `TRACKING_DOMAIN_MODE` | required | `platform` or `cloudfront_saas` | `cloudfront_saas` |
| `TRACKING_DOMAIN_PREFIX` | legacy/config | Tracking prefix; V2 canonical value is `click` | `click` |
| `CLOUDFRONT_MULTI_TENANT_DISTRIBUTION_ID` | CloudFront mode | Shared distribution | AWS distribution ID |
| `CLOUDFRONT_CONNECTION_GROUP_ID` | CloudFront mode | Shared connection group | AWS connection-group ID |
| `EMAIL_PLATFORM_PUBLIC_BASE_URL` | yes | Public tracking/feedback base | `https://events.velivoo.com` |
| `MANAGED_DMARC_REQUIRED` | optional | Make observed root DMARC a readiness requirement | `false` |
| `EMAIL_PLATFORM_DOMAIN_VERIFICATION_POLL_MS` | optional | Worker poll interval | `5000` |
| `EMAIL_PLATFORM_DOMAIN_VERIFICATION_LEASE_MS` | optional | Durable lease interval | `120000` |
| `DATABASE_URL` | yes | PostgreSQL persistence | standard PostgreSQL URL |

## 7. Test results

- TypeScript application typecheck: passed.
- Web TypeScript typecheck: passed.
- Production Next.js build: passed; all routes compiled.
- Prisma schema validation: passed.
- Prisma client generation with the normal local engine: passed.
- Database migration deployment: passed.
- Automated tests: **154 passed, 0 failed**.
- Added/updated coverage includes root/infra derivation, PSL/IDN validation, exact seven records, SES SigningHostedZone, Route 53 vanity NS/SOA, timeout/SERVFAIL/NXDOMAIN, two-resolver diagnostics, CloudFront tenant teardown, and shared-delegation teardown safety.
- Environment-dependent tests not run: real Route 53/SES/SNS/CloudFront operations and controlled delivery for `lahorixsolutions.com`.
- Local runtime health after migration: web HTTP 200 and API phase-1 health HTTP 200.

## 8. Definition of done

| # | Requirement | Result | Evidence |
|---:|---|---|---|
| 1 | Connect a new root domain | DONE | V2 create API/service/repository |
| 2 | Root-domain visible sender | DONE | `phase1-service.ts`, sender manager, tests |
| 3 | SES identity is root | DONE | provisioning/SES tests |
| 4 | `send.<root>` infrastructure only | DONE | V2 helpers/customer view |
| 5 | Child zone uses shared delegation set | DONE | Route 53 provider/test |
| 6 | Child NS uses vanity ns1–ns4 | DONE | Route 53 reconciliation/test |
| 7 | SOA primary is vanity ns1 | DONE | token-preserving rewrite/test |
| 8 | Four customer NS records | DONE | exact-seven test |
| 9 | Three customer DKIM CNAMEs | DONE | exact-seven test |
| 10 | DKIM uses SigningHostedZone | DONE | SES provider/test |
| 11 | Public DNS recheck | DONE | NS/SOA/CNAME/TXT resolver checks |
| 12 | SES provider state checked | DONE | every V2 recheck calls root identity lookup |
| 13 | Automatic custom MAIL FROM | DONE | orchestration/service |
| 14 | Automatic MAIL FROM MX/SPF | DONE | SES record generation + Route 53 writes |
| 15 | MAIL FROM success verified | DONE | SES status readiness gate |
| 16 | Root DMARC observed, not changed | DONE | TXT observation only |
| 17 | Evidence-based readiness | DONE | lifecycle/reasons/route gate |
| 18 | Sender uses `user@root` | DONE | service/UI/send checks |
| 19 | Unready campaigns/flows blocked | DONE | route resolver and send path |
| 20 | Configuration set/SNS preserved | DONE | existing pipeline reconciled |
| 21 | Tracking functional/capability-gated | DONE | platform/CloudFront providers and route gate |
| 22 | Infrastructure Readiness retained | DONE | existing admin page/backend reused |
| 23 | Idempotent create/recheck | DONE | stable caller reference, ensure/upsert reconciliation |
| 24 | Concurrent provisioning protected | DONE | DB lease and partial unique index |
| 25 | Tenant authorization | DONE | service/API workspace checks; existing isolation suite |
| 26 | Disconnect preserves shared infrastructure | DONE | safe-delete code and explicit test |
| 27 | Transfer cannot bypass ownership | DONE | explicit request/approval/expiry/audit |
| 28 | Legacy domains preserved | DONE | provisioning version branch |
| 29 | No fake production status/buttons | DONE | provider/public evidence drives state |
| 30 | Relevant automated tests | DONE | 154/154 passed |
| — | First live Lahorix DNS/send proof | BLOCKED EXTERNALLY | requires real AWS/account/customer DNS prerequisites above |
