import { PrismaClient } from "@prisma/client";
import { staticProductionDnsPurposes } from "../packages/domain/src/phase1/static-branded-dns.js";
import { pickDnsEvidenceForPurpose } from "../packages/domain/src/phase1/static-production-customer-dns.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const domainId = process.argv[2] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const config = loadEmailPlatformConfig();
const dmarcRequired = Boolean(config.dmarcRequired);
const db = new PrismaClient();

await db.senderDomainDnsEvidence.deleteMany({
  where: { senderDomainId: domainId, purpose: "send_routing" },
});

for (const purpose of staticProductionDnsPurposes(dmarcRequired)) {
  const rows = await db.senderDomainDnsEvidence.findMany({
    where: { senderDomainId: domainId, purpose },
    orderBy: { updatedAt: "desc" },
  });
  if (rows.length <= 1) continue;
  const keep = pickDnsEvidenceForPurpose(
    rows.map((row) => ({
      purpose: row.purpose,
      recordType: row.recordType,
      name: row.name,
      expectedValue: row.expectedValue,
      verificationStatus: row.verificationStatus,
    })),
    purpose,
  );
  if (!keep) continue;
  await db.senderDomainDnsEvidence.deleteMany({
    where: {
      senderDomainId: domainId,
      purpose,
      NOT: { id: rows.find((row) => row.expectedValue === keep.expectedValue && row.name === keep.name)?.id ?? rows[0]!.id },
    },
  });
}

await db.senderDomainDnsEvidence.updateMany({
  where: { senderDomainId: domainId, purpose: { notIn: [...staticProductionDnsPurposes(dmarcRequired)] } },
  data: { customerActionRequired: false },
});

const active = await db.senderDomainDnsEvidence.findMany({
  where: { senderDomainId: domainId, verificationStatus: { not: "archived" } },
  orderBy: [{ purpose: "asc" }, { name: "asc" }],
});
console.log(JSON.stringify(active.map((r) => ({ purpose: r.purpose, name: r.name, status: r.verificationStatus })), null, 2));
await db.$disconnect();
