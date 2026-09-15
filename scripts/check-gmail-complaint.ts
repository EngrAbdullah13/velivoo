import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const email = "abdullahriaz1308@gmail.com";
const profile = await prisma.profile.findFirst({
  where: { normalizedEmail: email, deletedAt: null },
  select: { id: true, workspaceId: true },
});

if (!profile) {
  console.log(JSON.stringify({ email, found: false }));
  await prisma.$disconnect();
  process.exit(0);
}

const [suppressions, messages] = await Promise.all([
  prisma.suppression.findMany({
    where: { workspaceId: profile.workspaceId, profileId: profile.id, channel: "email", revokedAt: null },
    select: { reason: true, createdAt: true, protected: true },
  }),
  prisma.message.findMany({
    where: { workspaceId: profile.workspaceId, profileId: profile.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, state: true, sourceType: true, submittedAt: true, createdAt: true },
  }),
]);

const messageIds = messages.map((m) => m.id);
const events = messageIds.length
  ? await prisma.deliveryEvent.findMany({
      where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } },
      orderBy: { occurredAt: "desc" },
      select: { eventType: true, occurredAt: true, messageId: true },
    })
  : [];

const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const recentInbox = await prisma.inboxMessage.findMany({
  where: { source: "ses", receivedAt: { gte: since } },
  orderBy: { receivedAt: "desc" },
  take: 20,
  select: { id: true, receivedAt: true, payloadJson: true },
});

const gmailComplaintInbox = recentInbox.filter((row) => {
  const payload = row.payloadJson as { Message?: string; event?: { eventType?: string } };
  try {
    const inner = typeof payload.Message === "string" ? JSON.parse(payload.Message) : payload.event ?? payload;
    const dest = JSON.stringify(inner?.mail?.destination ?? inner?.complaint ?? "");
    const type = inner?.eventType ?? "";
    return type === "Complaint" && dest.includes("abdullahriaz1308@gmail.com");
  } catch {
    return false;
  }
});

console.log(JSON.stringify({
  email,
  profileId: profile.id,
  suppressions,
  messages,
  deliveryEvents: events,
  gmailComplaintInboxCount: gmailComplaintInbox.length,
  gmailComplaintInbox: gmailComplaintInbox.map((r) => ({ id: r.id, receivedAt: r.receivedAt })),
}, null, 2));

await prisma.$disconnect();
