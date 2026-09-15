import { PrismaClient } from "@prisma/client";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.ts";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.ts";
import { staticBrandedMailFromDomain } from "../packages/domain/src/phase1/static-branded-dns.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";

const rootDomain = process.argv[2] ?? "lahorixsolutions.com";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const domain = await prisma.senderDomain.findFirst({
    where: { OR: [{ domain: rootDomain }, { rootDomain }] },
  });
  if (!domain) {
    console.log(JSON.stringify({ error: "DOMAIN_NOT_FOUND", rootDomain }, null, 2));
    process.exit(1);
  }
  if (!cfg.awsSesRegion) {
    console.log(JSON.stringify({ error: "SES_REGION_NOT_CONFIGURED" }, null, 2));
    process.exit(1);
  }

  const root = (domain.rootDomain ?? domain.domain).toLowerCase();
  const mailFromDomain = staticBrandedMailFromDomain(root);
  const rotation = new StaticDkimRotationService(cfg.velivooDkimKeyEncryptionSecret ?? "");
  const keys = rotation.readKeys(domain);
  const privateKey = rotation.activePrivateKey(domain);
  const ses = new SesEmailDomainProvider(cfg.awsSesRegion);

  const before = {};
  for (const name of [root, domain.providerReference, `send.${root}`, `engr@${root}`].filter(Boolean)) {
    try {
      before[name] = (await ses.inspectIdentity(name)).state;
    } catch (error) {
      before[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const beforeRoot = before[root];
  const byodkimAlreadyReady =
    beforeRoot &&
    !beforeRoot.error &&
    beforeRoot.dkimSigningOrigin === "EXTERNAL" &&
    beforeRoot.dkimStatus === "SUCCESS" &&
    beforeRoot.dkimSigningSelector === keys.activeSelector;
  const byodkim = byodkimAlreadyReady
    ? await ses.getIdentity({ domain: root, reference: root })
    : await ses.ensureByodkimIdentity({
        domain: root,
        selector: keys.activeSelector,
        privateKeyPem: privateKey,
        existingReference: root,
        workspaceId: domain.workspaceId,
        senderDomainId: domain.id,
      });
  const mailFromRecords = await ses.configureMailFrom({
    domain: root,
    mailFromDomain,
    behaviorOnMxFailure: "USE_DEFAULT_VALUE",
  });
  const afterIdentity = await ses.getIdentity({ domain: root, reference: root });

  await prisma.senderDomain.update({
    where: { id: domain.id },
    data: {
      providerReference: root,
      providerRegion: cfg.awsSesRegion,
      dkimStatus: afterIdentity.dkimStatus,
      mailFromStatus: afterIdentity.mailFromStatus,
      mailFromDomain,
    },
  });

  const route = await prisma.emailDeliveryRoute.findFirst({
    where: { workspaceId: domain.workspaceId, senderDomainId: domain.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  if (route) {
    await prisma.emailDeliveryRoute.update({
      where: { id: route.id },
      data: {
        providerRegion: cfg.awsSesRegion,
        providerIdentityReference: root,
        mailFromDomain,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        region: cfg.awsSesRegion,
        root,
        mailFromDomain,
        activeSelector: keys.activeSelector,
        before,
        byodkim,
        mailFromRecords,
        afterIdentity,
        routeUpdated: route ? { id: route.id, providerIdentityReference: root, mailFromDomain } : null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
