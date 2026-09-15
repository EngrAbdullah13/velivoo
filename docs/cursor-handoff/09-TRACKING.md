# Tracking

## Existing click path

`packages/domain/src/phase2/tracking.ts` signs expiring HMAC tokens containing routing identifiers, not an unrestricted destination URL. Rendering in `packages/application/src/phase2/phase2-service.ts` stores TrackingLink destinations and rewrites eligible links. Tokens are readable base64 payloads plus a signature, not encryption. Generated links use a 90-day expiry.

GET /t/c/:token in `apps/public-api/src/real-server.ts` validates the token, resolves the stored link within its workspace/message authority, accepts HTTPS destinations, records engagement.click TraceEvent and redirects with 302/no-store. A user-agent heuristic labels likely scanners; it is not reliable human verification. Unique-click analytics comes from persisted engagement traces, not SES open events.

## Modes and external resources

| Mode/capability | Status | Source and limitation |
|---|---|---|
| platform click redirects | PARTIAL | Real token, storage and redirect code; current endpoint gate blocked, live reachability not checked |
| PlatformTrackingDomainProvisioner | COMPLETE | Concrete platform-mode choice in cloudfront-saas-tracking-provider.ts; returns ready without customer DNS/TLS |
| cloudfront_saas provisioning | PARTIAL | Real CloudFront SDK tenant/certificate/DNS/probe code; external shared resources absent locally |
| Shared distribution and connection group | BLOCKED_EXTERNALLY | Env IDs empty; adapters consume resources, do not create this base infrastructure |
| standard_staging_fallback | LEGACY | Parsed compatibility mode, not proof of production branded tracking |
| Open pixel / image beacon | MISSING | No implemented route or render-time pixel injection found |
| Open enable flags/metrics schema | PARTIAL | Fields/UI concepts exist, not event collection |

`TRACKING_DOMAIN_MODE` defaults to platform outside production and cloudfront_saas in production. Prefix/origin configuration is parsed, but V2 derivation uses fixed click and TRACKING_ORIGIN_DOMAIN has no consuming behavior.

## CloudFront implementation

`packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.ts` checks the configured distribution with GetDistribution, looks up an existing tenant with GetDistributionTenantByDomain, and creates a stable SHA256-derived tenant name with CreateDistributionTenant. It supplies the connection group and requests a managed certificate with CloudFront token hosting.

It lists connection groups with pagination to obtain the RoutingEndpoint and returns AWS-provided validation records. The domain service writes returned managed records inside the delegated Route 53 zone. It waits for active tenant/domain status and probes HTTPS at /health/tracking. Removal disables and deletes the tenant using ETag.

No code was found creating the platform's shared multi-tenant distribution or connection group. DNS, certificate issuance, AWS permissions and origin routing remain external prerequisites; do not label the adapter absent merely because the IDs are empty.

## Readiness flaws and safe next work

The HTTPS probe accepts 200–499, so a 404 can look reachable. The domain service treats a missing tracking adapter as ready; absent CloudFront IDs can therefore become a silent platform-mode success instead of a strict configuration error. Platform mode itself does not mean click.send.customer.com has working TLS.

Preserve durable click links and signed-token validation. Repair explicit mode validation/probe semantics, configure the shared infrastructure separately, then test tenant provisioning, certificate readiness, HTTPS redirect, deletion retries and token tampering. Do not implement an open tracker merely by setting trackOpens=true; it needs an explicit privacy/retention and collection design.

