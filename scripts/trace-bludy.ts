import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = "c9c9b5d1-28a0-44c0-9e3f-33ad89a9e71d";

const flow = await db.flow.findFirst({ where: { workspaceId: ws, id: flowId } });
const version = flow?.activeVersionId
  ? await db.flowVersion.findFirst({ where: { id: flow.activeVersionId } })
  : null;
const trigger = (version?.graphJson as any)?.trigger;
const listId = trigger?.listId as string | undefined;

const [list, deps, memberships, outbox, runs, pendingOutbox] = await Promise.all([
  listId ? db.audienceList.findFirst({ where: { id: listId } }) : null,
  db.flowTriggerDependency.findMany({ where: { workspaceId: ws, flowId } }),
  listId
    ? db.listMembership.findMany({
        where: { workspaceId: ws, listId, state: "active" },
        orderBy: { joinedAt: "desc" },
        take: 10,
      })
    : [],
  db.outboxEvent.findMany({
    where: {
      workspaceId: ws,
      eventType: "phase3.audience.list.entered",
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  }),
  db.flowRun.findMany({
    where: { workspaceId: ws, flowId },
    orderBy: { enteredAt: "desc" },
    take: 10,
  }),
  db.outboxEvent.count({ where: { workspaceId: ws, publishedAt: null } }),
]);

const profileIds = [...new Set(memberships.map((m) => m.profileId))];
const profiles = profileIds.length
  ? await db.profile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, originalEmail: true, deletedAt: true },
    })
  : [];
const profileById = new Map(profiles.map((p) => [p.id, p]));

const activeDep = deps.find((d) => d.flowVersionId === flow?.activeVersionId);

const memberDetails = [];
for (const m of memberships) {
  const profile = profileById.get(m.profileId);
  const [runsForProfile, outboxForMembership] = await Promise.all([
    db.flowRun.findMany({
      where: { workspaceId: ws, flowId, profileId: m.profileId },
      orderBy: { enteredAt: "desc" },
      take: 3,
    }),
    db.outboxEvent.findFirst({
      where: {
        workspaceId: ws,
        eventType: "phase3.audience.list.entered",
        payloadJson: { path: ["membershipId"], equals: m.id },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  memberDetails.push({
    email: profile?.originalEmail,
    membershipId: m.id,
    joinedAt: m.joinedAt,
    source: m.sourceType,
    flowRuns: runsForProfile.map((r) => ({ state: r.state, enteredAt: r.enteredAt })),
    listEnteredOutbox: outboxForMembership
      ? { id: outboxForMembership.id, publishedAt: outboxForMembership.publishedAt, lastError: outboxForMembership.lastError }
      : null,
  });
}

console.log(
  JSON.stringify(
    {
      flow: flow
        ? { id: flow.id, name: flow.name, status: flow.status, entryState: flow.entryState, activeVersionId: flow.activeVersionId }
        : null,
      liveTrigger: trigger,
      liveList: list ? { id: list.id, name: list.name } : null,
      activeDependency: activeDep,
      allDependencies: deps,
      pendingOutboxEvents: pendingOutbox,
      recentListEnteredOutbox: outbox.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        publishedAt: e.publishedAt,
        lastError: e.lastError,
        listId: (e.payloadJson as any)?.listId,
        profileId: (e.payloadJson as any)?.profileId,
      })),
      members: memberDetails,
      recentRuns: runs.map((r) => ({ profileId: r.profileId, state: r.state, enteredAt: r.enteredAt })),
    },
    null,
    2,
  ),
);

await db.$disconnect();
