import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";
const prisma = new PrismaClient();

try {
  const rows = await prisma.senderDomainDnsEvidence.findMany({
    where: { senderDomainId: domainId },
    orderBy: [{ purpose: "asc" }, { createdAt: "asc" }],
  });
  for (const row of rows) {
    const record = row.recordJson ?? {};
    console.log(JSON.stringify({
      purpose: row.purpose,
      status: row.verificationStatus,
      customerActionRequired: row.customerActionRequired,
      name: row.name ?? record.name,
      expectedValue: row.expectedValue ?? record.values?.[0],
    }));
  }
} finally {
  await prisma.$disconnect();
}
