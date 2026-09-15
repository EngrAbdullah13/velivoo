import { PrismaClient } from "@prisma/client";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const domainName = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const d = await prisma.senderDomain.findFirst({ where: { domain: domainName } });
  console.log("DB:", JSON.stringify({
    id: d?.id,
    providerReference: d?.providerReference,
    providerStatus: d?.providerStatus,
    verificationStatus: d?.verificationStatus,
    dkimStatus: d?.dkimStatus,
    lifecycleState: d?.lifecycleState,
    lastErrorCode: d?.lastErrorCode,
    lastErrorMessage: d?.lastErrorMessage,
    routingId: d?.routingId,
    dkimSelector: d?.dkimSelector,
  }, null, 2));

  if (!cfg.awsSesRegion) {
    console.log("SES region not configured");
    process.exit(0);
  }

  const ses = new SesEmailDomainProvider(cfg.awsSesRegion);
  try {
    const identity = await ses.getIdentity({ domain: domainName, reference: d?.providerReference ?? domainName });
    console.log("SES identity:", JSON.stringify(identity, null, 2));
  } catch (error) {
    console.log("SES lookup failed:", error instanceof Error ? error.message : String(error));
  }
} finally {
  await prisma.$disconnect();
}
