import { PrismaClient } from "@prisma/client";
import { PrismaPhase3Repository } from "../packages/persistence/src/prisma/phase3-repository.js";
import { Phase3RuntimeService } from "../packages/application/src/phase3/phase3-runtime-service.js";
import {
  PrismaFlowRuleEvaluationPort,
  PrismaPhase2FlowMessagePort,
} from "../packages/persistence/src/prisma/phase3-runtime-adapters.js";
import { Phase3JobQueue } from "../packages/queue/src/bullmq/phase3-job-queue.js";
import { Phase2JobQueue } from "../packages/queue/src/bullmq/phase2-job-queue.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL_REQUIRED");

const db = new PrismaClient();
const repo = new PrismaPhase3Repository(db);
const runtime = new Phase3RuntimeService(repo, new PrismaPhase2FlowMessagePort(db), new PrismaFlowRuleEvaluationPort(db));
const phase3Queue = new Phase3JobQueue(redisUrl);
const phase2Queue = new Phase2JobQueue(redisUrl);

const now = new Date();
const claimed = await runtime.dispatchDue({ now, leaseOwner: `script:${process.pid}`, leaseMs: 30000, limit: 50 });
const phase3Results = [];
for (const action of claimed) {
  await phase3Queue.enqueue({ type: "phase3.flow.execute", workspaceId: action.workspaceId, actionId: action.id });
  phase3Results.push(action.id);
}

const outbox = await db.outboxEvent.findMany({
  where: { workspaceId: ws, publishedAt: null, eventType: { in: ["phase2.message.policy", "phase3.audience.list.entered"] } },
  orderBy: { createdAt: "asc" },
  take: 50,
});
let dispatchedOutbox = 0;
for (const row of outbox) {
  const payload = row.payloadJson as Record<string, unknown>;
  if (row.eventType === "phase2.message.policy") {
    await phase2Queue.enqueue({
      type: "phase2.message.policy",
      workspaceId: row.workspaceId,
      messageId: String(payload.messageId ?? row.aggregateId),
    });
  } else {
    await phase3Queue.enqueue({
      type: "phase3.audience.transition",
      workspaceId: row.workspaceId,
      transitionId: String(payload.membershipId ?? row.aggregateId),
      audienceType: "list",
    });
  }
  await db.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: now, lastError: null } });
  dispatchedOutbox++;
}

const messages = await db.message.findMany({
  where: { workspaceId: ws, sourceType: "flow" },
  orderBy: { createdAt: "desc" },
  take: 10,
  select: { id: true, profileId: true, state: true, policyDecision: true, createdAt: true, submittedAt: true },
});

console.log(JSON.stringify({ claimedActions: phase3Results.length, actionIds: phase3Results, dispatchedOutbox, messages }, null, 2));

await phase3Queue.close();
await phase2Queue.close();
await db.$disconnect();
