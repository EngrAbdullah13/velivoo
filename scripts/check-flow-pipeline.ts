import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowId = "53baaab5-b259-4808-a311-e842a241b727";

const flow = await db.flow.findFirst({ where: { id: flowId } });
const runs = await db.flowRun.findMany({
  where: { workspaceId: ws, flowId },
  orderBy: { enteredAt: "desc" },
  take: 6,
});
const runIds = runs.map((r) => r.id);
const actions = await db.scheduledAction.findMany({
  where: { workspaceId: ws, flowRunId: { in: runIds } },
  orderBy: { createdAt: "desc" },
});
const messages = await db.message.findMany({
  where: { workspaceId: ws, flowRunId: { in: runIds } },
  orderBy: { createdAt: "desc" },
});
const outbox = await db.outboxEvent.findMany({
  where: { workspaceId: ws, publishedAt: null },
  orderBy: { createdAt: "desc" },
  take: 5,
});

console.log(
  JSON.stringify(
    {
      flow: {
        status: flow?.status,
        activeVersionId: flow?.activeVersionId,
        entryState: flow?.entryState,
      },
      runs,
      actions,
      messages,
      pendingOutbox: outbox,
    },
    null,
    2,
  ),
);

await db.$disconnect();
