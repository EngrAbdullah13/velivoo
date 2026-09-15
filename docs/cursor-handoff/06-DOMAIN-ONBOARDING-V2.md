# Domain onboarding V2

> Compatibility chapter: V2 remains active for existing rows, but new domain creation now uses `V3_ROOT_SENDER_DELEGATED_EASY_DKIM` with five customer records. See [Domain onboarding V3](23-DOMAIN-ONBOARDING-V3.md). Do not interpret the seven-record flow below as the current new-customer contract.

## Canonical addresses and discriminators

| Meaning | V2 value for customer.com | V1 compatibility |
|---|---|---|
| Customer root / SES identity / visible sender suffix | customer.com / user@customer.com | Identity and visible sender may be send.customer.com |
| Delegated infrastructure | send.customer.com | Legacy delegated sender domain |
| Custom MAIL FROM | bounce.send.customer.com | Consult stored mailFromDomain; do not recompute historical authority |
| Tracking | click.send.customer.com | Existing record/mode dependent |
| Root DMARC observation | _dmarc.customer.com | Do not replace customer policy |
| provisioningVersion | V2_ROOT_SENDER_DELEGATED_INFRA | V1_LEGACY_SEND_SUBDOMAIN |

`provisioningVersion` is separate from `provisioningMode` (branded_delegation versus legacy_ses_records). Prisma states are strings, not enums. New V2 uses Easy DKIM, not BYODKIM. No current BYODKIM implementation was found.

Primary sources: `packages/domain/src/phase1/branded-domain.ts`, `packages/application/src/phase1/domain-provisioning-service.ts`, `packages/persistence/src/prisma/phase1-repository.ts`, `packages/provider-email/src/route53/route53-dns-provider.ts`, `packages/provider-email/src/ses/ses-email-domain-provider.ts`, and `apps/worker/src/branded-domain-verification-worker.ts`.

## Input and ownership

The service normalizes a root domain with trimming, lowercasing, ASCII/punycode conversion, trailing-dot removal, and tldts public-suffix checks. A www prefix can normalize to root. Other subdomains, URLs, email addresses, IPs, internal/special names and invalid registrable domains are rejected. An existing active claim in another workspace blocks creation; the current one-domain-per-workspace rule also blocks a different active root. Retrying the same claimed root may return/reconcile that record.

The claim is persisted before external provisioning. Provisioning uses a DB compare-and-set lease with a 120-second owner lease and a stable CallerReference of sender-domain:<id>. There is also workspace/domain API rate limiting held in process memory: five create requests per minute per workspace and six rechecks per minute per domain. This is not a distributed rate limiter.

## Preparation: Route 53 then SES

1. Require configured DNS/email adapters, reusable delegation set, and four vanity nameserver mappings.
2. Ensure a child hosted zone for send.customer.com using the existing stored reference or lookup by name, otherwise CreateHostedZone with stable CallerReference and DelegationSetId.
3. Validate returned provider NS against configured expected NS and validate vanity-to-provider mappings. Each vanity host must use the configured brand suffix and resolve with an overlapping A/AAAA address set against its mapped AWS nameserver.
4. UPSERT the child-zone apex NS values to the four vanity names; the expected product names are ns1.velivoo.com through ns4.velivoo.com.
5. Rewrite only the SOA primary nameserver token. Preserve responsible mailbox, serial and timer values. The service does not replace the whole SOA with a fabricated template.
6. Ensure SES identity for the ROOT customer.com, not send.customer.com.
7. Read three Easy DKIM tokens and DkimAttributes.SigningHostedZone from SES; derive token._domainkey.customer.com → token.<SigningHostedZone>.
8. Persist DNS evidence and provider references, expose the customer-facing DNS records, and schedule verification.

Standard customer work is **four NS rows plus three DKIM CNAME rows**. NS belongs at the send subdomain in the customer's parent DNS provider. DKIM belongs under the root domain's _domainkey names. The customer does not manually manage the later MAIL FROM records inside the delegated zone.

### AWS API support actually present

