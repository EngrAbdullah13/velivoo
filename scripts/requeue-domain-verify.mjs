import { PrismaClient } from "@prisma/client";

const domainId = process.argv[2] ?? "1cd3f320-1c2f-4c93-9f82-28a23f45ea10";
const prisma = new PrismaClient();

try {
  const result = await prisma.scheduledAction.updateMany({
    where: { deduplicationKey: `sender-domain.verify:${domainId}` },
    data: {
      state: "pending",
      dueAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: null,
    },
  });
  console.log(JSON.stringify({ requeued: result.count }, null, 2));
} finally {
  await prisma.$disconnect();
}
