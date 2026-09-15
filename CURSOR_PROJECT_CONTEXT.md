# Velivoo — Cursor project context

Audit snapshot: **2026-09-03**. Read this first, then [the handoff index](docs/cursor-handoff/00-CURSOR-START-HERE.md), the relevant subsystem chapter, and executable source. This is a repository audit, not a production certification. No application feature logic, database migration/data, credential configuration or AWS resource was changed during this handoff. Build outputs and a read-only documentation inventory utility were generated.

## 1. Purpose, scope and current state

Velivoo is an email-first multi-workspace marketing platform intended to grow toward Klaviyo-style customer data, content, automation and delivery operations. Marketers manage audiences and messages, operations teams manage sending safety and domains, and developers ingest customer events. The public brand is Velivoo; package names and older documentation still say Omni Present or email-platform. Do not interpret those names as separate applications.

The current repository is substantial, not an empty scaffold. It includes real profile/list/import persistence, consent and suppression, a structured email editor and template library, immutable published content, flow graph validation/execution, SES sending, Route 53/SES domain onboarding, durable SNS feedback, signed unsubscribe/click endpoints, analytics, settings and operational readiness. However, production readiness is PARTIAL. Static audit found tenant authorization violations, concurrent-send risk, invalid queue IDs, shared scheduled-action ownership defects and missing process orchestration.

A dedicated campaign broadcast/audience snapshot scheduler, billing, commerce integrations, SMS/WhatsApp, revenue attribution and actual open-pixel collection are not complete implementations. Marketing page prices, testimonials and sample metrics are illustrative, not backend billing or measured customer outcomes. Historical screenshots specify UI preferences, not data contracts. See [product overview](docs/cursor-handoff/01-PRODUCT-OVERVIEW.md) and [status matrix](docs/cursor-handoff/18-IMPLEMENTATION-STATUS.md).

## 2. Evidence hierarchy and working directory

The source-of-truth order is: current executable code; schema/migrations; tests; current project documentation; this master context; Cursor handoff documents; historical comments and legacy docs. If these disagree, document the conflict and inspect the executing entrypoint. A similarly named old file can implement a different runtime.

The actual repository is the inner email-marketing-platform-release1-complete directory containing package.json, apps and packages. No Git metadata was available in that directory or its parents. Git history, diffs, branches, tags and whether credentials were ever committed are UNKNOWN. Do not invent a history from phase names. SQL migrations are the available chronological evidence.

The audit inventoried 86 Prisma models, 44 authored frontend page files, 225 explicit method/path handler branches across real/private/proof servers, 66 directly referenced environment keys plus implicit AWS_SESSION_TOKEN, and 19 test files containing 157 tests. Detailed source-linked references are in chapters03,05,15,16,21 and23. Inventories describe current source, including shadowed routes and legacy entrypoints; counts do not mean all features are production-working.

## 3. Repository architecture and dependencies

This is a Node22 TypeScript npm workspace. Root TypeScript is5.8.3, Prisma6.0.0, BullMQ6.1.2 and ioredis6.0.0; frontend is Next16.3.1 with React19.2.8. AWS SDK adapters use SESv2, Route53, CloudFront and SNS-related integration. package.json/package-lock.json remain authoritative for exact versions.

apps/web contains App Router pages and client consoles. apps/api contains the private gateway and platform/delivery/automation/governance modules. apps/public-api contains public callbacks. apps/worker and apps/scheduler contain several independent background runtimes. packages/domain contains pure validation/policy; packages/application contains services and ports; packages/persistence contains Prisma schema/migrations/adapters and proof stores. Separate packages provide queues, providers, rendering, local object storage, contracts, observability and test helpers.

The intended direction is browser → route → application service → domain policy plus repository/provider ports → PostgreSQL/Redis/AWS. Some current routes bypass services with direct Prisma queries; these require special authorization scrutiny. Preserve these existing boundaries while repairing gaps. Do not introduce a parallel sender, audience store, automation engine or domain-onboarding abstraction. [Repository map](docs/cursor-handoff/02-REPOSITORY-MAP.md) and [file index](docs/cursor-handoff/23-FILE-INDEX.md) identify exact files.

## 4. Processes and HTTP boundaries

