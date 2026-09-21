import { PrismaClient } from "@prisma/client";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";
import { PrismaPhase2Repository } from "../packages/persistence/src/prisma/phase2-repository.js";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";
import { DisabledEmailProvider } from "../packages/provider-email/src/disabled-email-provider.js";
import { SesEmailProvider } from "../packages/provider-email/src/ses/ses-provider.js";
import { confirmDeliveryWithoutFeedback, loadEmailPlatformConfig } from "../packages/config/src/env.js";

const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const db = new PrismaClient();
const config = loadEmailPlatformConfig();
const repo = new PrismaPhase2Repository(db);
const objects = new LocalObjectStore(process.env.EMAIL_PLATFORM_OBJECT_ROOT ?? ".local/objects");
const provider =
  config.emailProvider === "ses" && config.emailSendEnabled
    ? new SesEmailProvider(
        config.awsSesRegion ?? "",
        config.runtimeMode === "production" ? undefined : config.sesConfigurationSet,
        config.sesSupportedRegions,
      )
    : new DisabledEmailProvider();
const service = new Phase2Service(repo, objects, provider, {
  publicBaseUrl: process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001",
  unsubscribeSecret: process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET ?? "change-this-development-unsubscribe-secret-123456",
  trackingSecret: process.env.EMAIL_PLATFORM_TRACKING_SIGNING_SECRET ?? "change-this-development-tracking-secret-123456789",
  maxMessageBytes: Number(process.env.EMAIL_PLATFORM_MAX_MESSAGE_BYTES ?? 500000),
  providerReady: provider.name !== "disabled",
  requireWorkspaceConfigurationSet: config.runtimeMode === "production",
  unsubscribePublicBaseOnly: config.runtimeMode !== "production",
  confirmDeliveryWithoutFeedback: confirmDeliveryWithoutFeedback(config),
});

const activePolicy = await repo.activeSendPolicy(ws);
const actor =
  (
    await db.workspaceMember.findFirst({
      where: { workspaceId: ws },
      select: { userId: true },
    })
  )?.userId ?? "00000000-0000-4000-8000-000000000001";
if (activePolicy.frequencyMax < 20) {
  await repo.saveSendPolicy(ws, actor, {
    version: activePolicy.version + 1,
    frequencyWindowSeconds: activePolicy.frequencyWindowSeconds,
    frequencyMax: 20,
    quietHours: activePolicy.quietHours,
    warmingDailyLimit: activePolicy.warmingDailyLimit,
    feedbackStaleAfterSeconds: activePolicy.feedbackStaleAfterSeconds,
  });
}

const submitted = await db.message.findMany({
  where: { workspaceId: ws, state: "submitted" },
  orderBy: { submittedAt: "desc" },
  take: 50,
});

const backfilled = [];
for (const message of submitted) {
  const events = await db.deliveryEvent.count({ where: { messageId: message.id } });
  if (events > 0) continue;
  const attempt = await db.deliveryAttempt.findFirst({
    where: { messageId: message.id, providerMessageId: { not: null } },
    orderBy: { attemptNumber: "desc" },
  });
  if (!attempt?.providerMessageId) continue;
  const result = await service.applyFeedback({
    provider: "ses",
    providerMessageId: attempt.providerMessageId,
    providerEventId: `backfill-delivery:${message.id}`,
    eventType: "delivery",
    occurredAt: (message.submittedAt ?? new Date()).toISOString(),
    metadata: { synthetic: true, platformMessageId: message.id, backfill: true },
  });
  backfilled.push({ messageId: message.id, applied: result.applied, state: result.state });
}

const held = await db.message.findMany({
  where: { workspaceId: ws, state: "held", sourceType: { in: ["flow", "manual", "campaign"] } },
  orderBy: { createdAt: "desc" },
  take: 30,
});

const reprocessed = [];
for (const message of held) {
  const decision = await service.evaluatePolicy(ws, message.id);
  let after = decision.outcome;
  if (decision.outcome === "allow") {
    await service.renderMessage(ws, message.id);
    const submittedMessage = await service.submitMessage(ws, message.id);
    after = submittedMessage?.state ?? "unknown";
  }
  reprocessed.push({
    id: message.id,
    before: "held",
    after,
    reason: decision.reason,
  });
}

console.log(
  JSON.stringify(
    {
      workspaceId: ws,
      confirmDeliveryWithoutFeedback: confirmDeliveryWithoutFeedback(config),
      snsConfigured: Boolean(process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN),
      frequencyMax: (await repo.activeSendPolicy(ws)).frequencyMax,
      backfilled,
      reprocessed,
    },
    null,
    2,
  ),
);

await db.$disconnect();
