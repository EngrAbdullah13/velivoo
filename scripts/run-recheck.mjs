import { PrismaClient } from "@prisma/client";
import { PrismaPhase1Repository } from "../packages/persistence/src/prisma/phase1-repository.js";
import { StaticBrandedProvisioner } from "../packages/application/src/phase1/static-branded-provisioner.js";
import { Route53DnsProvider } from "../packages/provider-email/src/route53/route53-dns-provider.js";
import { Route53StaticDnsInfrastructure } from "../packages/provider-email/src/route53/route53-static-dns-infrastructure.js";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";
import { staticBrandedZoneApex } from "../packages/domain/src/phase1/static-branded-dns.js";

const workspaceId = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const domainId = process.argv[3] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";

const cfg = loadEmailPlatformConfig();
const prisma = new PrismaClient();
const repo = new PrismaPhase1Repository(prisma);
const dns = new Route53DnsProvider(undefined, cfg.route53VanityNsMapping, undefined, cfg.route53BrandedNsDomain);
const staticSendDnsDomain = cfg.velivooStaticSendDnsDomain ?? `send.${staticBrandedZoneApex(cfg.velivooStaticDnsDomain)}`;
const sendZone = cfg.velivooStaticSendDnsZoneId ?? cfg.velivooStaticDnsZoneId;
const sendTarget = cfg.velivooStaticSendRoutingTarget ?? new URL(process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001").host;
const staticDns = new Route53StaticDnsInfrastructure(dns, cfg.velivooStaticDnsZoneId, cfg.velivooStaticDnsDomain, sendZone, staticSendDnsDomain, sendTarget);
const email = new SesEmailDomainProvider(cfg.awsSesRegion);
const svc = new StaticBrandedProvisioner(repo, dns, staticDns, email, {
  sesRegion: cfg.awsSesRegion,
  staticDnsDomain: cfg.velivooStaticDnsDomain,
  staticSendDnsDomain,
  sendRoutingTarget: sendTarget,
  dmarcPolicy: cfg.dmarcPolicy,
  dmarcRequired: cfg.dmarcRequired,
  dkimKeyEncryptionSecret: cfg.velivooDkimKeyEncryptionSecret,
});

try {
  const result = await svc.recheck(workspaceId, domainId);
  console.log(JSON.stringify({
    lifecycleState: result.lifecycleState,
    readinessStatus: result.readinessStatus,
    readinessReasons: result.readinessReasons,
    verificationStatus: result.verificationStatus,
    dkimStatus: result.dkimStatus,
    lastCheckedAt: result.lastCheckedAt,
    customerRecords: result.customerRecords?.map(r => ({ purpose: r.purpose, status: r.status, name: r.name })),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
