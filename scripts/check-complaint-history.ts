import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const complaints = await prisma.deliveryEvent.findMany({
  where: { eventType: { in: ["complaint", "complained"] } },
  orderBy: { occurredAt: "desc" },
  take: 5,
});

for (const event of complaints) {
  const message = await prisma.message.findFirst({
    where: { id: event.messageId },
    select: { profileId: true, submittedAt: true, sourceType: true },
  });
  const profile = message
    ? await prisma.profile.findFirst({ where: { id: message.profileId }, select: { originalEmail: true } })
    : null;
  console.log(JSON.stringify({
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    email: profile?.originalEmail ?? null,
    sourceType: message?.sourceType ?? null,
  }));
}

await prisma.$disconnect();
