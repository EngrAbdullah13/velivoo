import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";
const prisma = new PrismaClient();

try {
  const d = await prisma.senderDomain.findUnique({ where: { id: domainId } });
  console.log(JSON.stringify({
    dkimSelector: d?.dkimSelector,
    dkimStandbySelector: d?.dkimStandbySelector,
    dkimPublicKeyLen: d?.dkimPublicKey?.length ?? 0,
    dkimStandbyPublicKeyLen: d?.dkimStandbyPublicKey?.length ?? 0,
    routingId: d?.routingId,
    lifecycleState: d?.lifecycleState,
    provisioningVersion: d?.provisioningVersion,
  }, null, 2));

  const ev = await prisma.senderDomainDnsEvidence.findMany({ where: { senderDomainId: domainId, customerActionRequired: true } });
  console.log("evidence:", ev.map(e => ({
    purpose: e.purpose,
    ownership: e.ownership,
    status: e.verificationStatus,
    name: e.recordJson?.name,
  })));
} finally {
  await prisma.$disconnect();
}