apps/api/src/app-server.ts is a handwritten Node HTTP reverse proxy. It binds127.0.0.1:4000 by default and launches platform-api4101, delivery-api4102, automation-api4103 and governance-api4104. Route selection uses ordered regexes. This is not an Express/Nest router with universal middleware or a generated OpenAPI contract.

The public real server is a separate process on4001. It is not forwarded by gateway4000. Frontend3000 calls the private gateway; SNS, clicks and unsubscribe need public HTTPS ingress to4001. EMAIL_PLATFORM_PUBLIC_BASE_URL constructs advertised public URLs but does not create an HTTPS listener, reverse proxy, DNS record or SNS subscription.

dev:all starts gateway, public server, frontend and domain worker, conditionally Phase2 delivery, and a local proof automation subset. It does not start all feedback/import/real automation workers and schedulers. A successful API response or healthy frontend does not establish that durable work is being consumed. [Backend architecture](docs/cursor-handoff/04-BACKEND-ARCHITECTURE.md) and [jobs](docs/cursor-handoff/17-JOBS-QUEUES-WORKERS.md) explain exact launch coverage.

## 5. Frontend conventions and user-facing architecture

Most App Router pages await workspace params and render a client component. phase1Api fetches no-store with credentials included, using a stored emailPlatformAccessToken Bearer token or the development-user header. phase3Api aliases it. phase4Api is an older separate client using dev-header authentication and different env aliases, without the same Bearer behavior. Client state is mostly local React state/effects.

AppShell presents Home, Audiences, Marketing, Automations, Transactional, Analytics and Settings. Audiences contains Contacts linking to /profiles, Lists and Segments. Transactional currently means the Deliverability area, not a separate transactional messaging product. /content redirects to templates. settings/users and members are aliases, audit and audit-log are aliases, and settings/launch currently renders dangerous-actions rather than the old governance component.

Preserve Profiles-based Arial typography. Final globals.css overrides earlier DM Sans rules: titles31px/1.15/700 with -.045em letter spacing; table/body13px; table headings12px; secondary detail11px. Standard pages are full-width white with neutral rounded panels and purple/lime accents. Full logo and compact/fav mark live under apps/web/public/brand.

The sidebar compact state uses a server-read cookie plus component/session state. Only explicit opener/collapse controls should change it; navigating pages must not expand it. Preserve hover labels. The flow inspector belongs in the left palette region and must not disrupt canvas/scroll containment. Native navigation links still reload in places, and there are no browser regression tests proving flicker/layout behavior. Read apps/web/AGENTS.md and its local Next documentation instructions before edits.

## 6. Data model and tenant boundaries

PostgreSQL is the real runtime source of truth. There are86 Prisma models with string-valued states rather than schema enums. Workspace owns profiles, content, domains, policies, membership and runs. UserIdentity is global; WorkspaceMember associates user/role/state with a tenant. ConsentRecord, SubscriptionState, Suppression and ListMembership represent different facts and must not be collapsed.

EmailDefinition publishes immutable EmailVersion. EmailTemplate approval creates EmailTemplateVersion. Flow publishes FlowVersion and dependency rows; FlowRun pins a profile/version. FlowNodeExecution and ScheduledAction execute the run; email nodes create Message. Message connects immutable rendered artifacts, attempts, provider events and click links. InboxMessage persists external receipt; OutboxEvent schedules local effects; audit/trace records explain changes.

Many logical references are scalar IDs; SQL migrations include constraints not declared as Prisma relations. Never assume an absent @relation means no SQL foreign key, or workspaceId alone guarantees authorization. Global governance/evidence tables need platform-level permissions.

The local read-only audit found23 applied migrations with no failed/rolled-back records. Latest20260903000100_scheduled_action_dedupe_constraint fixes native upsert42P10 by replacing a partial scheduled_action dedupe index with a full unique constraint while allowing multiple NULLs. Outbox retains a partial unique index against Prisma @unique and needs separate review. Suppression and active-domain claims use SQL-only partial uniqueness. [Database chapter](docs/cursor-handoff/05-DATABASE-MODEL.md) includes every exact field and constraint.

## 7. Canonical V3 domain architecture

For customer.com, the visible From is user@customer.com and the SES identity is customer.com. send.customer.com is delegated infrastructure only. Custom MAIL FROM is bounce.send.customer.com; tracking is click.send.customer.com. Root DMARC remains at _dmarc.customer.com. Do not describe user@send.customer.com as the canonical new behavior.

