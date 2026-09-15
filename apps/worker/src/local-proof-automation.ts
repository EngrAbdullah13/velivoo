import { PrismaClient } from "@prisma/client";
import { PrismaPhase3Repository } from "../../../packages/persistence/src/prisma/phase3-repository.js";
import { PrismaFlowRuleEvaluationPort, PrismaPhase2FlowMessagePort } from "../../../packages/persistence/src/prisma/phase3-runtime-adapters.js";
import { Phase3RuntimeService } from "../../../packages/application/src/phase3/phase3-runtime-service.js";
import { PrismaPhase2Repository } from "../../../packages/persistence/src/prisma/phase2-repository.js";
import { Phase2Service } from "../../../packages/application/src/phase2/phase2-service.js";
import { LocalObjectStore } from "../../../packages/object-store/src/local-object-store.js";
import { DisabledEmailProvider } from "../../../packages/provider-email/src/disabled-email-provider.js";
import { SesEmailProvider } from "../../../packages/provider-email/src/ses/ses-provider.js";
import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";
import { loadEmailPlatformConfig } from "../../../packages/config/src/env.js";

// Local proof mode intentionally uses PostgreSQL as the durable queue.  This
// lets a developer exercise real Flow entry, scheduled actions, Message
// Policy, rendering and SES submission without pretending Redis is available.
// It is never started in production; production uses the queue workers.
const config = loadEmailPlatformConfig();
if (config.runtimeMode === "production") throw new Error("LOCAL_PROOF_AUTOMATION_NOT_ALLOWED_IN_PRODUCTION");

const db = new PrismaClient();
const phase3Repo = new PrismaPhase3Repository(db);
const runtime = new Phase3RuntimeService(phase3Repo, new PrismaPhase2FlowMessagePort(db), new PrismaFlowRuleEvaluationPort(db));
const phase2Repo = new PrismaPhase2Repository(db);
const objects = new LocalObjectStore(process.env.EMAIL_PLATFORM_OBJECT_ROOT ?? ".local/objects");
const provider: EmailDeliveryProvider = config.emailProvider === "ses" && config.emailSendEnabled
  ? new SesEmailProvider(config.awsSesRegion ?? "", config.sesConfigurationSet, config.sesSupportedRegions)
  : new DisabledEmailProvider();
const delivery = new Phase2Service(phase2Repo, objects, provider, {
  publicBaseUrl: process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? "http://localhost:4001",
  unsubscribeSecret: process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET ?? "change-this-development-unsubscribe-secret-123456",
  trackingSecret: process.env.EMAIL_PLATFORM_TRACKING_SIGNING_SECRET ?? "change-this-development-tracking-secret-123456789",
  maxMessageBytes: Number(process.env.EMAIL_PLATFORM_MAX_MESSAGE_BYTES ?? 500000),
  providerReady: provider.name !== "disabled",
  requireWorkspaceConfigurationSet: false,
  unsubscribePublicBaseOnly: config.runtimeMode !== "production",
});

async function markPublished(id: string) {
  await (db as any).outboxEvent.updateMany({ where: { id, publishedAt: null }, data: { publishedAt: new Date(), attemptCount: { increment: 1 }, lastError: null } });
}

async function recordFailure(id: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  await (db as any).outboxEvent.updateMany({ where: { id, publishedAt: null }, data: { attemptCount: { increment: 1 }, lastError: detail.slice(0, 500) } });
}

async function routeListJoin(workspaceId: string, membershipId: string) {
  const membership = await (db as any).listMembership.findFirst({ where: { workspaceId, id: membershipId, state: "active" } });
  if (!membership) return;
  const dependencies = await (db as any).flowTriggerDependency.findMany({ where: { workspaceId, triggerType: "list_joined", referenceId: membership.listId } });
  for (const dependency of dependencies) {
    const flow = await phase3Repo.flow(workspaceId, dependency.flowId);
    const joinedAt = new Date(membership.joinedAt);
    if (!flow || !["active", "testing"].includes(flow.status) || flow.activeVersionId !== dependency.flowVersionId || !flow.activeVersionActivatedAt || new Date(flow.activeVersionActivatedAt) > joinedAt) continue;
    await runtime.enter({ workspaceId, flowId: flow.id, profileId: membership.profileId, triggerEventId: membership.id, triggerKey: `audience:list:${membership.id}`, now: joinedAt });
  }
}

async function dispatchOutbox() {
  const rows = await (db as any).outboxEvent.findMany({ where: { publishedAt: null, eventType: { in: ["phase3.audience.list.entered", "phase2.message.policy"] } }, orderBy: { createdAt: "asc" }, take: 200 });
  for (const row of rows) {
    try {
      const payload = row.payloadJson as any;
      if (row.eventType === "phase3.audience.list.entered") {
        await routeListJoin(row.workspaceId, String(payload?.membershipId ?? row.aggregateId));
        await markPublished(row.id);
        continue;
      }
      const message = await (db as any).message.findFirst({ where: { workspaceId: row.workspaceId, id: String(payload?.messageId ?? row.aggregateId) }, select: { id: true, sourceType: true } });
      if (!message || !["flow", "test"].includes(message.sourceType)) continue;
      const decision = await delivery.evaluatePolicy(row.workspaceId, message.id);
      if (decision.outcome === "allow") {
        await delivery.renderMessage(row.workspaceId, message.id);
        await delivery.submitMessage(row.workspaceId, message.id);
      }
      await markPublished(row.id);
    } catch (error) {
      await recordFailure(row.id, error);
      console.error(JSON.stringify({ service: "local-proof-automation", event: "outbox.failed", outboxId: row.id, diagnostic: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN" }));
    }
  }
}

async function dispatchActions() {
  const actions = await runtime.dispatchDue({ now: new Date(), leaseOwner: `local-proof:${process.pid}`, leaseMs: 30_000, limit: 200 });
  for (const action of actions) await runtime.executeAction(action, new Date());
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await dispatchOutbox();
    await dispatchActions();
    await dispatchOutbox();
  } finally {
    running = false;
  }
}

const timer = setInterval(() => void tick().catch(error => console.error(JSON.stringify({ service: "local-proof-automation", event: "tick.failed", diagnostic: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN" }))), 1000);
void tick();
console.log(JSON.stringify({ worker: "local-proof-automation", status: "running", provider: provider.name }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => { clearInterval(timer); await db.$disconnect(); process.exit(0); });
