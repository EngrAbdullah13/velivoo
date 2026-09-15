import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { JobEnvelope } from "../../../contracts/src/types.js";

export const PHASE0_QUEUE_NAME = "phase0.dispatch";

export function redisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function phase0Queue(redisUrl: string): { queue: Queue<JobEnvelope>; connection: IORedis } {
  const connection = redisConnection(redisUrl);
  return { queue: new Queue<JobEnvelope>(PHASE0_QUEUE_NAME, { connection }), connection };
}

export function phase0ProducerQueue(redisUrl: string): { queue: Queue<JobEnvelope>; connection: IORedis } {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    connectTimeout: 1000,
  });
  return { queue: new Queue<JobEnvelope>(PHASE0_QUEUE_NAME, { connection }), connection };
}

export async function enqueueScheduledAction(queue: Queue<JobEnvelope>, input: { workspaceId: string; actionId: string; correlationId: string; attempt: number }): Promise<void> {
  const envelope: JobEnvelope = {
    jobType: "scheduled.execute",
    jobVersion: 1,
    jobId: input.actionId,
    workspaceId: input.workspaceId,
    resourceType: "scheduled_action",
    resourceId: input.actionId,
    correlationId: input.correlationId,
    enqueuedAt: new Date().toISOString(),
    attempt: input.attempt,
  };
  await queue.add(envelope.jobType, envelope, {
    // BullMQ 6.x requires exactly three colon segments when jobId contains ':'.
    jobId: `${envelope.jobType}:${envelope.jobId}:${envelope.attempt}`,
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 1,
  });
}

export async function enqueueFeedbackInbox(queue: Queue<JobEnvelope>, input: { workspaceId: string; inboxId: string; correlationId: string; attempt?: number }): Promise<void> {
  const envelope: JobEnvelope = {
    jobType: "feedback.apply",
    jobVersion: 1,
    jobId: input.inboxId,
    workspaceId: input.workspaceId,
    resourceType: "inbox_message",
    resourceId: input.inboxId,
    correlationId: input.correlationId,
    enqueuedAt: new Date().toISOString(),
    attempt: input.attempt ?? 1,
  };
  // Stable BullMQ job ID is intentional: repeated callback/scheduler dispatches
  // for the same durable inbox item collapse to one queued job while the inbox
  // row remains the authoritative recovery source if Redis is lost.
  await queue.add(envelope.jobType, envelope, {
    // Stable three-segment ID collapses duplicate dispatches for the same inbox row.
    jobId: `${envelope.jobType}:${envelope.jobId}:1`,
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 500 },
  });
}

export function phase0Worker(redisUrl: string, processor: (job: Job<JobEnvelope>) => Promise<unknown>, concurrency = 2): { worker: Worker<JobEnvelope>; connection: IORedis } {
  const connection = redisConnection(redisUrl);
  const worker = new Worker<JobEnvelope>(PHASE0_QUEUE_NAME, processor, { connection, concurrency });
  return { worker, connection };
}
