import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DomainProvisioningService } from "../../../packages/application/src/phase1/domain-provisioning-service.js";
import { StaticBrandedProvisioner } from "../../../packages/application/src/phase1/static-branded-provisioner.js";
import { loadEmailPlatformConfig } from "../../../packages/config/src/env.js";
import { staticBrandedZoneApex } from "../../../packages/domain/src/phase1/static-branded-dns.js";
import { PrismaPhase1Repository } from "../../../packages/persistence/src/prisma/phase1-repository.js";
import { CloudFrontSaasTrackingDomainProvisioner, PlatformTrackingDomainProvisioner } from "../../../packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.js";
import { Route53DnsProvider } from "../../../packages/provider-email/src/route53/route53-dns-provider.js";
import { Route53StaticDnsInfrastructure, InMemoryStaticDnsInfrastructure } from "../../../packages/provider-email/src/route53/route53-static-dns-infrastructure.js";
import { SesEmailDomainProvider } from "../../../packages/provider-email/src/ses/ses-email-domain-provider.js";

const db = new PrismaClient();
const config = loadEmailPlatformConfig();
const owner = `sender-domain-worker:${process.pid}:${randomUUID()}`;
const leaseMs = Number(process.env.EMAIL_PLATFORM_DOMAIN_VERIFICATION_LEASE_MS ?? "120000");
// Queue scan interval only. Verification runs when a scheduled action exists
// (provider webhook / explicit trigger), not on a fixed DNS poll loop.
const pollMs = Number(process.env.EMAIL_PLATFORM_DOMAIN_VERIFICATION_POLL_MS ?? "30000");

// Provider construction is deliberately capability based. A missing branded
// capability does not stop this worker (or any other process) from starting;
// only a claimed branded provisioning action receives the precise diagnostic.
const dns = config.dnsProvider === "route53" && config.route53DnsEnabled
  ? new Route53DnsProvider(undefined, config.route53VanityNsMapping, undefined, config.route53BrandedNsDomain)
  : undefined;
const email = config.emailProvider === "ses" && config.sesDomainSetupEnabled && config.awsSesRegion
  ? new SesEmailDomainProvider(config.awsSesRegion)
  : undefined;
