# Branded sending-domain operations

## Customer flow

New domain onboarding accepts a root domain only. `hollapic.com` becomes the dedicated sending zone `send.hollapic.com`. The customer is shown exactly four configured vanity NS records plus the ownership TXT record and delegates `send.customer.com` at their existing DNS provider. They never receive AWS credentials, hosted-zone identifiers, SES DKIM values, SNS details, or a region selector.

`POST /api/v1/workspaces/:workspaceId/sender-domains` creates or recovers the durable domain row and controlled Route 53 zone. `POST /api/v1/workspaces/:workspaceId/sender-domains/:domainId/recheck` and the durable verification worker run the same idempotent ensure pipeline. Frontend state cannot mark DNS or provider readiness as verified.

Existing domains are backfilled as `legacy_ses_records`. Their current SES identities and sender addresses continue to work. Missing branded infrastructure affects only creation/recheck of `branded_delegation` domains; API and worker startup, legacy delivery, and unrelated features remain available.

## Provider boundaries

- `DnsProvider` owns hosted zones, record UPSERT, public delegation evidence, white-label NS/SOA enforcement, and safe cleanup. `Route53DnsProvider` is the first implementation.
- `EmailDomainProvider` owns identity, Easy DKIM, custom MAIL FROM, account quota, and exactly one Configuration Set per workspace. `SesEmailDomainProvider` is the first implementation.
- `TrackingDomainProvisioner` owns tracking hostname, certificate/domain validation, edge tenant, routing endpoint, DNS and real HTTPS evidence. `CloudFrontSaasTrackingDomainProvisioner` uses one platform multi-tenant distribution and one distribution tenant per branded hostname.
- `DomainProvisioningService` coordinates the providers and persists provider-neutral lifecycle, evidence, route, error, and readiness state.
- `EmailRoutingService` resolves sender → domain → route immediately before policy/render/submission. AWS tags are supplemental diagnostics; feedback tenant authority is the persisted provider message ID → delivery attempt → message → route → workspace chain.

## Provisioning lifecycle

The lifecycle progresses through `created`, `infrastructure_provisioning`, `awaiting_customer_dns`, `delegation_verified`, `provider_provisioning`, `authentication_verifying`, and `ready`/`warning`. `failed`, `held`, and `archived` are explicit terminal/operational states. Pending and blocked states retain machine-readable reason codes in `readiness_reasons_json` and provider failures in `last_error_code`.

After public NS delegation matches the four configured vanity nameservers, recheck:

1. Ensures the workspace SES Configuration Set and its SNS feedback destination.
2. Captures an SES quota snapshot and applies conservative route capacity limits.
3. Ensures the SES identity for the delegated sending subdomain.
4. Publishes SES Easy DKIM records inside the controlled zone.
5. Configures `bounce.send.<domain>` and publishes its MX/SPF records internally.
6. Preserves an existing valid `_dmarc.send.<domain>` policy or creates the configured safe policy (`v=DMARC1; p=none` by default).
7. Ensures the CloudFront distribution tenant for `click.send.<domain>`.
8. Publishes only validation records actually returned by AWS. It never derives `_cf-challenge`. When CloudFront's new-domain workflow uses the connection-group routing endpoint, it publishes that hostname CNAME instead.
9. Requires an actual HTTPS request to the exact custom hostname and certificate before custom tracking is ready.
10. Activates or holds the delivery route and evaluates authentication and operational readiness.

DNS evidence is durable. Customer-actionable delegation records are separated from platform-managed DKIM, MAIL FROM, DMARC, certificate, and tracking evidence.

## Configuration

Server processes load and explicitly parse:

```text
DNS_PROVIDER=route53
ROUTE53_DNS_ENABLED=true
ROUTE53_BRANDED_NS_DOMAIN=ourplatformmail.com
ROUTE53_DELEGATION_SET_ID=...
ROUTE53_EXPECTED_NAME_SERVERS=ns1.ourplatformmail.com,...
ROUTE53_VANITY_NS_MAPPING=ns1.ourplatformmail.com=ns-123.awsdns-45.net,...
SENDING_DOMAIN_PREFIX=send

EMAIL_PROVIDER=ses
EMAIL_PLATFORM_SES_DOMAIN_SETUP_ENABLED=true
AWS_REGION=us-east-1
AWS_SES_REGION=us-east-1
SES_DEFAULT_MAIL_FROM_PREFIX=bounce
EMAIL_PLATFORM_SNS_TOPIC_ARN=arn:aws:sns:...

TRACKING_DOMAIN_MODE=cloudfront_saas
TRACKING_DOMAIN_PREFIX=click
CLOUDFRONT_MULTI_TENANT_DISTRIBUTION_ID=...
CLOUDFRONT_CONNECTION_GROUP_ID=...
TRACKING_ORIGIN_DOMAIN=tracking.example.com
EMAIL_PLATFORM_PUBLIC_BASE_URL=https://public.example.com

MANAGED_DMARC_POLICY=v=DMARC1; p=none
MANAGED_DMARC_REQUIRED=false
```

