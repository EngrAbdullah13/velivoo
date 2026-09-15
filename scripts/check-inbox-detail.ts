import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const rows = await prisma.inboxMessage.findMany({
  where: { source: "ses" },
  orderBy: { receivedAt: "desc" },
  take: 10,
});

for (const row of rows) {
  const payload = row.payloadJson as Record<string, unknown>;
  let inner: Record<string, unknown> | null = null;
  if (typeof payload?.Message === "string") {
    try { inner = JSON.parse(payload.Message); } catch { /* ignore */ }
  }
  console.log(JSON.stringify({
    id: row.id,
    receivedAt: row.receivedAt,
    status: row.status,
    topLevelKeys: Object.keys(payload ?? {}),
    snsType: payload?.Type,
    innerEventType: inner?.eventType ?? inner?.notificationType,
    innerKeys: inner ? Object.keys(inner).slice(0, 12) : null,
  }));
}

const allComplaints = await prisma.deliveryEvent.count({ where: { eventType: { in: ["complaint", "complained"] } } });
const allBounces = await prisma.deliveryEvent.count({ where: { eventType: { in: ["bounce", "hard_bounce"] } } });
console.log(JSON.stringify({ allTimeComplaints: allComplaints, allTimeBounces: allBounces }));

await prisma.$disconnect();
