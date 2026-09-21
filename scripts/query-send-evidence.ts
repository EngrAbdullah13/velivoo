import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const db = new PrismaClient();
const rows = await db.senderDomainDnsEvidence.findMany({
  where: { senderDomainId: domainId, purpose: "send_routing" },
  orderBy: { updatedAt: "desc" },
});
console.log(JSON.stringify(rows.map((r) => ({
  name: r.name,
  status: r.verificationStatus,
  customerActionRequired: r.customerActionRequired,
  expected: r.expectedValue,
  observed: r.observedValue,
})), null, 2));
await db.$disconnect();
