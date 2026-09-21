import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const db = new PrismaClient();
const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = "c9c9b5d1-28a0-44c0-9e3f-33ad89a9e71d";
const versionId = "13309d57-7840-49c0-a7e3-dd06f7f1a27a";

const version = await db.flowVersion.findFirst({ where: { id: versionId } });
const graph = version?.graphJson as any;

const memberships = await db.listMembership.findMany({
  where: { workspaceId: ws, listId: "da960b7f-1875-4a8e-b8de-51334cd0bebb", state: "active" },
});

const stable = (...parts: Array<string | number | undefined | null>) =>
  createHash("sha256").update(parts.map((x) => String(x ?? "")).join("|")).digest("hex");

for (const m of memberships) {
  const profile = await db.profile.findFirst({ where: { id: m.profileId }, select: { originalEmail: true } });
  const dedupeOnce = stable(flowId, m.profileId, "once");
  const dedupeEvent = stable(flowId, m.profileId, m.id);
  const runs = await db.flowRun.findMany({
    where: { workspaceId: ws, flowId, profileId: m.profileId },
    orderBy: { enteredAt: "desc" },
  });
  const runOnVersion = await db.flowRun.findUnique({
    where: {
      workspaceId_flowVersionId_deduplicationKey: {
        workspaceId: ws,
        flowVersionId: versionId,
        deduplicationKey: dedupeEvent,
      },
    },
  });
  const messages = await db.message.findMany({
    where: { workspaceId: ws, profileId: m.profileId, flowRunId: { in: runs.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, state: true, flowRunId: true, createdAt: true },
  });
  console.log(
    JSON.stringify(
      {
        email: profile?.originalEmail,
        membershipId: m.id,
        joinedAt: m.joinedAt,
        entryPolicy: graph?.entryPolicy,
        dedupeOnce,
        dedupeEvent,
        runOnActiveVersion: runOnVersion,
        allRuns: runs.map((r) => ({
          id: r.id,
          flowVersionId: r.flowVersionId,
          deduplicationKey: r.deduplicationKey,
          enteredAt: r.enteredAt,
          state: r.state,
        })),
        messages,
      },
      null,
      2,
    ),
  );
}

const pendingActions = await db.scheduledAction.count({
  where: { workspaceId: ws, state: "pending", actionType: "flow.node" },
});

console.log(JSON.stringify({ pendingFlowActions: pendingActions }, null, 2));
await db.$disconnect();
