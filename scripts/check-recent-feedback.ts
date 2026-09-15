import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

function sesType(payload: unknown): string {
  try {
    const env = payload as { Type?: string; Message?: string; eventType?: string; notificationType?: string };
    if (env.eventType || env.notificationType) return env.eventType ?? env.notificationType ?? "unknown";
    if (env?.Type === "Notification" && typeof env.Message === "string") {
      const msg = JSON.parse(env.Message) as { eventType?: string; notificationType?: string };
      return msg.eventType ?? msg.notificationType ?? "unknown";
    }
    return env?.Type ?? "unknown";
  } catch {
    return "parse_error";
  }
}

const inbox = await prisma.inboxMessage.findMany({
  where: { source: "ses", receivedAt: { gte: since } },
  orderBy: { receivedAt: "desc" },
  take: 20,
  select: { id: true, status: true, receivedAt: true, processedAt: true, externalId: true, payloadJson: true },
});

const events = await prisma.deliveryEvent.findMany({
  where: {
    occurredAt: { gte: since },
    eventType: { in: ["complaint", "complained", "delivery", "delivered", "bounce", "hard_bounce"] },
  },
  orderBy: { occurredAt: "desc" },
  take: 20,
  select: { id: true, eventType: true, occurredAt: true, receivedAt: true, messageId: true, providerEventId: true },
});

const complaints = await prisma.suppression.findMany({
  where: { reason: "complaint", createdAt: { gte: since } },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, profileId: true, createdAt: true, sourceReference: true },
});

const profiles = complaints.length
  ? await prisma.profile.findMany({
      where: { id: { in: complaints.map((c) => c.profileId) } },
      select: { id: true, originalEmail: true },
    })
  : [];

const profileById = new Map(profiles.map((p) => [p.id, p.originalEmail]));

console.log(JSON.stringify({
  since: since.toISOString(),
  inboxCount: inbox.length,
  inbox: inbox.map((r) => ({
    id: r.id,
    status: r.status,
    receivedAt: r.receivedAt,
    processedAt: r.processedAt,
    sesEvent: sesType(r.payloadJson),
  })),
  deliveryEvents: events,
  newComplaintSuppressions: complaints.map((c) => ({
    ...c,
    email: profileById.get(c.profileId) ?? null,
  })),
  complaintEvents: events.filter((e) => e.eventType === "complaint" || e.eventType === "complained"),
}, null, 2));

await prisma.$disconnect();
