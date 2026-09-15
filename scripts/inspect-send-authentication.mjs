import { PrismaClient } from "@prisma/client";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";

const rootDomain = process.argv[2] ?? "lahorixsolutions.com";
const senderEmail = process.argv[3] ?? `engr@${rootDomain}`;
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const domain = await prisma.senderDomain.findFirst({ where: { OR: [{ domain: rootDomain }, { rootDomain }] } });
  if (!domain) {
    console.log(JSON.stringify({ error: "DOMAIN_NOT_FOUND", rootDomain }, null, 2));
    process.exit(1);
  }

  const route = await prisma.emailDeliveryRoute.findFirst({
    where: { workspaceId: domain.workspaceId, senderDomainId: domain.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  const identity = await prisma.senderIdentity.findFirst({
    where: { workspaceId: domain.workspaceId, domainId: domain.id, fromEmail: senderEmail },
  });
  const latestMessage = await prisma.message.findFirst({
    where: {
      workspaceId: domain.workspaceId,
      state: { in: ["submitted", "delivered", "unknown"] },
    },
    orderBy: { submittedAt: "desc" },
  });
  const latestAttempt = latestMessage
    ? await prisma.deliveryAttempt.findFirst({
        where: { messageId: latestMessage.id },
        orderBy: { attemptNumber: "desc" },
      })
    : null;
  const latestTraces = latestMessage
    ? await prisma.traceEvent.findMany({
        where: {
          aggregateType: "message",
          aggregateId: latestMessage.id,
          kind: { in: ["provider.submitted", "message.rendered"] },
        },
        orderBy: { occurredAt: "desc" },
        take: 4,
      })
    : [];

  const report = {
    config: {
      awsSesRegion: cfg.awsSesRegion ?? null,
      sesSupportedRegions: cfg.sesSupportedRegions ?? [],
      emailSendEnabled: cfg.emailSendEnabled,
    },
    senderDomain: {
      id: domain.id,
      rootDomain: domain.rootDomain ?? domain.domain,
      providerReference: domain.providerReference,
      providerRegion: domain.providerRegion,
      dkimSigningMode: domain.dkimSigningMode,
      dkimSelector: domain.dkimSelector,
      dkimStatus: domain.dkimStatus,
      mailFromStatus: domain.mailFromStatus,
      mailFromDomain: domain.mailFromDomain,
      authenticationStatus: domain.authenticationStatus,
      readinessStatus: domain.readinessStatus,
      readinessReasons: domain.readinessReasons,
    },
    deliveryRoute: route
      ? {
          id: route.id,
          status: route.status,
          providerRegion: route.providerRegion,
          providerIdentityReference: route.providerIdentityReference,
          mailFromDomain: route.mailFromDomain,
          configurationSetName: route.configurationSetName,
          holdReason: route.holdReason,
        }
      : null,
    senderIdentity: identity
      ? { id: identity.id, fromEmail: identity.fromEmail, status: identity.status }
      : null,
    latestSend: latestMessage
      ? {
          id: latestMessage.id,
          state: latestMessage.state,
          submittedAt: latestMessage.submittedAt,
          attempt: latestAttempt,
          traces: latestTraces,
        }
      : null,
    ses: {},
  };

  if (!cfg.awsSesRegion) {
    report.ses = { error: "SES_REGION_NOT_CONFIGURED" };
  } else {
    const ses = new SesEmailDomainProvider(cfg.awsSesRegion);
    const identitiesToInspect = [...new Set([rootDomain, domain.providerReference, senderEmail, `send.${rootDomain}`].filter(Boolean))];
    report.ses.region = cfg.awsSesRegion;
    report.ses.identities = {};
    for (const name of identitiesToInspect) {
      try {
        const inspected = await ses.inspectIdentity(name);
        report.ses.identities[name] = {
          verificationStatus: inspected.state.verificationStatus,
          verifiedForSending: inspected.state.verifiedForSending,
          dkimStatus: inspected.state.dkimStatus,
          dkimSigningOrigin: inspected.state.dkimSigningOrigin,
          dkimSigningSelector: inspected.state.dkimSigningSelector,
          mailFromStatus: inspected.state.mailFromStatus,
          mailFromDomain: inspected.state.mailFromDomain,
        };
      } catch (error) {
        report.ses.identities[name] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
