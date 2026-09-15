import { PrismaClient } from "@prisma/client";
import dns from "node:dns/promises";
import { createPublicKey } from "node:crypto";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.ts";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";
import { dkimPublicKeyDnsTxt } from "../packages/domain/src/phase1/dkim-key.ts";

const root = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const domain = await prisma.senderDomain.findFirst({ where: { OR: [{ domain: root }, { rootDomain: root }] } });
  if (!domain) throw new Error("DOMAIN_NOT_FOUND");
  const rotation = new StaticDkimRotationService(cfg.velivooDkimKeyEncryptionSecret ?? "");
  const privateKey = rotation.activePrivateKey(domain);
  const derivedPublic = dkimPublicKeyDnsTxt(createPublicKey(privateKey).export({ type: "spki", format: "pem" }));
  const cname = await dns.resolveCname(`vm1._domainkey.${root}`);
  const dnsTxt = (await dns.resolveTxt(cname[0])).flat().join("");
  const ses = new SesEmailDomainProvider(cfg.awsSesRegion ?? "eu-north-1");
  const identity = await ses.inspectIdentity(root);

  console.log(
    JSON.stringify(
      {
        root,
        ses: {
          signingOrigin: identity.raw.DkimAttributes?.SigningAttributesOrigin,
          status: identity.raw.DkimAttributes?.Status,
          selector: identity.state.dkimSigningSelector,
        },
        keys: {
          storedMatchesPrivateKey: domain.dkimPublicKey === derivedPublic,
          dnsMatchesStored: dnsTxt.includes(String(domain.dkimPublicKey).replace(/^v=DKIM1; k=rsa; p=/, "").slice(0, 32)),
          cnameTarget: cname[0],
        },
        gmailNote:
          "SES always adds a second DKIM signature d=amazonses.com for feedback loops. Gmail may show signed-by: amazonses.com even when your d=lahorixsolutions.com signature is also present and passes.",
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
