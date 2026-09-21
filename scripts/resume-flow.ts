import { PrismaClient } from "@prisma/client";
import { Phase3RuntimeService } from "../packages/application/src/phase3/phase3-runtime-service.js";
import { PrismaPhase3Repository } from "../packages/persistence/src/prisma/phase3-repository.js";
import {
  PrismaFlowRuleEvaluationPort,
  PrismaPhase2FlowMessagePort,
} from "../packages/persistence/src/prisma/phase3-runtime-adapters.js";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = process.argv[3] ?? "53baaab5-b259-4808-a311-e842a241b727";

const repo = new PrismaPhase3Repository(db);
const runtime = new Phase3RuntimeService(
  repo,
  new PrismaPhase2FlowMessagePort(db),
  new PrismaFlowRuleEvaluationPort(db),
);

const result = await runtime.resume({ workspaceId: ws, flowId, overduePolicy: "immediate" });
const flow = await repo.flow(ws, flowId);
console.log(JSON.stringify({ resume: result, status: flow?.status, entryState: flow?.entryState }, null, 2));

await db.$disconnect();
