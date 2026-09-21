import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const email = process.argv[2] ?? "abdullahriaz1308@gmail.com";
const profile = await prisma.profile.findFirst({
  where: { normalizedEmail: email.toLowerCase(), deletedAt: null },
  select: { id: true, workspaceId: true, originalEmail: true },
});

if (!profile) {
  console.log(JSON.stringify({ found: false, email }));
  await prisma.$disconnect();
  process.exit(0);
}

const [suppressions, subscription, consent] = await Promise.all([
  prisma.suppression.findMany({
    where: { workspaceId: profile.workspaceId, profileId: profile.id, channel: "email", revokedAt: null },
    select: { id: true, reason: true, protected: true, createdAt: true, source: true },
  }),
  prisma.subscriptionState.findUnique({
    where: {
      workspaceId_profileId_channel_purpose: {
        workspaceId: profile.workspaceId,
        profileId: profile.id,
        channel: "email",
        purpose: "marketing",
      },
    },
  }),
  prisma.consentRecord.findFirst({
    where: { workspaceId: profile.workspaceId, profileId: profile.id, channel: "email", purpose: "marketing" },
    orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
    select: { id: true, status: true, occurredAt: true, source: true },
  }),
]);

console.log(JSON.stringify({ profile, suppressions, subscription, latestConsent: consent }, null, 2));
await prisma.$disconnect();
