import { Phase3RuntimeService } from "../../../packages/application/src/phase3/phase3-runtime-service.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";
import { PrismaPhase3Repository } from "../../../packages/persistence/src/prisma/phase3-repository.js";
import { PrismaFlowRuleEvaluationPort, PrismaPhase2FlowMessagePort } from "../../../packages/persistence/src/prisma/phase3-runtime-adapters.js";

let runtime: Phase3RuntimeService | null = null;

function flowRuntime(): Phase3RuntimeService {
  if (!runtime) {
    const repo = new PrismaPhase3Repository(prisma as any);
    runtime = new Phase3RuntimeService(repo, new PrismaPhase2FlowMessagePort(prisma as any), new PrismaFlowRuleEvaluationPort(prisma as any));
  }
  return runtime;
}

export async function processFlowNode(workspaceId: string, actionId: string): Promise<Record<string, unknown>> {
  const repo = new PrismaPhase3Repository(prisma as any);
  const action = await repo.scheduledAction(workspaceId, actionId);
  if (!action) throw new Error("SCHEDULED_ACTION_NOT_FOUND");
  const result = await flowRuntime().executeAction(action, new Date());
  return { outcome: result.status, ...result };
}