New domains use `V3_ROOT_SENDER_DELEGATED_EASY_DKIM`. Customers publish four NS records for `send.customer.com` plus the `_amazonses.customer.com` ownership TXT record. After delegation, Velivoo publishes SES Easy DKIM CNAMEs, MAIL FROM, and tracking inside that Route 53 zone. Customers do not add DKIM CNAME, MAIL FROM, SPF, or tracking records. Velivoo does not generate or store DKIM private keys. Existing `V2_ROOT_SENDER_DELEGATED_INFRA` domains retain their three root Easy DKIM CNAMEs until an explicit migration; leftover `V3_ROOT_SENDER_PLATFORM_DKIM` rows are treated as the delegated Easy DKIM + ownership TXT path on prepare/recheck; `V1_LEGACY_SEND_SUBDOMAIN` remains legacy compatibility. `provisioningMode` separately distinguishes `branded_delegation` from `legacy_ses_records`.

packages/domain/src/phase1/branded-domain.ts validates roots with tldts, normalizes case/trailing dot/punycode, accepts a www normalization and rejects other subdomain/URL/email/IP/internal inputs. The service enforces one current domain per workspace and cross-workspace active-root claims. V2 helpers currently derive fixed send/bounce/click labels even though env prefix keys are parsed.

DomainProvisioningService, PrismaPhase1Repository, Route53DnsProvider and SesEmailDomainProvider are the canonical pieces. Do not replace them or silently migrate existing V2 records. [V2 compatibility](docs/cursor-handoff/06-DOMAIN-ONBOARDING-V2.md) and [V3 onboarding](docs/cursor-handoff/23-DOMAIN-ONBOARDING-V3.md) document both paths.

## 8. Domain preparation, recheck and capability gates

The domain claim is stored before AWS work. Provisioning uses a database lease and stable sender-domain:<id> CallerReference. Route53 ensures a child zone with the existing reusable delegation set, validates provider NS and vanity mappings, UPSERTs the four vanity apex NS values, and rewrites only the SOA primary nameserver while preserving other tokens.

For V3, SES `CreateEmailIdentity` creates the ROOT identity with Easy DKIM enabled. Velivoo reads the SES v1 ownership token and shows `_amazonses.customer.com` to the customer. It rewrites Easy DKIM CNAME names from `{token}._domainkey.customer.com` to `{token}._domainkey.send.customer.com` and UPSERTs them into the delegated zone. Identities that previously had Easy DKIM disabled are re-enabled with `PutEmailIdentityDkimSigningAttributes(AWS_SES)`. Easy DKIM is never disabled. V2 continues to ask the customer to publish the three SES Easy DKIM CNAMEs at the root. Phase2 submits unsigned MIME; SES Easy DKIM is the signer.

V3 recheck uses real Node DNS resolvers to check public NS, SOA, the ownership TXT, the rewritten delegated Easy DKIM CNAMEs and root DMARC. It requires SES VerificationStatus SUCCESS, VerifiedForSendingStatus true, and Easy DKIM status SUCCESS. Pending domains are rescheduled every 5 seconds. V2 retains its three-CNAME and SES DKIM SUCCESS checks. The resolver is recursive; an authoritative-labelled field is not proof of direct authoritative-server querying. Ready is fail-closed on SES Easy DKIM SUCCESS.

V3 does not block `adkim=s`, because a successful Easy DKIM signature for the root identity would use `d=customer.com`. SPF MAIL FROM remains `bounce.send.customer.com`. The service never rewrites the customer's DMARC record.

Once authentication passes, Velivoo configures MAIL FROM with REJECT_MESSAGE and writes its MX/SPF inside the delegated zone, then waits for SES MAIL FROM SUCCESS. It associates workspace configuration set/feedback destination, observes quotas, evaluates tracking and checks business/hold/feedback/unsubscribe gates. Root DMARC is observed, not overwritten.

LifecycleState names for new V3 domains are CREATED, WAITING_FOR_DNS, DNS_VERIFIED, OWNERSHIP_VERIFIED, SES_VERIFYING, DKIM_VERIFYING, READY, FAILED, DELETING and DELETED. Older V2 names remain valid for existing rows. Verification reschedules every five seconds while pending; worker poll defaults five seconds with 120-second leases. No Route53 GetChange/INSYNC waiter exists.

