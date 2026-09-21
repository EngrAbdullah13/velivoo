import { PrismaClient } from "@prisma/client";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";
import { PrismaPhase2Repository } from "../packages/persistence/src/prisma/phase2-repository.js";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";
import { DisabledEmailProvider } from "../packages/provider-email/src/disabled-email-provider.js";
import { SesEmailProvider } from "../packages/provider-email/src/ses/ses-provider.js";
import { confirmDeliveryWithoutFeedback, loadEmailPlatformConfig } from "../packages/config/src/env.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
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

const pending = await db.message.findMany({
  where: {
    workspaceId: ws,
    sourceType: "flow",
    state: { in: ["created", "held", "rendered", "submitted"] },
    flowRunId: { not: null },
  },
  orderBy: { createdAt: "desc" },
  take: 20,
});

const results = [];
for (const message of pending) {
  let state = message.state;
  try {
    if (state === "created" || state === "held") {
      const decision = await service.evaluatePolicy(ws, message.id);
      if (decision.outcome !== "allow") {
        results.push({ id: message.id, state, after: decision.outcome, reason: decision.reason });
        continue;
      }
      state = "allowed";
    }
    if (state === "created" || state === "held" || state === "allowed") {
      await service.renderMessage(ws, message.id);
      state = "rendered";
    }
    if (state === "rendered") {
      const submitted = await service.submitMessage(ws, message.id);
      state = submitted?.state ?? "unknown";
    }
    if (state === "submitted" && confirmDeliveryWithoutFeedback(config)) {
      const attempt = await db.deliveryAttempt.findFirst({
        where: { messageId: message.id, providerMessageId: { not: null } },
        orderBy: { attemptNumber: "desc" },
      });
      if (attempt?.providerMessageId) {
        const events = await db.deliveryEvent.count({ where: { messageId: message.id } });
        if (events === 0) {
          const feedback = await service.applyFeedback({
            provider: "ses",
            providerMessageId: attempt.providerMessageId,
            providerEventId: `flush-delivery:${message.id}`,
            eventType: "delivery",
            occurredAt: new Date().toISOString(),
            metadata: { synthetic: true, platformMessageId: message.id, flush: true },
          });
          state = feedback.state ?? state;
        }
      }
    }
    results.push({ id: message.id, after: state });
  } catch (error) {
    results.push({
      id: message.id,
      after: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ processed: results }, null, 2));
await db.$disconnect();
