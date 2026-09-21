import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const listId = process.argv[3] ?? "e9d51f4b-74e7-444f-a3c9-0c55db724075";
const flowId = process.argv[4] ?? "53baaab5-b259-4808-a311-e842a241b727";

const [list, flow, memberships, pendingOutbox, recentMessages, recentRuns] = await Promise.all([
  db.audienceList.findFirst({ where: { id: listId, workspaceId: ws } }),
  db.flow.findFirst({ where: { id: flowId, workspaceId: ws } }),
  db.listMembership.findMany({
    where: { workspaceId: ws, listId, state: "active" },
    orderBy: { joinedAt: "desc" },
    take: 20,
  }),
  db.outboxEvent.findMany({
    where: { workspaceId: ws, publishedAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, eventType: true, createdAt: true, payloadJson: true, lastError: true },
  }),
  db.message.findMany({
    where: { workspaceId: ws, createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, state: true, profileId: true, flowRunId: true, createdAt: true, submittedAt: true, policyDecision: true },
  }),
  db.flowRun.findMany({
    where: { workspaceId: ws, flowId, enteredAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    orderBy: { enteredAt: "desc" },
    take: 20,
  }),
]);

const profileIds = [...new Set(memberships.map((m) => m.profileId))];
const profiles = profileIds.length
  ? await db.profile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, originalEmail: true, createdAt: true, deletedAt: true },
    })
  : [];
const profileById = new Map(profiles.map((p) => [p.id, p]));

const contacts = [];
for (const membership of memberships) {
  const profile = profileById.get(membership.profileId);
  if (!profile) continue;
  const [subscription, suppressions, runs, messages] = await Promise.all([
    db.subscriptionState.findUnique({
      where: { workspaceId_profileId_channel_purpose: { workspaceId: ws, profileId: profile.id, channel: "email", purpose: "marketing" } },
    }),
    db.suppression.findMany({
      where: { workspaceId: ws, profileId: profile.id, channel: "email", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    db.flowRun.findMany({ where: { workspaceId: ws, flowId, profileId: profile.id }, orderBy: { enteredAt: "desc" }, take: 3 }),
    db.message.findMany({
      where: { workspaceId: ws, profileId: profile.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, state: true, createdAt: true, submittedAt: true, policyDecision: true },
    }),
  ]);
  contacts.push({
    email: profile.originalEmail,
    profileDeleted: Boolean(profile.deletedAt),
    joinedAt: membership.joinedAt,
    consent: subscription?.currentStatus ?? "unknown",
    suppressed: suppressions.map((s) => s.reason),
    flowRuns: runs.map((r) => ({ id: r.id, state: r.state, enteredAt: r.enteredAt })),
    messages: messages.map((m) => ({
      id: m.id,
      state: m.state,
      policyReason: (m.policyDecision as any)?.reason,
      holdReason: (m.policyDecision as any)?.holdReason,
      createdAt: m.createdAt,
      submittedAt: m.submittedAt,
    })),
  });
}

const json = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
console.log(
  JSON.stringify(
    {
      list: list ? { id: list.id, name: list.name, status: list.status } : null,
      flow: flow
        ? { id: flow.id, name: flow.name, status: flow.status, entryState: flow.entryState, activeVersionId: flow.activeVersionId }
        : null,
      pendingOutbox,
      recentRuns: recentRuns.map((r) => ({ id: r.id, profileId: r.profileId, state: r.state, enteredAt: r.enteredAt, deduplicationKey: r.deduplicationKey })),
      recentMessages: recentMessages.map((m) => ({ ...m, email: profileById.get(m.profileId)?.originalEmail })),
      contacts,
    },
    json,
    2,
  ),
);

await db.$disconnect();