## 9. Domain removal, transfer and important weaknesses

Disconnect first blocks sending and checks active/unknown attempts, removes owned tracking resources and SES identity, safely removes managed zone records and the child zone, removes sender identities and clears draft references. Domain/route rows are archived; published versions, provider facts, DNS evidence and audit history remain. Shared delegation sets, shared configuration infrastructure and unrelated DNS must not be deleted.

There are real recovery gaps. Zone-by-name adoption does not independently prove platform ownership with tags. Missing-zone retry can fail after an earlier successful external deletion. Recreating an archived same-root record can retain stale references/evidence. Transfer request/approval exists but lacks a complete UI and fully validated in-flight/history/region/recovery behavior. Treat these as partial lifecycle implementations, not a reason to bypass ownership checks.

The service treats a missing tracking adapter as ready, so missing CloudFront configuration can silently degrade readiness. Global gate rows and permissive probes can overstate success. Region settings are not uniformly pinned across every V2 operation. Fix these with failure-injection tests and explicit configuration validation. Do not remove database claims manually merely because a provisioning request partially failed.

## 10. Sending pipeline and immutable authority

UI editing/preflight/publish creates an immutable EmailVersion or test snapshot. createMessageIntent hashes workspace/source/profile/version/sequence into a unique business key. Flow email nodes use PrismaPhase2FlowMessagePort to create the same Message plus an outbox event transactionally, not a second SES path.

Phase2Service evaluates cancellation/exits, holds, invalid profile, suppression, consent, sender, provider, feedback freshness, frequency, quiet hours and warming. Tests bypass selected marketing restrictions but retain hard safety gates. EmailRoutingService resolves version-aware sender domain and active route authority. V2 From must match the root; legacy compatibility uses stored old authority.

Rendering compiles/sanitizes structured content, resolves variables, includes compliance and signed unsubscribe headers/links, creates TrackingLink rows, and stores immutable MIME/artifact hashes through LocalObjectStore. The policy/route/capacity checks run again near submission. Capacity tracks provider-region/workspace/domain/route windows with quota headroom.

SesEmailProvider sends raw MIME using SendEmail, attaching message/fingerprint/workspace/domain/route tags and configuration set. Provider MessageId is stored on DeliveryAttempt and message becomes submitted, not delivered. Unknown outcomes are not safe to retry blindly; lookupSubmission currently returns unknown rather than an authoritative SES query. [Sending chapter](docs/cursor-handoff/07-EMAIL-SENDING-PIPELINE.md) explains queue and direct-test variants.

## 11. Sending and queue reliability blockers

Intent uniqueness does not guarantee exactly-once SES calls. createAttempt can return an existing created attempt, and submit checks submitted/unknown without an exclusive atomic pre-provider claim. Two submitters can call SES using one created attempt; a crash after SES accepts but before DB persistence creates another ambiguity. This is a P0 hardening task, not something sequential mock idempotency tests prove safe.

Installed BullMQ6.1.2 rejects colon-containing custom IDs unless they have exactly three segments. Current feedback IDs have two, legacy scheduled runtime IDs four, and Phase3 audience-transition IDs four. Other three-segment Phase1/Phase2/Phase3 jobs do not have this particular defect.

PrismaPhase3Repository claims due ScheduledAction rows without filtering actionType, and broad lease recovery can affect domain verification work. The local proof worker uses this repository too. Worker ownership must be partitioned before running mixed schedulers safely.

Delivery queue false permits inline nonproduction test-send dispatch, but generic POST /messages only persists an intent without fallback dispatch. Production test-send refuses missing queue. Supervise all required consumers rather than assuming dev:all covers them. Frequency and event-projection concurrency also need actual PostgreSQL/Redis tests.

## 12. Exact SNS endpoint and durable feedback

The exact handler is **POST /public/v1/provider/ses** in apps/public-api/src/real-server.ts. With the supplied host, the AWS SNS HTTPS subscription endpoint is **https://enjoyable-iphone-zeppelin.ngrok-free.dev/public/v1/provider/ses**. The tunnel must forward to public API4001, not private gateway4000. Source inspection confirms the path; live tunnel/subscription reachability was not tested.

