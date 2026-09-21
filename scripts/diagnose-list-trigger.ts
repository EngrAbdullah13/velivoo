import { PrismaClient } from "@prisma/client";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = process.argv[3] ?? "53baaab5-b259-4808-a311-e842a241b727";
const config = loadEmailPlatformConfig();

const flow = await db.flow.findFirst({ where: { id: flowId, workspaceId: ws } });
const activeVersion = flow?.activeVersionId
  ? await db.flowVersion.findFirst({ where: { id: flow.activeVersionId } })
  : null;
const deps = await db.flowTriggerDependency.findMany({ where: { workspaceId: ws, flowId } });
const recentMemberships = await db.listMembership.findMany({
  where: { workspaceId: ws },
  orderBy: { joinedAt: "desc" },
  take: 8,
});
const activeGraph = (activeVersion?.graphJson ?? flow?.draftGraphJson) as {
  trigger?: { type?: string; listId?: string };
  entryPolicy?: { mode?: string };
  entryFilters?: unknown[];
};
const draftGraph = flow?.draftGraphJson as { trigger?: { type?: string; listId?: string } };
const triggerListId = activeGraph?.trigger?.listId;
const listForTrigger = triggerListId ? await db.audienceList.findFirst({ where: { id: triggerListId } }) : null;
const outbox = await db.outboxEvent.findMany({
  where: { workspaceId: ws, eventType: "phase3.audience.list.entered" },
  orderBy: { createdAt: "desc" },
  take: 8,
});
const runs = await db.flowRun.findMany({
  where: { workspaceId: ws, flowId },
  orderBy: { enteredAt: "desc" },
  take: 8,
});
const messages = await db.message.findMany({
  where: { workspaceId: ws, sourceType: "flow" },
  orderBy: { createdAt: "desc" },
  take: 8,
  select: { id: true, profileId: true, state: true, createdAt: true, submittedAt: true, policyDecision: true },
});

const membershipChecks = [];
for (const m of recentMemberships) {
  const profile = await db.profile.findFirst({
    where: { workspaceId: ws, id: m.profileId },
    select: { id: true, originalEmail: true, normalizedEmail: true, firstName: true },
  });
  const sub = await db.subscriptionState.findUnique({
    where: {
      workspaceId_profileId_channel_purpose: {
        workspaceId: ws,
        profileId: m.profileId,
        channel: "email",
        purpose: "marketing",
      },
    },
  });
  const supp = await db.suppression.count({
    where: { workspaceId: ws, profileId: m.profileId, channel: "email", revokedAt: null },
  });
  membershipChecks.push({
    profileId: m.profileId,
    email: profile?.normalizedEmail ?? profile?.originalEmail,
    name: profile?.firstName,
    listId: m.listId,
    listName: (await db.audienceList.findFirst({ where: { id: m.listId }, select: { name: true } }))?.name,
    listMatchesTrigger: m.listId === triggerListId,
    joinedAt: m.joinedAt,
    state: m.state,
    consent: sub?.currentStatus ?? "unknown",
    suppressed: supp > 0,
    eligible: Boolean(profile?.normalizedEmail) && sub?.currentStatus === "granted" && supp === 0,
  });
}

console.log(
  JSON.stringify(
    {
      config: {
        deliveryQueueEnabled: config.deliveryQueueEnabled,
        emailSendEnabled: config.emailSendEnabled,
        runtimeMode: config.runtimeMode,
        redisConfigured: Boolean(process.env.REDIS_URL),
      },
      flow: flow
        ? {
            id: flow.id,
            name: flow.name,
            status: flow.status,
            entryState: flow.entryState,
            executionState: flow.executionState,
            activeVersionId: flow.activeVersionId,
            activeVersionActivatedAt: flow.activeVersionActivatedAt,
          }
        : null,
      trigger: {
        activeType: activeGraph?.trigger?.type,
        draftType: draftGraph?.trigger?.type,
        listId: triggerListId,
        listName: listForTrigger?.name,
        listStatus: listForTrigger?.status,
        listJoinWillFire: activeGraph?.trigger?.type === "list_joined" && Boolean(triggerListId),
      },
      entryPolicy: activeGraph?.entryPolicy,
      entryFilters: activeGraph?.entryFilters,
      activeDependency: deps.find((d) => d.flowVersionId === flow?.activeVersionId) ?? null,
      dependencies: deps,
      recentMemberships: membershipChecks,
      outboxEvents: outbox.map((o) => ({
        id: o.id,
        publishedAt: o.publishedAt,
        lastError: o.lastError,
        payload: o.payloadJson,
        createdAt: o.createdAt,
      })),
      flowRuns: runs.map((r) => ({
        id: r.id,
        profileId: r.profileId,
        state: r.state,
        enteredAt: r.enteredAt,
        exitReason: r.exitReason,
      })),
      recentFlowMessages: messages,
    },
    null,
    2,
  ),
);

await db.$disconnect();
