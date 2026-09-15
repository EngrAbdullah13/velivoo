import { createHash, randomUUID } from "node:crypto";
import { config } from "../../../packages/config/src/env.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";
import { buildMessageIdempotencyKey } from "../../../packages/domain/src/message-idempotency.js";
import { renderProofEmail } from "../../../packages/email-renderer/src/render.js";
import { buildMime } from "../../../packages/email-renderer/src/mime-builder.js";
import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";

function p2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2002";
}

async function trace(workspaceId: string, aggregateType: string, aggregateId: string, kind: string, detail: Record<string, unknown>): Promise<void> {
  await prisma.traceEvent.create({ data: { workspaceId, aggregateType, aggregateId, kind, detailJson: detail } });
}

export async function processScheduled(provider: EmailDeliveryProvider, workspaceId: string, actionId: string): Promise<{ outcome: string; messageId?: string }> {
  const action = await prisma.scheduledAction.findFirst({ where: { id: actionId, workspaceId } });
  if (!action) throw new Error("SCHEDULED_ACTION_NOT_FOUND");
  if (action.state === "completed" || action.state === "cancelled") return { outcome: "already_final" };

  const payload = action.payloadJson as any;
  const run = await prisma.flowRun.findFirst({ where: { id: String(payload.flowRunId), workspaceId } });
  if (!run) throw new Error("FLOW_RUN_NOT_FOUND");
  const flowVersion = await prisma.flowVersion.findFirst({ where: { id: run.flowVersionId, workspaceId } });
  if (!flowVersion) throw new Error("FLOW_VERSION_NOT_FOUND");
  const graph = flowVersion.graphJson as any;
  const emailNode = Array.isArray(graph.nodes) ? graph.nodes.find((node: any) => node.id === payload.emailNodeId && node.type === "email") : undefined;
  if (!emailNode?.emailVersionId) throw new Error("EMAIL_NODE_NOT_FOUND");

  const [profile, emailVersion, workspace] = await Promise.all([
    prisma.profile.findFirst({ where: { id: run.profileId, workspaceId } }),
    prisma.emailVersion.findFirst({ where: { id: String(emailNode.emailVersionId), workspaceId } }),
    prisma.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  if (!profile || !emailVersion || !workspace) throw new Error("PHASE0_RUNTIME_DATA_MISSING");
  const sender = await prisma.senderIdentity.findFirst({ where: { id: emailVersion.senderIdentityId, workspaceId } });
  if (!sender) throw new Error("SENDER_IDENTITY_NOT_FOUND");

  const idempotencyKey = buildMessageIdempotencyKey({
    workspaceId,
    flowRunId: run.id,
    nodeId: String(emailNode.id),
    recipient: profile.normalizedEmail,
    emailVersionId: emailVersion.id,
  });

  let message = await prisma.message.findFirst({ where: { workspaceId, idempotencyKey } });
  if (!message) {
    try {
      message = await prisma.message.create({ data: {
        id: randomUUID(), workspaceId, sourceType: "flow", sourceId: run.flowId,
        flowRunId: run.id, nodeId: String(emailNode.id), profileId: profile.id,
        emailVersionId: emailVersion.id, idempotencyKey, state: "created", scheduledFor: action.dueAt,
      }});
      await trace(workspaceId, "message", message.id, "message.intent_created", { idempotencyKey });
    } catch (error) {
      if (!p2002(error)) throw error;
      message = await prisma.message.findFirst({ where: { workspaceId, idempotencyKey } });
      if (!message) throw error;
    }
  }

  if (["submitted", "delivered", "bounced", "complained", "skipped", "cancelled", "unknown"].includes(message.state)) {
    await prisma.scheduledAction.updateMany({ where: { id: action.id, workspaceId }, data: { state: "completed", completedAt: new Date(), leaseExpiresAt: null } });
    return { outcome: `message_${message.state}`, messageId: message.id };
  }

  const [latestConsent, suppressions] = await Promise.all([
    prisma.consentRecord.findFirst({ where: { workspaceId, profileId: profile.id, channel: "email", purpose: "marketing" }, orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }] }),
    prisma.suppression.findMany({ where: { workspaceId, profileId: profile.id, channel: "email", revokedAt: null } }),
  ]);
  const reasons: string[] = [];
  if (workspace.status !== "active") reasons.push("WORKSPACE_NOT_ACTIVE");
  if (config.emailSendEnabled && !workspace.sendingEnabled) reasons.push("WORKSPACE_SENDING_DISABLED");
  if (!sender.domainReady) reasons.push("SENDER_DOMAIN_NOT_READY");
  if (!latestConsent || latestConsent.status !== "granted") reasons.push("MARKETING_CONSENT_NOT_GRANTED");
  if (suppressions.length) reasons.push(...suppressions.map((s: any) => `SUPPRESSED_${String(s.reason).toUpperCase()}`));

  const policy = { outcome: reasons.length ? "skip" : "allow", reasons, evaluatedAt: new Date().toISOString(), policyVersion: 1 };
  await prisma.message.update({ where: { id: message.id }, data: { state: "evaluating", policyDecision: policy } });
  await trace(workspaceId, "message", message.id, "policy.evaluated", policy);
  if (reasons.length) {
    await prisma.$transaction([
      prisma.message.update({ where: { id: message.id }, data: { state: "skipped", finalAt: new Date() } }),
      prisma.scheduledAction.update({ where: { id: action.id }, data: { state: "completed", completedAt: new Date(), leaseExpiresAt: null } }),
      prisma.flowRun.update({ where: { id: run.id }, data: { state: "completed", currentNodeId: "end", endedAt: new Date(), exitReason: reasons.join(",") } }),
    ]);
    return { outcome: "skipped", messageId: message.id };
  }

  const rendered = renderProofEmail({
    workspace: {
      id: workspace.id, name: workspace.name, legalName: workspace.legalName,
      businessAddress: workspace.businessAddress, timezone: workspace.timezone,
      status: workspace.status as "active" | "paused", sendingEnabled: workspace.sendingEnabled,
      senderReady: workspace.senderReady, createdAt: workspace.createdAt.toISOString(),
    },
    profile: { id: profile.id, workspaceId, email: profile.normalizedEmail, firstName: profile.firstName ?? undefined, createdAt: profile.createdAt.toISOString() },
    version: {
      id: emailVersion.id, workspaceId, definitionId: emailVersion.emailDefinitionId,
      versionNumber: emailVersion.versionNumber, subjectTemplate: emailVersion.subjectTemplate,
      htmlTemplate: emailVersion.compiledHtml, textTemplate: emailVersion.compiledText,
      senderIdentityId: emailVersion.senderIdentityId, contentHash: emailVersion.contentHash,
      publishedAt: emailVersion.publishedAt.toISOString(),
    },
    sender: { id: sender.id, workspaceId, fromName: sender.fromName, fromEmail: sender.fromEmail, replyTo: sender.replyTo, domainReady: sender.domainReady },
    publicBaseUrl: config.publicBaseUrl,
    unsubscribeSecret: config.unsubscribeSecret,
  });
  const mime = buildMime({ fromName: sender.fromName, fromEmail: sender.fromEmail, replyTo: sender.replyTo, to: profile.normalizedEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: rendered.unsubscribeUrl });
  await prisma.message.update({ where: { id: message.id }, data: { state: "rendered", renderedHash: rendered.hash, renderedAt: new Date() } });
  await trace(workspaceId, "message", message.id, "message.rendered", { renderedHash: rendered.hash, oneClick: mime.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click") });

  const fingerprint = createHash("sha256").update(`${message.id}|${rendered.hash}`).digest("hex");
  let ownsSubmission = false;
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.deliveryAttempt.create({ data: {
        id: randomUUID(), workspaceId, messageId: message!.id, attemptNumber: 1,
        provider: provider.name, requestFingerprint: fingerprint, state: "submitting", submittedAt: new Date(),
      }});
      await tx.outboxEvent.create({ data: {
        id: randomUUID(), workspaceId, aggregateType: "message", aggregateId: message!.id,
        eventType: "message.provider_submission_started", payloadJson: { provider: provider.name, requestFingerprint: fingerprint },
      }});
    });
    ownsSubmission = true;
  } catch (error) {
    if (!p2002(error)) throw error;
  }

  if (!ownsSubmission) {
    const existingAttempt = await prisma.deliveryAttempt.findFirst({ where: { messageId: message.id, attemptNumber: 1 } });
    if (existingAttempt?.state === "submitting") {
      const ageMs = existingAttempt.submittedAt ? Date.now() - existingAttempt.submittedAt.getTime() : 0;
      if (ageMs > Number(process.env.EMAIL_PLATFORM_SUBMISSION_UNCERTAINTY_MS ?? "5000")) {
        await prisma.message.update({ where: { id: message.id }, data: { state: "unknown" } });
        await trace(workspaceId, "message", message.id, "provider.submission_uncertain", { reason: "stale_submitting_attempt", ageMs, policy: "do_not_blind_retry" });
      } else {
        await trace(workspaceId, "message", message.id, "provider.duplicate_job_held", { reason: "submission_attempt_already_in_progress", ageMs });
      }
    }
    return { outcome: "duplicate_job_no_submit", messageId: message.id };
  }

  const result = await provider.submit({ messageId: message.id, rawMime: mime, requestFingerprint: fingerprint });
  const attempt = await prisma.deliveryAttempt.findFirstOrThrow({ where: { messageId: message.id, attemptNumber: 1 } });
  if (result.status === "submitted") {
    await prisma.$transaction([
      prisma.deliveryAttempt.update({ where: { id: attempt.id }, data: { state: "submitted", providerMessageId: result.providerMessageId, responseAt: new Date() } }),
      prisma.message.update({ where: { id: message.id }, data: { state: "submitted", submittedAt: new Date() } }),
      prisma.scheduledAction.update({ where: { id: action.id }, data: { state: "completed", completedAt: new Date(), leaseExpiresAt: null } }),
      prisma.flowRun.update({ where: { id: run.id }, data: { state: "completed", currentNodeId: "end", endedAt: new Date() } }),
    ]);
    await trace(workspaceId, "message", message.id, "provider.submitted", { provider: provider.name, providerMessageId: result.providerMessageId });
    return { outcome: "submitted", messageId: message.id };
  }
  if (result.status === "unknown") {
    await prisma.$transaction([
      prisma.deliveryAttempt.update({ where: { id: attempt.id }, data: { state: "unknown", responseAt: new Date() } }),
      prisma.message.update({ where: { id: message.id }, data: { state: "unknown" } }),
      prisma.scheduledAction.update({ where: { id: action.id }, data: { state: "completed", completedAt: new Date(), leaseExpiresAt: null } }),
    ]);
    await trace(workspaceId, "message", message.id, "provider.unknown", { provider: provider.name, policy: "do_not_blind_retry" });
    return { outcome: "unknown", messageId: message.id };
  }

  await prisma.$transaction([
    prisma.deliveryAttempt.update({ where: { id: attempt.id }, data: { state: "failed", responseAt: new Date(), errorCode: result.code } }),
    prisma.message.update({ where: { id: message.id }, data: { state: "failed", finalAt: new Date() } }),
    prisma.scheduledAction.update({ where: { id: action.id }, data: { state: "completed", completedAt: new Date(), leaseExpiresAt: null } }),
  ]);
  await trace(workspaceId, "message", message.id, "provider.failed", { provider: provider.name, code: result.code, retryable: result.retryable });
  return { outcome: "failed", messageId: message.id };
}

