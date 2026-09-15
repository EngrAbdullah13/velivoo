import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const email = "complaint@simulator.amazonses.com";
const profile = await prisma.profile.findFirst({
  where: { normalizedEmail: email, deletedAt: null },
  select: { id: true, workspaceId: true, originalEmail: true },
});

if (!profile) {
  console.log(JSON.stringify({ found: false, email }));
  await prisma.$disconnect();
  process.exit(0);
}

const [suppressions, messages, consents] = await Promise.all([
  prisma.suppression.findMany({ where: { profileId: profile.id }, select: { id: true, reason: true, protected: true, revokedAt: true, createdAt: true } }),
  prisma.message.findMany({ where: { profileId: profile.id }, select: { id: true, state: true, sourceType: true, createdAt: true } }),
  prisma.consentRecord.findMany({ where: { profileId: profile.id }, orderBy: { occurredAt: "desc" }, take: 3, select: { id: true, status: true, occurredAt: true } }),
]);

const messageIds = messages.map((m) => m.id);
const deliveryEvents = messageIds.length
  ? await prisma.deliveryEvent.findMany({ where: { messageId: { in: messageIds } }, select: { id: true, eventType: true, messageId: true } })
  : [];

console.log(JSON.stringify({ found: true, profile, suppressions, messages, deliveryEvents, consents }, null, 2));
await prisma.$disconnect();
