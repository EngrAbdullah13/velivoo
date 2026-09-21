import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
const rows = await prisma.inboxMessage.findMany({
  where: { source: "ses", receivedAt: { gte: since } },
  orderBy: { receivedAt: "desc" },
  select: { id: true, receivedAt: true, status: true, payloadJson: true },
});

for (const row of rows) {
  let eventType = "?";
  let destination = "";
  try {
    const env = row.payloadJson as { Message?: string; event?: Record<string, unknown> };
    const inner =
      typeof env.Message === "string"
        ? JSON.parse(env.Message)
        : (env.event as Record<string, unknown>) ?? env;
    eventType = String(inner?.eventType ?? inner?.notificationType ?? "?");
    destination = JSON.stringify(inner?.mail?.destination ?? inner?.complaint?.complainedRecipients ?? []);
  } catch {
    /* ignore */
  }
  console.log(`${row.receivedAt.toISOString()}  ${eventType.padEnd(10)}  ${destination}`);
}

await prisma.$disconnect();
