import { PrismaClient } from "@prisma/client";
import { createPublicKey } from "node:crypto";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.ts";
import { dkimPublicKeyDnsTxt } from "../packages/domain/src/phase1/dkim-key.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";
import dns from "node:dns/promises";

const rootDomain = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const domain = await prisma.senderDomain.findFirst({ where: { OR: [{ domain: rootDomain }, { rootDomain }] } });
  if (!domain) throw new Error("DOMAIN_NOT_FOUND");
  const rotation = new StaticDkimRotationService(cfg.velivooDkimKeyEncryptionSecret ?? "");
  const keys = rotation.readKeys(domain);
  const privateKey = rotation.activePrivateKey(domain);
  const derivedPublic = dkimPublicKeyDnsTxt(createPublicKey(privateKey).export({ type: "spki", format: "pem" }));
  const storedPublic = String(domain.dkimPublicKey ?? "");
  const cname = await dns.resolveCname(`vm1._domainkey.${rootDomain}`).catch(() => []);
  const txt = await dns.resolveTxt(cname[0] ?? `vm1._domainkey.${rootDomain}`).catch(() => []);
  const dnsPublic = txt.flat().join("");
  console.log(
    JSON.stringify(
      {
        activeSelector: keys.activeSelector,
        storedPublicKeyPrefix: storedPublic.slice(0, 80),
        derivedPublicKeyPrefix: derivedPublic.slice(0, 80),
        storedMatchesDerived: storedPublic === derivedPublic,
        dnsPublicKeyPrefix: dnsPublic.slice(0, 80),
        dnsMatchesStored: dnsPublic.includes(storedPublic.replace(/^v=DKIM1; k=rsa; p=/, "p=").slice(3, 83)),
        cnameTarget: cname[0] ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