The route requires the configured SNS topic and verifies its signature using packages/provider-email/src/ses/sns-verifier.ts, allowed HTTPS SNS certificate locations, canonical fields and RSA verification. It persists SubscriptionConfirmation control data before confirming an allowed SubscribeURL. Supported Notifications normalize delivery, bounce, complaint, reject and delay/DeliveryDelay. UnsubscribeConfirmation is currently acknowledged without persistence/reconciliation; SEND/RENDERING_FAILURE/open/click SNS types are not this collector's implemented outcomes.

Supported events are durably saved in InboxMessage before matched-event enqueue/acknowledgment, deduplicated by source/external SNS ID. Correlation uses stored DeliveryAttempt providerMessageId and Message workspace/route authority, never untrusted tags as tenant selection. Redis failure leaves a received matched inbox row for retry.

Early feedback without a stored provider ID becomes unmatched and is not automatically re-correlated. Feedback queue IDs currently fail BullMQ validation, and default orchestration omits its consumer/retry scheduler. Preserve durable receipt while fixing dispatch, recovery and concurrency. [Feedback chapter](docs/cursor-handoff/08-FEEDBACK-SNS-SUPPRESSION.md) details exact limits.

## 13. Suppression, unsubscribe and tracking

real-feedback.ts transactionally records DeliveryEvent, projects message state, creates protected suppression, cancels presubmit work, and marks inbox processed with trace. Complaint is terminal/protected; permanent bounce creates delivery-scope protection; soft bounce/delay is not an automatic permanent blocker. Global suppression means within the workspace/profile, not across all customers. Read-before-transaction state projection still needs locking/CAS tests for concurrent outcomes.

Unsubscribe uses GET /public/v1/unsubscribe?token=... to display confirmation and POST to perform the signed change. GET must not unsubscribe scanners. The transactional handler appends consent withdrawal, creates protected global_unsubscribe, cancels pending messages and records inbox/trace. SubscriptionState projection is not updated by that path and may display stale status; protected suppression still blocks sends.

Click tracking uses GET /t/c/:token, HMAC validation, a stored TrackingLink HTTPS destination, scanner classification and302/no-store redirect. Tokens are signed, readable—not encrypted. Open-tracking flags/fields exist but no pixel injection/collector was found.

Platform tracking uses the public base URL without proving customer-host TLS. The CloudFront SaaS adapter implements tenant lookup/create, managed certificate requests, connection-group routing endpoint, DNS records, HTTPS probe and removal. Shared distribution/group creation is external and IDs are empty locally. Probe200–499 acceptance and missing-adapter readiness need hardening. See [tracking](docs/cursor-handoff/09-TRACKING.md).

## 14. Audience, content and automation modules

Profiles support identifiers, typed custom properties, location/locale/timezone, merge, consent and eligibility. Lists preserve membership provenance and never grant permission. Imports stage upload/mapping/validation/commit/change tracking/rollback. Native mapping is email, names, locale/timezone, country/region/city and defined properties; phone/tags/company/segment/created_at columns are not native contract fields. CSV parsing is line-oriented/buffered, so multiline quoted cells and large-upload memory are gaps. Exports use object files and expiring token hashes.

Segments use a typed rule AST compiled to parameterized SQL, immutable SegmentVersion, freshness-aware evaluation and membership transitions. Generic events use versioned schemas and scoped API credentials. Queue/route defects affect operational completion even where storage and UI exist.

Content includes template approval/versioning/reuse, universal blocks, media URL metadata, variables and brand kit. Structured primitives include text, headings, images, buttons, columns, social and locked compliance footer. Some rich palette concepts are static compositions, not commerce/video/countdown integrations. “Create campaign” creates EmailDefinition, not a broadcast scheduler.

Flows use custom React/SVG canvas and Phase3 graph/runtime services. Triggers are list_joined, segment_entered, profile_date, generic_event, manual_test and unconfigured; nodes are delay, wait_until, conditional, email and end. Graphs are acyclic and capped100 nodes. Versions, dependencies, entry/cooldown, branch evidence, waits, exits, pause/resume and dead-letter replay exist. Runtime dispatch defects prevent production claims. Chapters10–12 give detailed continuation points.

## 15. Authentication, settings and security

