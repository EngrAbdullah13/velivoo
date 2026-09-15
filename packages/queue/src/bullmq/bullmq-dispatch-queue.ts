// Real local/production adapter. Requires `npm install` and local Redis.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobEnvelope } from "../../../contracts/src/types.js";

export class BullMqDispatchQueue {
  private readonly connection: IORedis;
  private readonly queue: Queue<JobEnvelope>;

  constructor(redisUrl: string) {
    // BullMQ recommends maxRetriesPerRequest=null for worker/queue connections.
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<JobEnvelope>("phase0.dispatch", { connection: this.connection });
  }

  async enqueue(job: JobEnvelope): Promise<void> {
    // The queue job ID is only a dispatch identity. Business idempotency is enforced by PostgreSQL message keys.
    await this.queue.add(job.jobType, job, { jobId: `${job.jobType}:${job.jobId}:${job.attempt}`, removeOnComplete: 1000, attempts: 1 });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
