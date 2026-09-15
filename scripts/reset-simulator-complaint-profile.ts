import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const email = "complaint@simulator.amazonses.com";

const profile = await prisma.profile.findFirst({
  where: { normalizedEmail: email, deletedAt: null },
  select: { id: true, workspaceId: true, originalEmail: true },
});

if (!profile) {
  console.log(JSON.stringify({ ok: false, reason: "PROFILE_NOT_FOUND", email }));
  await prisma.$disconnect();
  process.exit(0);
}

const messages = await prisma.message.findMany({
  where: { workspaceId: profile.workspaceId, profileId: profile.id },
  select: { id: true },
});
const messageIds = messages.map((m) => m.id);

const result = await prisma.$transaction(async (tx) => {
  const deliveryEvents = messageIds.length
    ? await tx.deliveryEvent.deleteMany({ where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } } })
    : { count: 0 };
  const attempts = messageIds.length
    ? await tx.deliveryAttempt.deleteMany({ where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } } })
    : { count: 0 };
  const traces = messageIds.length
    ? await tx.traceEvent.deleteMany({
        where: {
          workspaceId: profile.workspaceId,
          OR: [
            { aggregateType: "message", aggregateId: { in: messageIds } },
            { aggregateType: "message", aggregateId: { in: messageIds.map(String) } },
          ],
        },
      })
    : { count: 0 };
  const artifacts = messageIds.length
    ? await tx.renderedMessageArtifact.deleteMany({ where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } } })
    : { count: 0 };
  const links = messageIds.length
    ? await tx.trackingLink.deleteMany({ where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } } })
    : { count: 0 };
  const reservations = messageIds.length
    ? await tx.frequencyReservation.deleteMany({ where: { workspaceId: profile.workspaceId, messageId: { in: messageIds } } })
    : { count: 0 };
  const outbox = messageIds.length
    ? await tx.outboxEvent.deleteMany({ where: { workspaceId: profile.workspaceId, aggregateType: "message", aggregateId: { in: messageIds } } })
    : { count: 0 };
  const deletedMessages = messageIds.length
    ? await tx.message.deleteMany({ where: { workspaceId: profile.workspaceId, id: { in: messageIds } } })
    : { count: 0 };
  const suppressions = await tx.suppression.deleteMany({
    where: { workspaceId: profile.workspaceId, profileId: profile.id, channel: "email", reason: "complaint" },
  });

  return {
    deliveryEvents: deliveryEvents.count,
    attempts: attempts.count,
    traces: traces.count,
    artifacts: artifacts.count,
    links: links.count,
    reservations: reservations.count,
    outbox: outbox.count,
    messages: deletedMessages.count,
    suppressions: suppressions.count,
  };
});

console.log(JSON.stringify({
  ok: true,
  email: profile.originalEmail,
  profileId: profile.id,
  workspaceId: profile.workspaceId,
  removed: result,
  note: "Profile kept so you can send another complaint simulator test.",
}, null, 2));

await prisma.$disconnect();
