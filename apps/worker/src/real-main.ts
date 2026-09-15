import { config } from "../../../packages/config/src/env.js";
import { closePrisma, prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";
import { phase0Queue, phase0Worker } from "../../../packages/queue/src/bullmq/phase0-runtime.js";
import { SesEmailProvider } from "../../../packages/provider-email/src/ses/ses-provider.js";
import { FakeEmailProvider } from "../../../packages/provider-email/src/proof/fake-email-provider.js";
import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";
import { processFlowNode } from "./real-flow-node.js";
import { processScheduled } from "./real-executor.js";
import { processFeedbackInbox } from "./real-feedback.js";

if (!config.redisUrl) throw new Error("REDIS_URL_REQUIRED");
const provider: EmailDeliveryProvider = config.emailSendEnabled
  ? new SesEmailProvider(config.awsRegion, config.sesConfigurationSet, config.sesSupportedRegions)
  : new FakeEmailProvider();
let processed = 0;
const { worker, connection } = phase0Worker(config.redisUrl, async (job) => {
  let result: Record<string, unknown>;
  if (job.data.jobType === "scheduled.execute") {
    const action = await prisma.scheduledAction.findFirst({
      where: { id: job.data.resourceId, workspaceId: job.data.workspaceId },
      select: { actionType: true },
    });
    result = action?.actionType === "flow.node"
      ? await processFlowNode(job.data.workspaceId, job.data.resourceId)
      : await processScheduled(provider, job.data.workspaceId, job.data.resourceId);
  } else if (job.data.jobType === "feedback.apply") {
    result = await processFeedbackInbox(job.data.workspaceId, job.data.resourceId);
  } else {
    return { ignored: job.data.jobType };
  }
  processed += 1;
  console.log(JSON.stringify({ processed, jobId: job.id, jobType: job.data.jobType, ...result }));
  return result;
}, 2);

if (process.argv.includes("--once")) {
  const timeoutMs = Number(process.env.EMAIL_PLATFORM_WORKER_ONCE_TIMEOUT_MS ?? "10000");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const probe = phase0Queue(config.redisUrl);
    const counts = await probe.queue.getJobCounts("waiting", "active", "delayed");
    await probe.queue.close();
    await probe.connection.quit();
    if ((counts.waiting ?? 0) === 0 && (counts.active ?? 0) === 0 && processed > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await worker.close();
  await connection.quit();
  await closePrisma();
  console.log(JSON.stringify({ worker: "stopped", processed, provider: provider.name }));
} else {
  console.log(JSON.stringify({ worker: "started", provider: provider.name }));
  await new Promise(() => {});
}
