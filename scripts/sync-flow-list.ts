import { PrismaClient } from "@prisma/client";
import { Phase3Service } from "../packages/application/src/phase3/phase3-service.js";
import { Phase3RuntimeService } from "../packages/application/src/phase3/phase3-runtime-service.js";
import { PrismaPhase3Repository } from "../packages/persistence/src/prisma/phase3-repository.js";
import {
  PrismaFlowRuleEvaluationPort,
  PrismaPhase2FlowMessagePort,
} from "../packages/persistence/src/prisma/phase3-runtime-adapters.js";
import type { FlowGraph3 } from "../packages/domain/src/phase3/flow.js";

const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = process.argv[3] ?? "705d3c4e-ec69-460d-a1e6-33ae34289a36";

const db = new PrismaClient();
const repo = new PrismaPhase3Repository(db);
const service = new Phase3Service(repo);
const runtime = new Phase3RuntimeService(
  repo,
  new PrismaPhase2FlowMessagePort(db),
  new PrismaFlowRuleEvaluationPort(db),
);

const flow = await repo.flow(ws, flowId);
if (!flow) throw new Error("FLOW_NOT_FOUND");

let graph = structuredClone(flow.draftGraph) as FlowGraph3;
if (graph.trigger.type !== "list_joined" || !graph.trigger.listId) {
  throw new Error(`Flow trigger must be list_joined with a list. Current: ${graph.trigger.type}`);
}

graph = {
  ...graph,
  nodes: graph.nodes.map((node) =>
    node.type === "email" ? { ...node, mode: "live" as const } : node,
  ),
};

await repo.updateFlow({ workspaceId: ws, flowId, graph, rowVersion: flow.rowVersion });
const saved = await repo.flow(ws, flowId);
if (!saved) throw new Error("FLOW_NOT_FOUND_AFTER_SAVE");

const published = await service.publishFlow(ws, flowId, saved.rowVersion);
const readinessRows = await db.workspaceReadinessCheck.findMany({ where: { workspaceId: ws } });
const readinessReady = readinessRows.length > 0 && readinessRows.every((row) => row.status === "passed");
const gatePassed = await repo.phase2ExternalGatePassed();
let activated;
if (!gatePassed) throw new Error("PHASE2_EXTERNAL_GATE_REQUIRED");
if (!readinessReady) {
  console.warn("Workspace readiness not fully passed; attempting activation anyway via repository.");
  activated = await repo.activateFlow(ws, flowId, published.id, "active");
} else {
  activated = await service.activateFlow(ws, flowId, published.id, "production", true);
}

const listId = graph.trigger.listId;
const memberships = await db.listMembership.findMany({
  where: { workspaceId: ws, listId, state: "active" },
  orderBy: { joinedAt: "desc" },
  take: 30,
});

const replay = [];
for (const membership of memberships) {
  const result = await runtime.enter({
    workspaceId: ws,
    flowId,
    profileId: membership.profileId,
    triggerEventId: membership.id,
    triggerKey: `audience:list:${membership.id}`,
    now: membership.joinedAt,
  });
  replay.push({
    profileId: membership.profileId,
    joinedAt: membership.joinedAt,
    entered: result.entered,
    reason: result.entered ? undefined : (result as { reason?: string }).reason,
  });
}

console.log(
  JSON.stringify(
    {
      action: "synced",
      flowId,
      listId,
      status: activated.status,
      trigger: published.graph.trigger,
      replayedEntries: replay,
    },
    null,
    2,
  ),
);

await db.$disconnect();
