import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";

const messages = await db.message.findMany({
  where: { workspaceId: ws, sourceType: "flow", createdAt: { gte: new Date("2026-09-17T06:00:00Z") } },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, state: true, submittedAt: true, profileId: true, policyDecision: true },
});

const profiles = await db.profile.findMany({
  where: { id: { in: messages.map((m) => m.profileId) } },
  select: { id: true, originalEmail: true },
});
const profileById = new Map(profiles.map((p) => [p.id, p.originalEmail]));

const results = [];
for (const m of messages) {
  const attempts = await db.deliveryAttempt.findMany({
    where: { messageId: m.id },
    select: { state: true, providerMessageId: true, errorCode: true },
  });
  results.push({
    email: profileById.get(m.profileId),
    state: m.state,
    submittedAt: m.submittedAt,
    policyReason: (m.policyDecision as any)?.reason,
    attempts,
  });
}

console.log(JSON.stringify(results, null, 2));
await db.$disconnect();
