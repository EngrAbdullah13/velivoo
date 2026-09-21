import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const db = new PrismaClient();
const rows = await db.senderDomainDnsEvidence.findMany({
  where: { senderDomainId: domainId },
  orderBy: [{ purpose: "asc" }, { name: "asc" }],
});
console.log(JSON.stringify(rows.map((r) => ({
  purpose: r.purpose,
  name: r.name,
  status: r.verificationStatus,
  customerActionRequired: r.customerActionRequired,
  expected: r.expectedValue,
})), null, 2));
await db.$disconnect();