const tracking = config.trackingDomainMode === "platform"
  ? new PlatformTrackingDomainProvisioner(process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001")
  : config.trackingDomainMode === "cloudfront_saas" && config.cloudFrontMultiTenantDistributionId
    ? new CloudFrontSaasTrackingDomainProvisioner({ distributionId: config.cloudFrontMultiTenantDistributionId, connectionGroupId: config.cloudFrontConnectionGroupId })
    : undefined;
const nameservers = config.route53VanityNsMapping.length
  ? config.route53VanityNsMapping.map((item) => item.vanity)
  : config.route53ExpectedNameservers;
const staticDnsDomain = config.velivooStaticDnsDomain;
const staticSendDnsDomain = config.velivooStaticSendDnsDomain ?? (staticDnsDomain ? `send.${staticBrandedZoneApex(staticDnsDomain)}` : undefined);
const staticSendDnsZoneId = config.velivooStaticSendDnsZoneId ?? config.velivooStaticDnsZoneId;
const staticSendRoutingTarget = config.velivooStaticSendRoutingTarget ?? config.trackingOriginDomain ?? new URL(process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001").host;
const staticDnsInfra = staticDnsDomain && config.velivooStaticDnsZoneId && staticSendDnsDomain && staticSendDnsZoneId && dns
  ? new Route53StaticDnsInfrastructure(dns, config.velivooStaticDnsZoneId, staticDnsDomain, staticSendDnsZoneId, staticSendDnsDomain, staticSendRoutingTarget)
  : staticDnsDomain && staticSendDnsDomain && config.staticBrandedDnsEnabled
    ? new InMemoryStaticDnsInfrastructure(staticDnsDomain, staticSendDnsDomain, staticSendRoutingTarget)
    : undefined;
const staticBrandedProvisioner = config.staticBrandedDnsEnabled && staticDnsInfra && email && dns && staticDnsDomain && staticSendDnsDomain
  ? new StaticBrandedProvisioner(new PrismaPhase1Repository(db), dns, staticDnsInfra, email, {
    sesRegion: config.awsSesRegion ?? "",
    staticDnsDomain,
    staticSendDnsDomain,
    sendRoutingTarget: staticSendRoutingTarget,
    dmarcPolicy: config.dmarcPolicy,
    dmarcRequired: config.dmarcRequired,
    dkimKeyEncryptionSecret: config.velivooDkimKeyEncryptionSecret ?? process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET ?? "local-static-dkim-secret-change-me",
    snsTopicArn: process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN?.trim() || undefined,
  })
  : undefined;
const provisioner = new DomainProvisioningService(new PrismaPhase1Repository(db), dns, email, tracking, {
  sendingPrefix: config.sendingDomainPrefix,
  mailFromPrefix: config.sesMailFromPrefix,
  trackingPrefix: config.trackingDomainPrefix,
  sesRegion: config.awsSesRegion ?? "",
  delegationSetReference: config.route53DelegationSetId,
  brandedNameserverDomain: config.route53BrandedNsDomain,
  vanityNameservers: nameservers,
  snsTopicArn: process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN?.trim() || undefined,
  dmarcPolicy: config.dmarcPolicy,
  dmarcRequired: config.dmarcRequired,
}, staticBrandedProvisioner);

async function claimOne() {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; workspace_id: string; aggregate_id: string }>>`
      SELECT "id", "workspace_id", "aggregate_id"
      FROM "scheduled_action"
      WHERE "action_type" = 'sender_domain.verify'
        AND "due_at" <= ${now}
        AND ("state" = 'pending' OR ("state" = 'leased' AND "lease_expires_at" <= ${now}))
      ORDER BY "due_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const action = rows[0];
    if (!action) return null;
    const claimed = await tx.scheduledAction.updateMany({
      where: { id: action.id, actionType: "sender_domain.verify", OR: [{ state: "pending" }, { state: "leased", leaseExpiresAt: { lte: now } }] },
      data: { state: "leased", leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs), attemptCount: { increment: 1 } },
    });
    return claimed.count === 1 ? { id: action.id, workspaceId: action.workspace_id, domainId: action.aggregate_id } : null;
  });
}

async function processOne() {
  const action = await claimOne();
  if (!action) return false;
  try {
    await provisioner.recheck(action.workspaceId, action.domainId);
    await db.scheduledAction.updateMany({
      where: { deduplicationKey: `sender-domain.verify:${action.domainId}` },
      data: {
        state: "completed",
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return true;
  } catch (error) {
    const code = error instanceof Error ? (error.message.split(":")[0] ?? "DOMAIN_PROVISIONING_FAILED") : "DOMAIN_PROVISIONING_FAILED";
    await db.scheduledAction.updateMany({
      where: { id: action.id, leaseOwner: owner },
      data: {
        state: "completed",
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        payloadJson: { lastErrorCode: code },
      },
    });
    console.error(JSON.stringify({ event: "sender_domain.verify.failed", domainId: action.domainId, code }));
    return true;
  }
}

async function runOnce() {
  let processed = 0;
  while (processed < 100 && await processOne()) processed += 1;
  return processed;
}

async function shutdown() { await db.$disconnect(); process.exit(0); }
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown());

if (process.argv.includes("--once")) {
  const processed = await runOnce();
  console.log(JSON.stringify({ worker: "sender-domain-verification", processed }));
  await db.$disconnect();
} else {
  console.log(JSON.stringify({ worker: "sender-domain-verification", status: "running", brandedDns: Boolean(dns), brandedEmail: Boolean(email), trackingMode: tracking?.mode ?? "unavailable" }));
  await runOnce();
  setInterval(() => void runOnce().catch((error) => console.error(JSON.stringify({ event: "sender_domain.worker.failed", error: error instanceof Error ? error.message : String(error) }))), pollMs);
  await new Promise(() => {});
}
