import { PrismaClient } from "@prisma/client";
import { CreateEmailIdentityCommand, GetEmailIdentityCommand, PutEmailIdentityDkimSigningAttributesCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const domainName = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();
const region = cfg.awsSesRegion ?? "us-east-1";
const client = new SESv2Client({ region, maxAttempts: 3 });

function dump(error) {
  console.error(JSON.stringify({
    name: error?.name,
    message: error?.message,
    httpStatusCode: error?.$metadata?.httpStatusCode,
    requestId: error?.$metadata?.requestId,
  }, null, 2));
}

try {
  const d = await prisma.senderDomain.findFirst({ where: { domain: domainName } });
  if (!d) throw new Error("DOMAIN_NOT_FOUND");
  const rotation = new StaticDkimRotationService(cfg.velivooDkimKeyEncryptionSecret ?? "");
  const keys = rotation.readKeys(d);
  const privateKey = rotation.activePrivateKey(d);

  console.log("1) GetEmailIdentity");
  try {
    const got = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domainName }));
    console.log("exists:", JSON.stringify({ verification: got.VerificationStatus, dkim: got.DkimAttributes }, null, 2));
  } catch (error) {
    console.log("GetEmailIdentity error:");
    dump(error);
  }

  console.log("\n2) PutEmailIdentityDkimSigningAttributes (EXTERNAL)");
  try {
    await client.send(new PutEmailIdentityDkimSigningAttributesCommand({
      EmailIdentity: domainName,
      SigningAttributesOrigin: "EXTERNAL",
      SigningAttributes: {
        DomainSigningSelector: keys.activeSelector,
        DomainSigningPrivateKey: privateKey,
      },
    }));
    console.log("Put succeeded");
  } catch (error) {
    console.log("Put error:");
    dump(error);
  }

  console.log("\n3) CreateEmailIdentity (BYODKIM)");
  try {
    const created = await client.send(new CreateEmailIdentityCommand({
      EmailIdentity: domainName,
      DkimSigningAttributes: {
        DomainSigningSelector: keys.activeSelector,
        DomainSigningPrivateKey: privateKey,
      },
      Tags: [
        { Key: "velivoo:workspace", Value: d.workspaceId },
        { Key: "velivoo:sender-domain", Value: d.id },
      ],
    }));
    console.log("Create succeeded:", JSON.stringify({ verification: created.VerificationStatus, dkim: created.DkimAttributes }, null, 2));
  } catch (error) {
    console.log("Create error:");
    dump(error);
  }
} finally {
  await prisma.$disconnect();
}
