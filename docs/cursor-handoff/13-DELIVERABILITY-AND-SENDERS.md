# Deliverability, sender identities and readiness

## UI and backend

DeliverabilityConsole and DeliverabilitySetup consume platform-api's deliverability-dashboard.ts and infrastructure-readiness.ts. Views include overview, domains, domain detail, setup, suppressions, bounces/complaints diagnostics, holds, and infrastructure. Bounces and complaints routes share the diagnostics view. The sidebar label Transactional leads here; it is not proof of a separate transactional product.

The dashboard reads domains/routes, attempts/events, suppression, holds, feedback freshness and quotas. Healthy is a computed presentation state, not a live external certification. Infrastructure cards include configuration/evidence probes and must distinguish configured, pending, blocked and verified.

## Sender identity

SenderIdentity stores workspaceId, senderDomainId, From name/email/local-part metadata, Reply-To and state. Phase1Service create/update identity validates its workspace, domain and email. V2 uses localPart@rootDomain; V1 uses the stored legacy delegated sender suffix. The UI is sender-identity-manager.tsx and SettingsConsole's sender-identities view.

Sender identities are consumed by EmailDefinition drafts and snapshot into immutable email versions; flow messages use pinned published content. Backend routing—not only a disabled button—must enforce readiness. Inactive/wrong-domain identities cannot become production send authority merely because their address has a verified suffix elsewhere.

Removing a domain now removes associated sender identities and clears draft references while preserving published message evidence. External cleanup and archive behavior are documented in chapter 06. Do not delete historical versions to make removal easier.

## Suppression and holds

Suppression reasons/scope/protection matter. Complaint and unsubscribe are protected global-within-workspace blockers. Permanent bounce is a protected delivery blocker. Soft bounce/delay does not automatically become permanent suppression. OperationalHold can stop a workspace/domain/route path; Message policy checks holds and suppression again near SES submission.

Controls to release ordinary holds/suppressions must preserve protected reasons and permissions. Frequency/quiet-hour/warming policies are distinct from provider daily/per-second quota limits. No UI badge overrides those backend gates.

## Readiness sources and weaknesses

WorkspaceOperationalReadiness requires legalName and businessAddress, active provider configuration set, real SNS signature/subscription/feedback endpoint evidence, real unsubscribe evidence, and no active holds. Domain readiness also depends on DNS/SES/MAIL FROM/tracking. Current gate rows are global and can become stale; a new domain is not independently proven by a historic row.

The local DB contains real.feedback.endpoint=passed and tracking/unsubscribe endpoint=blocked, with no real.sns.signature/subscription records. Current CloudFront base IDs are empty. Real API credentials/IAM/DNS/TLS/SES sandbox were not tested during this audit.

Analytics and deliverability have database-backed calculations, but some labels and formulas should be checked for ambiguous denominators. Submitted means accepted by provider, not delivered. Provider live-health/latency fields that return unknown must stay visibly unknown.

## Priorities

Preserve the current domain/sender system. Fix endpoint probes/mode validation, tenant authorization of infrastructure screens, feedback processing and stale evidence semantics. Then run controlled provider validation and update evidence from real observations. Do not “fix readiness” by writing passed gate rows manually.

