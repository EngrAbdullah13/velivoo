import { PrismaClient } from "@prisma/client";
import { SesEmailProvider } from "../packages/provider-email/src/ses/ses-provider.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";

const rootDomain = process.argv[2] ?? "lahorixsolutions.com";
const toEmail = process.argv[3];
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

function buildMime({ fromEmail, to, subject, text }) {
  const boundary = `velivoo-${Date.now()}`;
  return [
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

try {
  if (!toEmail) {
    console.log(JSON.stringify({ error: "USAGE", message: "node --env-file=.env --import tsx scripts/send-auth-test-email.mjs <root> <toEmail>" }, null, 2));
    process.exit(1);
  }
  if (!cfg.awsSesRegion) {
    console.log(JSON.stringify({ error: "SES_REGION_NOT_CONFIGURED" }, null, 2));
    process.exit(1);
  }

  const domain = await prisma.senderDomain.findFirst({ where: { OR: [{ domain: rootDomain }, { rootDomain }] } });
  if (!domain) {
    console.log(JSON.stringify({ error: "DOMAIN_NOT_FOUND", rootDomain }, null, 2));
    process.exit(1);
  }

  const identity = await prisma.senderIdentity.findFirst({
    where: { workspaceId: domain.workspaceId, domainId: domain.id, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  const route = await prisma.emailDeliveryRoute.findFirst({
    where: { workspaceId: domain.workspaceId, senderDomainId: domain.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  const fromEmail = identity?.fromEmail ?? `engr@${rootDomain}`;
  const rawMime = buildMime({
    fromEmail,
    to: toEmail,
    subject: `[Velivoo auth test] ${new Date().toISOString()}`,
    text: "Authentication test. Inspect raw headers for DKIM-Signature d=, SPF, DMARC, and Return-Path.",
  });

  const provider = new SesEmailProvider(cfg.awsSesRegion, route?.configurationSetName ?? undefined, cfg.sesSupportedRegions);
  const result = await provider.submit({
    messageId: crypto.randomUUID(),
    requestFingerprint: crypto.randomUUID(),
    workspaceId: domain.workspaceId,
    senderDomainId: domain.id,
    routeId: route?.id,
    providerRegion: route?.providerRegion ?? domain.providerRegion ?? cfg.awsSesRegion,
    configurationSetName: route?.configurationSetName ?? undefined,
    rawMime,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.status === "submitted",
        fromEmail,
        toEmail,
        region: route?.providerRegion ?? domain.providerRegion ?? cfg.awsSesRegion,
        providerIdentityReference: route?.providerIdentityReference ?? domain.providerReference,
        mailFromDomain: route?.mailFromDomain ?? domain.mailFromDomain,
        providerMessageId: result.providerMessageId ?? null,
        result,
      },
      null,
      2,
    ),
  );
  if (result.status !== "submitted") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
