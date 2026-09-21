import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const bySource = await prisma.message.groupBy({
  by: ["sourceType", "state"],
  _count: { _all: true },
});
const latest = await prisma.message.findMany({
  where: { state: { in: ["submitted", "delivered"] } },
  orderBy: { submittedAt: "desc" },
  take: 5,
  select: { id: true, sourceType: true, state: true, submittedAt: true },
});
console.log(JSON.stringify({ bySource, latest }, null, 2));
await prisma.$disconnect();
