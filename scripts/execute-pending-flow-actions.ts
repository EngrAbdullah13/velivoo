import { PrismaClient } from "@prisma/client";
import { PrismaPhase3Repository } from "../packages/persistence/src/prisma/phase3-repository.js";
import { Phase3RuntimeService } from "../packages/application/src/phase3/phase3-runtime-service.js";
import {
  PrismaFlowRuleEvaluationPort,
  PrismaPhase2FlowMessagePort,
} from "../packages/persistence/src/prisma/phase3-runtime-adapters.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const db = new PrismaClient();
const repo = new PrismaPhase3Repository(db);
const runtime = new Phase3RuntimeService(repo, new PrismaPhase2FlowMessagePort(db), new PrismaFlowRuleEvaluationPort(db));

const results: Array<{ actionId: string; status: string; error?: string }> = [];
for (let round = 0; round < 20; round++) {
  const claimed = await runtime.dispatchDue({
    now: new Date(),
    leaseOwner: `execute-script:${process.pid}`,
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

const messages = await db.message.findMany({
  where: { workspaceId: ws, sourceType: "flow" },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, profileId: true, state: true, policyDecision: true, createdAt: true, submittedAt: true },
});

const runs = await db.flowRun.findMany({
  where: { workspaceId: ws, flowId: "53baaab5-b259-4808-a311-e842a241b727" },
  orderBy: { enteredAt: "desc" },
  take: 5,
  select: { id: true, profileId: true, state: true, enteredAt: true, exitReason: true },
});

console.log(JSON.stringify({ executed: results, runs, messages }, null, 2));
await db.$disconnect();
