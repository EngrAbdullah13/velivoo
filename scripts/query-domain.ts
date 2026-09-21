import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "3dc8c2c7-b44c-4cec-a566-36f80e47cb47";
const db = new PrismaClient();
const domain = await db.senderDomain.findUnique({
  where: { id: domainId },
  select: { delegatedSubdomain: true, rootDomain: true, domain: true, lastCheckedAt: true },
});
console.log(JSON.stringify(domain, null, 2));
await db.$disconnect();
