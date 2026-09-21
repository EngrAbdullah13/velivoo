import { randomUUID } from "node:crypto";
import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const email = (process.argv[2] ?? "abdullahriaz1308@gmail.com").trim().toLowerCase();
const now = new Date();

const profile = await prisma.profile.findFirst({
  where: { normalizedEmail: email, deletedAt: null },
  select: { id: true, workspaceId: true, originalEmail: true },
});

if (!profile) {
  console.log(JSON.stringify({ ok: false, reason: "PROFILE_NOT_FOUND", email }));
  await prisma.$disconnect();
  process.exit(1);
}

const result = await prisma.$transaction(async (tx) => {
  const revoked = await tx.suppression.updateMany({
    where: {
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      channel: "email",
      reason: { in: ["global_unsubscribe", "category_unsubscribe"] },
      revokedAt: null,
    },
    data: { revokedAt: now },
  });

  const consent = await tx.consentRecord.create({
    data: {
      id: randomUUID(),
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      channel: "email",
      purpose: "marketing",
      status: "granted",
      occurredAt: now,
      source: "ADMIN",
      actorId: null,
      sourceDetails: { note: "Manual unsubscribe revert for testing" },
    },
  });

  const subscription = await tx.subscriptionState.upsert({
    where: {
      workspaceId_profileId_channel_purpose: {
        workspaceId: profile.workspaceId,
        profileId: profile.id,
        channel: "email",
        purpose: "marketing",
      },
    },
    create: {
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      channel: "email",
      purpose: "marketing",
      currentStatus: "granted",
      effectiveAt: now,
      sourceConsentRecordId: consent.id,
      revision: 1n,
      unsubscribedAt: null,
      unsubscribeSource: null,
      unsubscribeCampaignId: null,
      unsubscribeMessageId: null,
      unsubscribeMethod: null,
    },
    update: {
      currentStatus: "granted",
      effectiveAt: now,
      sourceConsentRecordId: consent.id,
      revision: { increment: 1n },
      unsubscribedAt: null,
      unsubscribeSource: null,
      unsubscribeCampaignId: null,
      unsubscribeMessageId: null,
      unsubscribeMethod: null,
    },
  });

  const activeSuppressions = await tx.suppression.findMany({
    where: {
      workspaceId: profile.workspaceId,
      profileId: profile.id,
      channel: "email",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { reason: true, protected: true },
  });

  return {
    email: profile.originalEmail,
    profileId: profile.id,
    revokedSuppressions: revoked.count,
    consentId: consent.id,
    subscriptionStatus: subscription.currentStatus,
    remainingSuppressions: activeSuppressions,
  };
});

console.log(JSON.stringify({ ok: true, ...result }, null, 2));
await prisma.$disconnect();
