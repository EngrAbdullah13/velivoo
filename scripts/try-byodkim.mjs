import { PrismaClient } from "@prisma/client";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.js";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const domainName = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const d = await prisma.senderDomain.findFirst({ where: { domain: domainName } });
  if (!d) throw new Error("DOMAIN_NOT_FOUND");

  const rotation = new StaticDkimRotationService(cfg.velivooDkimKeyEncryptionSecret ?? "");
  const keys = rotation.readKeys(d);
  const privateKey = rotation.activePrivateKey(d);
  const ses = new SesEmailDomainProvider(cfg.awsSesRegion ?? "");

  console.log("Attempting BYODKIM create for", domainName, "selector", keys.activeSelector);
  try {
    const result = await ses.ensureByodkimIdentity({
      domain: domainName,
      selector: keys.activeSelector,
      privateKeyPem: privateKey,
      existingReference: d.providerReference,
      workspaceId: d.workspaceId,
      senderDomainId: d.id,
    });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : String(error));
    if (error && typeof error === "object") {
      console.error("AWS name:", (error).name);
      console.error("AWS message:", (error).message);
      console.error("HTTP:", (error).$metadata?.httpStatusCode);
    }
  }
} finally {
  await prisma.$disconnect();
}