| Route 53 call | Evidence/behavior |
|---|---|
| CreateHostedZone | Stable CallerReference and reusable DelegationSetId |
| GetHostedZone | Reconcile a stored zone |
| ListHostedZonesByName | Lookup existing same-name zone; max one result |
| ListResourceRecordSets | Paginated listing and reconciliation/cleanup |
| ChangeResourceRecordSets | UPSERT NS/SOA/managed records; DELETE owned records |
| DeleteHostedZone | Disconnect after safe owned-record cleanup |
| GetChange | MISSING: no INSYNC polling after changes |

Zone-by-name adoption does not establish platform ownership using resource tags. It needs hardening before production. DNS/API errors are translated, but retries are primarily job-level rather than an explicit GetChange waiter.

### SES integration

The V2 adapter uses CreateEmailIdentity, GetEmailIdentity, PutEmailIdentityMailFromAttributes, PutEmailIdentityConfigurationSetAttributes, DeleteEmailIdentity, GetAccount, and configuration-set/event-destination APIs. MAIL FROM sets behavior-on-MX-failure to REJECT_MESSAGE. Configuration sets and SNS destinations are workspace-scoped by naming/configuration; this is not a separate SES account per tenant.

Supported-region parsing exists. The legacy regional provider can select among configured regions. V2 service construction supplies a single configured region; persisted providerRegion alone does not prove every later operation is pinned correctly after configuration changes. Treat multi-region migration as unvalidated.

## Exact recheck behavior

The UI calls POST /api/v1/workspaces/:workspaceId/sender-domains/:domainId/recheck (verify is also accepted). BrandedDomainProvisioningService loads a nonarchived V2 record, acquires its lease, repairs incomplete preparation, and reads current SES DKIM information.

The PublicDnsResolver uses Node DNS Resolver with Cloudflare 1.1.1.1/1.0.0.1; diagnostics additionally use Google 8.8.8.8. Names are lowercased and trailing dots removed; NS compares normalized sets rather than order. CNAME checks the expected target; TXT chunks are joined. Public NS, SOA primary, all three root DKIM records, and root DMARC are checked. Errors distinguish pending/mismatch/NXDOMAIN/timeout/SERVFAIL. Resolver defaults supply timeouts; there is no explicit tuned request timeout. An evidence field labelled authoritative does not mean it directly queried authoritative servers: the implementation uses recursive resolvers.

SES verification requires VerificationStatus SUCCESS, VerifiedForSendingStatus true, and DKIM status SUCCESS. Public DNS alone is insufficient.

Once DNS and SES authentication pass, the service configures bounce.send.customer.com and automatically writes its MX (10 feedback-smtp.<region>.amazonses.com) and SPF TXT inside the child zone. It refreshes identity state and waits for SES MAIL FROM SUCCESS. DMARC is observed at the root; a required-DMARC policy can gate readiness, but the service does not silently publish/overwrite it.

The service ensures workspace configuration set/feedback destination and identity association, caches provider quotas for five minutes, provisions/checks tracking if configured, and derives readiness. A route becomes active only when authentication, tracking, feedback/unsubscribe evidence, business information, and operational holds permit it. Shared evidence currently relies on global Phase0GateEvidence keys, not fresh per-workspace signed delivery proof.

## Lifecycle mapping

| Expected concept | Actual lifecycleState / persistence | Frontend interpretation |
|---|---|---|
| DOMAIN_CREATED | DOMAIN_CREATED after claim | Setup started, not ready |
| AWS_RESOURCES_PREPARED | Assigned during preparation | Resources being prepared |
| AWAITING_CUSTOMER_DNS | Persisted after DNS instruction preparation | Show NS/DKIM instructions and recheck |
| DNS_DELEGATED | Computed intermediate after NS/SOA/DKIM evidence | Authentication progressing |
| SES_VERIFIED | Computed intermediate after SES/DKIM success | Authentication progressing |
| MAIL_FROM_CONFIGURING | Selected while MAIL FROM not successful | Pending infrastructure |
| MAIL_FROM_READY | Intermediate capability success | Sending authentication available |
| TRACKING_READY | Intermediate tracking success | Remaining operational gates may still block |
| READY | Final lifecycle when required gates succeed | Ready |
| Failure / removal | Diagnostic error/readiness hold, archivedAt and disconnectStatus | Actionable message or removed from active list |

