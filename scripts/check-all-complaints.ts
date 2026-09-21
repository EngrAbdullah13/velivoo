import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

function parseSesEvent(payload: unknown): { eventType: string; destination: string } {
  try {
    const env = payload as { Message?: string; event?: Record<string, unknown> };
    const inner =
      typeof env.Message === "string"
        ? JSON.parse(env.Message)
        : (env.event as Record<string, unknown>) ?? env;
    const eventType = String(inner?.eventType ?? inner?.notificationType ?? "unknown");
    const dest = inner?.mail?.destination ?? inner?.complaint?.complainedRecipients ?? [];
    return { eventType, destination: JSON.stringify(dest) };
  } catch {
    return { eventType: "parse_error", destination: "" };
  }
}

const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

const inbox = await prisma.inboxMessage.findMany({
  where: { source: "ses", receivedAt: { gte: since } },
  orderBy: { receivedAt: "desc" },
  select: { id: true, status: true, receivedAt: true, processedAt: true, payloadJson: true },
});

const inboxSummary = inbox.map((row) => {
  const parsed = parseSesEvent(row.payloadJson);
  return {
    id: row.id,
    status: row.status,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    eventType: parsed.eventType,
    destination: parsed.destination,
  };
});

const complaintInbox = inboxSummary.filter((r) => r.eventType.toLowerCase().includes("complaint"));
const pendingInbox = inboxSummary.filter((r) => r.status === "received");

const complaints = await prisma.deliveryEvent.findMany({
  where: {
    occurredAt: { gte: since },
    eventType: { in: ["complaint", "complained"] },
  },
  orderBy: { occurredAt: "desc" },
  select: { id: true, eventType: true, occurredAt: true, receivedAt: true, messageId: true },
});

const complaintProfiles = await prisma.suppression.findMany({
  where: { reason: "complaint", createdAt: { gte: since }, revokedAt: null },
  orderBy: { createdAt: "desc" },
  select: { id: true, profileId: true, createdAt: true, sourceReference: true },
});

const profileIds = [...new Set(complaintProfiles.map((s) => s.profileId))];
const profiles = profileIds.length
  ? await prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, originalEmail: true } })
  : [];
const emailById = new Map(profiles.map((p) => [p.id, p.originalEmail]));

const gmailEmail = "abdullahriaz1308@gmail.com";
const gmailProfile = await prisma.profile.findFirst({
  where: { normalizedEmail: gmailEmail, deletedAt: null },
  select: { id: true },
});

let gmailMessages: Array<{ id: string; state: string; submittedAt: Date | null }> = [];
if (gmailProfile) {
  gmailMessages = await prisma.message.findMany({
    where: { profileId: gmailProfile.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, state: true, submittedAt: true },
  });
}

const gmailComplaintInbox = complaintInbox.filter((r) => r.destination.includes(gmailEmail));
const gmailComplaintEvents = complaints.filter((e) =>
  gmailMessages.some((m) => m.id === e.messageId),
);

console.log(
  JSON.stringify(
    {
      checkedSince: since.toISOString(),
      totalSesInbox: inbox.length,
      complaintInboxCount: complaintInbox.length,
      complaintInbox,
      pendingUnprocessedInbox: pendingInbox,
      complaintDeliveryEvents: complaints,
      complaintSuppressions: complaintProfiles.map((s) => ({
        ...s,
        email: emailById.get(s.profileId) ?? null,
      })),
      gmail: {
        email: gmailEmail,
        complaintInboxCount: gmailComplaintInbox.length,
        gmailComplaintInbox,
        messageStates: gmailMessages,
        complaintEventsForGmail: gmailComplaintEvents,
        hasComplaintSuppression: complaintProfiles.some((s) => s.profileId === gmailProfile?.id),
      },
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
