import { PrismaClient } from "@prisma/client";
import { DomainProvisioningService } from "../packages/application/src/phase1/domain-provisioning-service.js";
import { StaticBrandedProvisioner } from "../packages/application/src/phase1/static-branded-provisioner.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";
import { staticBrandedZoneApex } from "../packages/domain/src/phase1/static-branded-dns.js";
import { PrismaPhase1Repository } from "../packages/persistence/src/prisma/phase1-repository.js";
import { PlatformTrackingDomainProvisioner } from "../packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.js";
import { Route53DnsProvider } from "../packages/provider-email/src/route53/route53-dns-provider.js";
import {
  InMemoryStaticDnsInfrastructure,
  Route53StaticDnsInfrastructure,
} from "../packages/provider-email/src/route53/route53-static-dns-infrastructure.js";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.js";

const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const domainId = process.argv[3] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";

const db = new PrismaClient();
const config = loadEmailPlatformConfig();
const repo = new PrismaPhase1Repository(db);
const dns =
  config.dnsProvider === "route53" && config.route53DnsEnabled
    ? new Route53DnsProvider(undefined, config.route53VanityNsMapping, undefined, config.route53BrandedNsDomain)
    : undefined;
const email =
  config.emailProvider === "ses" && config.sesDomainSetupEnabled && config.awsSesRegion
    ? new SesEmailDomainProvider(config.awsSesRegion)
    : undefined;
const tracking = new PlatformTrackingDomainProvisioner(
  process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001",
);
const staticDnsDomain = config.velivooStaticDnsDomain;
const staticSendDnsDomain =
  config.velivooStaticSendDnsDomain ?? (staticDnsDomain ? `send.${staticBrandedZoneApex(staticDnsDomain)}` : undefined);
const staticSendDnsZoneId = config.velivooStaticSendDnsZoneId ?? config.velivooStaticDnsZoneId;
const staticSendRoutingTarget =
  config.velivooStaticSendRoutingTarget ??
  config.trackingOriginDomain ??
  new URL(process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001").host;
const staticDnsInfra =
  staticDnsDomain && config.velivooStaticDnsZoneId && staticSendDnsDomain && staticSendDnsZoneId && dns
    ? new Route53StaticDnsInfrastructure(
        dns,
        config.velivooStaticDnsZoneId,
        staticDnsDomain,
        staticSendDnsZoneId,
        staticSendDnsDomain,
        staticSendRoutingTarget,
      )
    : staticDnsDomain && staticSendDnsDomain && config.staticBrandedDnsEnabled
      ? new InMemoryStaticDnsInfrastructure(staticDnsDomain, staticSendDnsDomain, staticSendRoutingTarget)
      : undefined;
const staticBrandedProvisioner =
  config.staticBrandedDnsEnabled && staticDnsInfra && email && dns && staticDnsDomain && staticSendDnsDomain
    ? new StaticBrandedProvisioner(repo, dns, staticDnsInfra, email, {
        sesRegion: config.awsSesRegion ?? "",
        staticDnsDomain,
        staticSendDnsDomain,
        sendRoutingTarget: staticSendRoutingTarget,
        dmarcPolicy: config.dmarcPolicy,
        dmarcRequired: config.dmarcRequired,
        dkimKeyEncryptionSecret:
          config.velivooDkimKeyEncryptionSecret ??
          process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET ??
          "local-static-dkim-secret-change-me",
        snsTopicArn: process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN?.trim() || undefined,
      })
    : undefined;
const provisioner = new DomainProvisioningService(repo, dns, email, tracking, {
  sendingPrefix: config.sendingDomainPrefix,
  mailFromPrefix: config.sesMailFromPrefix,
  trackingPrefix: config.trackingDomainPrefix,
  sesRegion: config.awsSesRegion ?? "",
  delegationSetReference: config.route53DelegationSetId,
  brandedNameserverDomain: config.route53BrandedNsDomain,
  vanityNameservers: config.route53VanityNsMapping.length
    ? config.route53VanityNsMapping.map((item) => item.vanity)
    : config.route53ExpectedNameservers,
  snsTopicArn: process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN?.trim() || undefined,
  dmarcPolicy: config.dmarcPolicy,
  dmarcRequired: config.dmarcRequired,
}, staticBrandedProvisioner);

const result = await provisioner.recheck(ws, domainId);
console.log(
  JSON.stringify(
    {
      domainId,
      lifecycleState: result.lifecycleState,
      authenticationStatus: result.authenticationStatus,
      readinessStatus: result.readinessStatus,
      readinessReasons: result.readinessReasons,
    },
    null,
    2,
  ),
);

await db.$disconnect();