Several intermediate names are declared/assigned inside a recheck rather than individually committed durable transitions; do not promise a separate event/history row for each. Legacy lowercase statuses such as pending_dns and verified coexist with V2 lifecycle/readiness fields. The UI in `deliverability-console.tsx` primarily consumes the sanitized customer view and capability checks, not a strict single database enum.

Verification is scheduled initially in five minutes, generally every ten minutes while pending. Worker claims due sender_domain.verify actions with SKIP LOCKED and leases; poll defaults to five seconds and batch limit 100. Retryable errors include AWS_THROTTLED, DNS_DELEGATION_PENDING, DNS_TIMEOUT, DNS_SERVFAIL, SES_VERIFICATION_PENDING and MAIL_FROM_PENDING. Other failures set the domain lifecycle to failed; the worker catches the error and marks its leased ScheduledAction completed with lastErrorCode in the payload (not a failed queue item), requiring intervention/recheck. The worker avoids completing an action that the service just requeued. Phase3 currently has a separate unfiltered action-claim bug; see issues.

## Readiness caveats

A missing tracking adapter is treated as ready by the service (!this.tracking), even if CloudFront mode was requested but its IDs were absent. Platform tracking readiness also means the platform URL mode, not verified customer-hostname TLS. Configuration-set presence plus global evidence is not proof of current per-domain feedback delivery. A probe accepting a non-5xx URL response can overstate health. These are code gaps, separate from absent infrastructure.

## API/UI and diagnostics

GET sender-domains returns current setup; POST creates; GET sender-domains/:id returns detail; POST /verify or /recheck runs validation; DELETE /:id requires the removal confirmation flow. Transfer request/approval endpoints exist in platform-api but no complete transfer UI was found.

Customer errors include DOMAIN_ALREADY_CLAIMED, WORKSPACE_SENDING_DOMAIN_EXISTS, DOMAIN_LEGACY_RECHECK_REQUIRED, DNS_DELEGATION_PENDING, DKIM_RECORDS_PENDING, SES_VERIFICATION_PENDING, MAIL_FROM_PENDING, AWS_ACCESS_DENIED, AWS_THROTTLED and provider-unavailable mappings. Exact route error handling is in platform-api publicErrorMessage/status. Not every raw SDK/Prisma exception is sanitized. Do not expose tokens, ARNs, zone references or account IDs as normal customer content.

The Add Domain UI clears the input only when the asynchronous action returns success. This prevents the historical “input vanished but nothing happened” behavior. Failed provisioning can still leave a persisted domain claim: preserve and reconcile it rather than blindly deleting DB rows.

## Disconnect and recreate

Disconnect holds the route and checks active/unknown delivery attempts, removes the tracking tenant when present, deletes the matching SES identity (root for V2), removes managed child-zone records and then the child zone, and removes sender identities/reset draft references. Domain and route rows are archived with disconnect status; evidence, published snapshots, audit and delivery history remain. “Remove everywhere” does not mean deleting shared reusable delegation sets, shared configuration sets, unrelated DNS or immutable history.

Cleanup refuses a zone containing unmanaged records. The missing-zone retry path is incomplete: a zone successfully deleted before a later persistence failure can cause the next list-records operation to fail. Recreating an archived same-root record can reuse stale external references/evidence; this deserves explicit regression tests. Do not call this fully idempotent until tested across each failure boundary.

## Transfer and migration

Transfer request requires source domains.manage and a real target workspace; approval requires target domains.manage, a free target slot and no active sender identities. Route/DNS ownership moves, provider configuration is cleared, jobs are cancelled, and DNS/readiness must be re-established. The stored challenge hash is not a complete implemented DNS challenge flow; background scheduling, in-flight/history authority, and region transitions need validation.

Do not convert V1 data by only changing provisioningVersion. Root identity, DKIM placement, sender addresses, MAIL FROM, tracking, route authority, published snapshots and dependencies must be reconciled. Existing V1 sends may depend on send.<root>; preserve their pinned records. See [legacy inventory](19-LEGACY-AND-MIGRATIONS.md).
