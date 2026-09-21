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

const held = await db.message.findMany({
  where: { workspaceId: ws, state: "held", sourceType: { in: ["flow", "manual", "campaign"] } },
  orderBy: { createdAt: "desc" },
  take: 20,
  select: { id: true, profileId: true, policyDecision: true, createdAt: true },
});

const results: Array<{ id: string; before: string; after: string; reason?: string }> = [];

for (const message of held) {
  const decision = await service.evaluatePolicy(ws, message.id);
  let after = decision.outcome;
  if (decision.outcome === "allow") {
    await service.renderMessage(ws, message.id);
    const submitted = await service.submitMessage(ws, message.id);
    after = submitted?.state ?? "unknown";
  }
  results.push({
    id: message.id,
    before: "held",
    after,
    reason: decision.reason,
  });
}

console.log(JSON.stringify({ workspaceId: ws, processed: results.length, results }, null, 2));
await db.$disconnect();
