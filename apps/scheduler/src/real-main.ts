import { randomUUID } from "node:crypto";
import { config } from "../../../packages/config/src/env.js";
import { closePrisma, prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";
import { enqueueFeedbackInbox, enqueueScheduledAction, phase0Queue } from "../../../packages/queue/src/bullmq/phase0-runtime.js";

if (!config.redisUrl) throw new Error("REDIS_URL_REQUIRED");
const owner = `scheduler:${process.pid}:${randomUUID()}`;
const leaseMs = Number(process.env.EMAIL_PLATFORM_SCHEDULER_LEASE_MS ?? "5000");
const { queue, connection } = phase0Queue(config.redisUrl);

async function dispatchOnce(): Promise<number> {
  const now = new Date();
  const due = await prisma.scheduledAction.findMany({
    where: {
      // Flow steps are executed by the Phase 3 runtime (local-proof or phase3 worker).
      actionType: { notIn: ["sender_domain.verify", "flow.node"] },
      dueAt: { lte: now },
      OR: [
        { state: "pending" },
        { state: "leased", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
  let count = 0;
  for (const action of due) {
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    const claimed = await prisma.scheduledAction.updateMany({
      where: {
        id: action.id,
        workspaceId: action.workspaceId,
        OR: [
          { state: "pending" },
          { state: "leased", leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        state: "leased",
        leaseOwner: owner,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    await enqueueScheduledAction(queue, {
      workspaceId: action.workspaceId,
      actionId: action.id,
      correlationId: action.aggregateId,
      attempt: action.attemptCount + 1,
    });
    count += 1;
  }
  return count;
}

async function dispatchFeedbackOnce(): Promise<number> {
  const pending = await prisma.inboxMessage.findMany({
    where: { source: "ses", status: "received", workspaceId: { not: null } },
    orderBy: { receivedAt: "asc" },
    take: 100,
  });
  let count = 0;
  for (const inbox of pending) {
    if (!inbox.workspaceId) continue;
    const payload = inbox.payloadJson as any;
    const correlationId = typeof payload?.messageId === "string" ? payload.messageId : inbox.id;
    try {
      await enqueueFeedbackInbox(queue, {
        workspaceId: inbox.workspaceId,
        inboxId: inbox.id,
        correlationId,
      });
      count += 1;
    } catch (error) {
      // Redis is dispatch only. Keep the inbox row in `received` so a later
      // reconciliation pass can recover it.
      console.error("feedback dispatch deferred", { inboxId: inbox.id, error });
    }
  }
  return count;
}

try {
  if (process.argv.includes("--once")) {
    console.log(JSON.stringify({ scheduledDispatched: await dispatchOnce(), feedbackDispatched: await dispatchFeedbackOnce() }));
  } else {
    console.log(JSON.stringify({ scheduler: "started", owner, leaseMs }));
    await dispatchOnce();
    await dispatchFeedbackOnce();
    setInterval(() => void Promise.all([dispatchOnce(), dispatchFeedbackOnce()]).then(([scheduledDispatched, feedbackDispatched]) => {
      if (scheduledDispatched || feedbackDispatched) console.log(JSON.stringify({ scheduledDispatched, feedbackDispatched }));
    }).catch(console.error), 1000);
    await new Promise(() => {});
  }
} finally {
  if (process.argv.includes("--once")) {
    await queue.close();
    await connection.quit();
    await closePrisma();
  }
}