Development identity accepts x-dev-user only outside production with its explicit flag. Local password auth is also nonproduction-only; scrypt credentials and random hashed session tokens support the current development login. OIDC RS256 issuer/audience/JWKS validation exists, but production browser login/refresh/account recovery integration is incomplete and issuer/audience env is absent locally.

Roles owner/admin/marketer/analyst and service permissions exist, yet platform actor authentication is not a universal workspace guard. GET home/search and export metadata omit membership authorization. Infrastructure/global governance access treats a workspace admin too broadly. These are P0 findings; Workspace B isolation cannot be certified. No attack on another user's data was executed during this audit.

Settings include workspace business fields, membership, sender identities, keys, audit, send policies and dangerous actions. Gateway dispatch breaks send-policy GET/PATCH and profile message/run panels; segment rule-registry is shadowed by generic detail. Duplicate APIs and legacy clients complicate auth. Repair these through gateway contract tests.

Root .env contains SECRET PRESENT / VALUES REDACTED. It is ignored but Git history is unavailable. Hard-coded local signing/pepper fallbacks exist; production should fail closed when missing. No AWS credentials should enter NEXT_PUBLIC env, logs, customer error detail or handoff content. Unknown Prisma/SDK errors currently can leak raw details. See [auth/tenancy](docs/cursor-handoff/14-SETTINGS-AUTH-AND-TENANCY.md).

## 16. Environment and external prerequisites

Current configuration is NODE_ENV development, runtime proof, SES provider/send/setup/tenant mapping enabled, Route53 enabled, delivery queue disabled, import/Phase3 queue flags absent, platform tracking and local/dev auth enabled. Therefore proof mode can perform real AWS actions. PostgreSQL and Redis URLs point locally; object storage is filesystem-based. Do not copy connection passwords or signing material.

AWS region, IAM credentials/default chain, delegation-set ID, underlying expected nameservers and vanity mappings are distinct concepts. Temporary credentials additionally require AWS_SESSION_TOKEN through the SDK chain. SES configuration sets and SNS destinations are workspace mappings, not isolated accounts. SES sandbox/production access, quotas and live credentials were not reverified.

SNS topic is set locally, but DB signature/subscription evidence is absent. Feedback endpoint gate is passed; tracking/unsubscribe gates are blocked. CloudFront distribution/group IDs are empty. Stored gates can be stale and do not replace real HTTPS/provider validation. Stable ingress, production OIDC, supervised workers, durable shared artifacts, Postgres backups and Redis recovery remain deployment work. [Environment inventory](docs/cursor-handoff/15-ENVIRONMENT-AND-INFRASTRUCTURE.md) documents every key, default, use and requirement without secrets.

## 17. Validation, legacy constraints and next milestone

npm test passed157/157, including root compilation. Frontend typecheck and Next production build passed. Lint is not configured. Tests predominantly use in-memory repositories, pure policies and SDK mocks; no live AWS resource changes, production load/restore, browser E2E or real Redis concurrency suite was run. Root tsconfig exclusions mean standalone runtime coverage needs explicit attention, although transitive imports can compile excluded files.

Do not delete all phase0-named code: real public feedback still depends on its queue/worker/scheduler components. V1 domains and legacy regional providers must remain compatible until a deliberate migration inventories identities, routes, drafts, versions, active attempts and DNS. Existing provider evidence/history survives disconnect. Historical completion documents and green governance labels are not production acceptance.

The next milestone is a secure, reliable single-domain end-to-end acceptance, not a redesign: fix tenant/admin guards; exclusive SES submission; scheduler ownership; invalid queue IDs; complete orchestration; gateway routes; feedback recovery/ordering; domain retry/readiness/ownership; production auth/secrets/errors; then controlled AWS DNS→SES→SNS→suppression→unsubscribe/click validation. Use approved synthetic data/test domains and record real evidence, never fabricated passed gates.

Read [known issues](docs/cursor-handoff/20-KNOWN-ISSUES-AND-TECH-DEBT.md), [validation](docs/cursor-handoff/21-TESTING-AND-VALIDATION.md), [ordered next plan](docs/cursor-handoff/22-NEXT-DEVELOPMENT-PLAN.md), and [legacy inventory](docs/cursor-handoff/19-LEGACY-AND-MIGRATIONS.md) before making broad changes.

