import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";
const db = new PrismaClient();

const rows = await db.senderDomainDnsEvidence.findMany({
  where: { senderDomainId: domainId },
  orderBy: [{ purpose: "asc" }, { name: "asc" }],
  select: {
    purpose: true,
    name: true,
    recordType: true,
    customerActionRequired: true,
    verificationStatus: true,
    expectedValue: true,
  },
});

const customer = rows.filter((row) => row.customerActionRequired);
console.log(
  JSON.stringify(
    {
      domainId,
      totalEvidenceRows: rows.length,
      customerActionRequiredCount: customer.length,
      customerRecords: customer,
      dmarcRows: rows.filter((row) => row.purpose === "dmarc_advisory"),
    },
    null,
    2,
  ),
);

await db.$disconnect();