`ROUTE53_VANITY_NS_MAPPING` may be JSON or comma-separated `vanity=provider` pairs. The four vanity hostnames are the customer-facing records and are authoritative when mappings are configured. Never put AWS credentials in web environment variables. Local development may use backend-only access keys; deployed services should use the AWS credential provider chain and an IAM role.

`TRACKING_DOMAIN_MODE=platform` deliberately uses the existing global HTTPS tracking host and marks custom tracking `not_applicable`. Production defaults to `cloudfront_saas`. `standard_staging_fallback` is reserved for a bounded staging adapter and is not silently substituted for the SaaS architecture.

## Manual platform-owner prerequisites

Application code validates but cannot fabricate:

- A Route 53 reusable delegation set.
- The `ourplatformmail.com` parent zone, four vanity A/AAAA mappings to the reusable delegation-set infrastructure, and registrar glue records.
- IAM permissions for the required Route 53, SES v2, CloudFront multi-tenant distribution tenant, connection group, certificate workflow, SNS, and account quota APIs.
- One configured platform CloudFront multi-tenant tracking distribution and connection group whose origin is the public tracking service.
- A production SNS topic and topic policy that permits SES publication.
- Public HTTPS feedback, unsubscribe, tracking-origin, and tracking-health endpoints.
- The API probes `/health/unsubscribe` through the configured public HTTPS base URL and persists the result as infrastructure evidence. The endpoint is healthy only when an explicit 32-byte-or-longer unsubscribe signing secret is configured; localhost and plain HTTP never qualify as production readiness.
- Feedback readiness requires the workspace SES Configuration Set plus durably verified SNS signature and subscription-confirmation evidence. A UI flag or a manually edited domain status is never accepted as proof.
- SES production access and adequate quota in the configured region.

The vanity mapping must resolve to the same infrastructure as the reusable delegation set. Route 53 provider names are never substituted into customer output.

## Feedback safety

The configured per-workspace SES Configuration Set publishes Send, RenderingFailure, Reject, Delivery, DeliveryDelay, Bounce, and Complaint events to SNS. The public endpoint verifies the SNS signature, allowed certificate/confirmation host, message type, and expected topic. It durably inserts or deduplicates `InboxMessage` before returning success or attempting asynchronous dispatch. Subscription confirmation is persisted before following the validated confirmation URL.

Correlation uses `providerMessageId` on `DeliveryAttempt`; then the persisted `Message`, optional `EmailDeliveryRoute`, and workspace IDs must agree. SES tags never authorize or select a tenant. Redis is dispatch only; reconciliation redispatches durable `received` inbox rows.

## Local and staging verification

1. Apply migrations with `npm run db:migrate` and generate the Prisma client with `npm run db:generate` while no running process holds the Windows query engine DLL.
2. Run `npm run dev:all`. The API, web app, and durable branded-domain verification worker start even when branded capabilities are unavailable.
3. With no branded infrastructure configured, verify legacy pages/delivery still work and new domain creation returns `DNS_PROVIDER_NOT_CONFIGURED`.
4. In staging, configure the real reusable delegation set, vanity/glue records, IAM role, SES/SNS, public services, and CloudFront multi-tenant distribution.
5. Add a real root domain, copy the returned vanity NS records to its external DNS provider, and use Recheck DNS.
6. Confirm provider-managed evidence and lifecycle transitions in PostgreSQL; do not edit readiness fields.
7. Confirm `https://click.send.<domain>/health/tracking` succeeds with the correct hostname certificate before readiness is `ready`.
8. Create the sender using a local part and the fixed delegated-domain suffix, publish content, and test the canonical policy route before a controlled production send.

## Failure and recovery

Provisioning is ensure-style and repeatable. Recheck recovers a missing hosted-zone reference, Configuration Set destination, SES identity, DKIM/MAIL FROM records, DMARC policy, tracking tenant, routing record, or readiness evidence. DNS propagation remains pending rather than failed. Authentication, access-denied, invalid vanity mapping, and provider request failures remain distinct diagnostics.

The worker leases only `sender_domain.verify` rows with PostgreSQL `FOR UPDATE SKIP LOCKED`. Pending evidence reschedules the same deduplicated action. Missing configuration/auth/access failures are recorded and completed without a hot retry loop; an operator fix followed by manual Recheck resumes the ensure pipeline.
