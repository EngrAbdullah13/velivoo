import { PrismaClient } from "@prisma/client";
import { Phase3RuntimeService } from "../packages/application/src/phase3/phase3-runtime-service.js";
import { PrismaPhase3Repository } from "../packages/persistence/src/prisma/phase3-repository.js";
import {
  PrismaFlowRuleEvaluationPort,
  PrismaPhase2FlowMessagePort,
} from "../packages/persistence/src/prisma/phase3-runtime-adapters.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = "c9c9b5d1-28a0-44c0-9e3f-33ad89a9e71d";
const listId = "da960b7f-1875-4a8e-b8de-51334cd0bebb";

const db = new PrismaClient();
const repo = new PrismaPhase3Repository(db);
const runtime = new Phase3RuntimeService(
  repo,
  new PrismaPhase2FlowMessagePort(db),
  new PrismaFlowRuleEvaluationPort(db),
);

const flow = await repo.flow(ws, flowId);
if (!flow) throw new Error("FLOW_NOT_FOUND");

const memberships = await db.listMembership.findMany({
  where: { workspaceId: ws, listId, state: "active" },
  orderBy: { joinedAt: "desc" },
});

const replay = [];
for (const membership of memberships) {
  const profile = await db.profile.findFirst({
    where: { id: membership.profileId },
    select: { originalEmail: true },
  });
  const occurredAt = membership.joinedAt;
  const skipActivation =
    flow.activeVersionActivatedAt &&
    new Date(flow.activeVersionActivatedAt) > new Date(occurredAt);

  if (skipActivation) {
    replay.push({
      email: profile?.originalEmail,
      joinedAt: membership.joinedAt,
      entered: false,
      reason: "SKIPPED_JOIN_BEFORE_ACTIVATION",
      activeVersionActivatedAt: flow.activeVersionActivatedAt,
    });
    continue;
  }

  const result = await runtime.enter({
    workspaceId: ws,
    flowId,
    profileId: membership.profileId,
    triggerEventId: membership.id,
    triggerKey: `audience:list:${membership.id}`,
    now: membership.joinedAt,
  });
  replay.push({
    email: profile?.originalEmail,
    joinedAt: membership.joinedAt,
    entered: result.entered,
    reason: result.entered ? undefined : (result as { reason?: string }).reason,
    runId: result.entered ? result.run.id : undefined,
  });
}

const results: Array<{ actionId: string; status: string; error?: string }> = [];
for (let round = 0; round < 20; round++) {
  const claimed = await runtime.dispatchDue({
    now: new Date(),
    leaseOwner: `replay-script:${process.pid}`,
    leaseMs: 60000,
    limit: 20,
  });
  if (!claimed.length) break;
  for (const action of claimed) {
    try {
      const outcome = await runtime.executeAction(action, new Date());
      results.push({ actionId: action.id, status: outcome.status });
    } catch (error) {
      results.push({
        actionId: action.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const runsOnFlow = await db.flowRun.findMany({
  where: { workspaceId: ws, flowId, flowVersionId: flow.activeVersionId ?? undefined },
  orderBy: { enteredAt: "desc" },
  select: { id: true, profileId: true, enteredAt: true, state: true },
});
const runIds = runsOnFlow.map((r) => r.id);
const messages = runIds.length
  ? await db.message.findMany({
      where: { workspaceId: ws, sourceType: "flow", flowRunId: { in: runIds } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, state: true, createdAt: true, flowRunId: true, profileId: true },
    })
  : [];
const profiles = await db.profile.findMany({
  where: { id: { in: [...new Set(messages.map((m) => m.profileId))] } },
  select: { id: true, originalEmail: true },
});
const emailByProfile = new Map(profiles.map((p) => [p.id, p.originalEmail]));

console.log(
  JSON.stringify(
    {
      activeVersionId: flow.activeVersionId,
      activeVersionActivatedAt: flow.activeVersionActivatedAt,
      replay,
      executedActions: results,
      runsOnActiveVersion: runsOnFlow,
      recentMessages: messages.map((m) => ({
        ...m,
        email: emailByProfile.get(m.profileId),
      })),
    },
    null,
    2,
  ),
);

await db.$disconnect();
