import { createHash, randomUUID } from "node:crypto";
import type { EmailDeliveryProvider } from "./ports/email-delivery-provider.js";
import type { JobEnvelope, NormalizedProviderFeedback } from "../../contracts/src/types.js";
import type { ConsentRecord, EmailVersion, FlowVersion, Message, ScheduledAction, SenderIdentity, Suppression, Workspace } from "../../domain/src/entities.js";
import { isPlausibleEmail, normalizeEmail } from "../../domain/src/email.js";
import { buildMessageIdempotencyKey } from "../../domain/src/message-idempotency.js";
import { validateFlowGraph } from "../../domain/src/flow-validator.js";
import { projectProviderFeedbackState, isProviderTerminalState } from "../../domain/src/delivery-state.js";
import { renderProofEmail } from "../../email-renderer/src/render.js";
import { buildMime } from "../../email-renderer/src/mime-builder.js";
import type { ProofStore } from "../../persistence/src/proof/proof-store.js";
import type { FileDispatchQueue } from "../../queue/src/proof/file-queue.js";

export interface ProofBootstrap {
  workspaceId: string; profileId: string; flowVersionId: string; emailVersionId: string; senderIdentityId: string;
}

export class Phase0Service {
  constructor(
    private readonly store: ProofStore,
    private readonly queue: FileDispatchQueue,
    private readonly provider: EmailDeliveryProvider,
    private readonly settings: { publicBaseUrl: string; unsubscribeSecret: string; emailSendEnabled: boolean },
    private readonly now: () => Date = () => new Date(),
  ) {}

  bootstrap(): ProofBootstrap {
    this.store.reset(); this.queue.clear();
    const now = this.now().toISOString();
    const workspace: Workspace = { id: randomUUID(), name: "Phase 0 Workspace", legalName: "Phase 0 Test Business", businessAddress: "123 Test Street, Test City", timezone: "UTC", status: "active", sendingEnabled: true, senderReady: true, createdAt: now };
    this.store.addWorkspace(workspace);
    const profile = { id: randomUUID(), workspaceId: workspace.id, email: normalizeEmail("phase0-recipient@example.com"), firstName: "Phase", createdAt: now };
    this.store.addProfile(profile);
    const consent: ConsentRecord = { id: randomUUID(), workspaceId: workspace.id, profileId: profile.id, channel: "email", purpose: "marketing", status: "granted", source: "phase0_fixture", occurredAt: now, recordedAt: now };
    this.store.addConsent(consent);
    const sender: SenderIdentity = { id: randomUUID(), workspaceId: workspace.id, fromName: "Phase 0 Test", fromEmail: "marketing@example.com", replyTo: "support@example.com", domainReady: true };
    this.store.addSenderIdentity(sender);
    const email: EmailVersion = { id: randomUUID(), workspaceId: workspace.id, definitionId: randomUUID(), versionNumber: 1, subjectTemplate: "Phase 0 delivery proof for {{ profile.first_name }}", htmlTemplate: "<h1>Hello {{ profile.first_name }}</h1><p>This is the Phase 0 delivery proof.</p>", textTemplate: "Hello {{ profile.first_name }}\n\nThis is the Phase 0 delivery proof.", senderIdentityId: sender.id, contentHash: createHash("sha256").update("phase0-email-v1").digest("hex"), publishedAt: now };
    this.store.addEmailVersion(email);
    const flowId = randomUUID();
    const graph = { nodes: [{id:"trigger",type:"trigger" as const},{id:"delay",type:"delay" as const,durationMs:1000},{id:"email",type:"email" as const,emailVersionId:email.id},{id:"end",type:"end" as const}], edges: [{from:"trigger",to:"delay"},{from:"delay",to:"email"},{from:"email",to:"end"}] };
    const issues = validateFlowGraph(graph); if (issues.length) throw new Error(`BOOTSTRAP_FLOW_INVALID:${JSON.stringify(issues)}`);
    const flow: FlowVersion = { id: randomUUID(), workspaceId: workspace.id, flowId, versionNumber: 1, graph, graphHash: createHash("sha256").update(JSON.stringify(graph)).digest("hex"), publishedAt: now };
    this.store.addFlowVersion(flow);
    return { workspaceId: workspace.id, profileId: profile.id, flowVersionId: flow.id, emailVersionId: email.id, senderIdentityId: sender.id };
  }

  startFlow(input: { workspaceId: string; profileId: string; flowVersionId: string; delayMs?: number }): { flowRunId: string; scheduledActionId: string } {
    const now = this.now(); const profile = this.store.getProfile(input.workspaceId, input.profileId); const flow = this.store.getFlowVersion(input.workspaceId, input.flowVersionId);
    const issues = validateFlowGraph(flow.graph); if (issues.length) throw new Error(`FLOW_VALIDATION_FAILED:${JSON.stringify(issues)}`);
    const delay = flow.graph.nodes.find((n) => n.type === "delay"); const email = flow.graph.nodes.find((n) => n.type === "email");
    if (!delay || delay.type !== "delay" || !email || email.type !== "email") throw new Error("PHASE0_FLOW_SHAPE_INVALID");
    const correlationId = randomUUID(); const runId = randomUUID();
    const actionId = randomUUID(); const due = new Date(now.getTime() + (input.delayMs ?? delay.durationMs));
    const action: ScheduledAction = { id: actionId, workspaceId: input.workspaceId, actionType: "flow.email", aggregateId: runId, dueAt: due.toISOString(), state: "pending", attemptCount: 0, payload: { flowRunId: runId, emailNodeId: email.id }, createdAt: now.toISOString() };
    this.store.transaction(() => {
      this.store.addFlowRun({ id: runId, workspaceId: input.workspaceId, flowId: flow.flowId, flowVersionId: flow.id, profileId: profile.id, state: "waiting", currentNodeId: delay.id, enteredAt: now.toISOString(), correlationId });
      this.store.addTrace({ workspaceId: input.workspaceId, aggregateType: "flow_run", aggregateId: runId, kind: "flow.entered", detail: { flowVersionId: flow.id }, at: now.toISOString() });
      this.store.addScheduledAction(action);
      this.store.addOutbox({ id: randomUUID(), workspaceId: input.workspaceId, aggregateType: "flow_run", aggregateId: runId, eventType: "flow.wait_scheduled", payload: { scheduledActionId: actionId, dueAt: due.toISOString() }, createdAt: now.toISOString() });
      this.store.addTrace({ workspaceId: input.workspaceId, aggregateType: "flow_run", aggregateId: runId, kind: "wait.scheduled", detail: { scheduledActionId: actionId, dueAt: due.toISOString() }, at: now.toISOString() });
    });
    return { flowRunId: runId, scheduledActionId: actionId };
  }

  dispatchDueActions(owner = `scheduler-${process.pid}`, leaseMs = 30_000): number {
    const now = this.now(); let count = 0;
    for (const action of this.store.dueActions(now.toISOString())) {
      const leaseExpires = new Date(now.getTime() + leaseMs).toISOString();
      if (!this.store.claimAction(action.workspaceId, action.id, owner, leaseExpires)) continue;
      const job: JobEnvelope = { jobType: "scheduled.execute", jobVersion: 1, jobId: action.id, workspaceId: action.workspaceId, resourceType: "scheduled_action", resourceId: action.id, correlationId: action.aggregateId, enqueuedAt: now.toISOString(), attempt: action.attemptCount + 1 };
      this.queue.enqueue(job); count += 1;
    }
    return count;
  }

  async runWorkerOnce(): Promise<number> {
    const jobs = this.queue.drain();
    for (const job of jobs) {
      if (job.jobType === "scheduled.execute") await this.executeScheduled(job.workspaceId, job.resourceId);
    }
    return jobs.length;
  }

  private evaluatePolicy(workspaceId: string, profileId: string) {
    const at = this.now().toISOString(); const ws = this.store.getWorkspace(workspaceId); const profile = this.store.getProfile(workspaceId, profileId); const reasons: string[] = [];
    if (ws.status !== "active" || !ws.sendingEnabled) return { outcome: "hold" as const, reasons: ["WORKSPACE_SENDING_HELD"], evaluatedAt: at, policyVersion: 1 as const };
    if (!isPlausibleEmail(profile.email)) return { outcome: "skip" as const, reasons: ["INVALID_RECIPIENT"], evaluatedAt: at, policyVersion: 1 as const };
    const suppressions = this.store.suppressions(workspaceId, profileId); if (suppressions.length) return { outcome: "skip" as const, reasons: suppressions.map((s) => `SUPPRESSION_${s.reason.toUpperCase()}`), evaluatedAt: at, policyVersion: 1 as const };
    const consent = this.store.latestConsent(workspaceId, profileId); if (!consent || consent.status !== "granted") return { outcome: "skip" as const, reasons: ["NO_MARKETING_CONSENT"], evaluatedAt: at, policyVersion: 1 as const };
    if (!ws.senderReady) return { outcome: "hold" as const, reasons: ["SENDER_NOT_READY"], evaluatedAt: at, policyVersion: 1 as const };
    reasons.push("WORKSPACE_READY", "RECIPIENT_VALID", "NO_SUPPRESSION", "CONSENT_GRANTED", "SENDER_READY");
    return { outcome: "allow" as const, reasons, evaluatedAt: at, policyVersion: 1 as const };
  }

  private async executeScheduled(workspaceId: string, actionId: string): Promise<void> {
    const action = this.store.getScheduledAction(workspaceId, actionId); if (action.state === "completed" || action.state === "cancelled") return;
    const run = this.store.getFlowRun(workspaceId, action.payload.flowRunId); const flow = this.store.getFlowVersion(workspaceId, run.flowVersionId); const node = flow.graph.nodes.find((n) => n.id === action.payload.emailNodeId);
    if (!node || node.type !== "email") throw new Error("EMAIL_NODE_NOT_FOUND");
    const profile = this.store.getProfile(workspaceId, run.profileId); const emailVersion = this.store.getEmailVersion(workspaceId, node.emailVersionId);
    const key = buildMessageIdempotencyKey({ workspaceId, flowRunId: run.id, nodeId: node.id, recipient: profile.email, emailVersionId: emailVersion.id });
    const messageRow: Message = { id: randomUUID(), workspaceId, flowRunId: run.id, nodeId: node.id, profileId: profile.id, emailVersionId: emailVersion.id, idempotencyKey: key, state: "created", scheduledFor: action.dueAt, createdAt: this.now().toISOString() };
    const { message, created } = this.store.createMessageIfAbsent(messageRow);
    if (!created && ["submitted","delivered","bounced","complained","unknown","skipped","cancelled"].includes(message.state)) { this.store.completeAction(workspaceId, action.id, this.now().toISOString()); return; }
    const policy = this.evaluatePolicy(workspaceId, profile.id); this.store.updateMessage(workspaceId, message.id, { state: "evaluating", policyDecision: policy });
    this.store.addTrace({ workspaceId, aggregateType: "message", aggregateId: message.id, kind: "policy.evaluated", detail: { outcome: policy.outcome, reasons: policy.reasons }, at: this.now().toISOString() });
    if (policy.outcome !== "allow") {
      this.store.updateMessage(workspaceId, message.id, { state: policy.outcome === "hold" ? "held" : "skipped", finalAt: this.now().toISOString() });
      this.store.completeAction(workspaceId, action.id, this.now().toISOString()); this.store.updateFlowRun(workspaceId, run.id, { state: "completed", currentNodeId: "end", endedAt: this.now().toISOString(), exitReason: policy.reasons.join(",") }); return;
    }
    const ws = this.store.getWorkspace(workspaceId); const sender = this.store.getSenderIdentity(workspaceId, emailVersion.senderIdentityId);
    if (!sender.domainReady) {
      this.store.updateMessage(workspaceId, message.id, { state: "held", policyDecision: { outcome: "hold", reasons: ["SENDER_DOMAIN_NOT_READY"], evaluatedAt: this.now().toISOString(), policyVersion: 1 } });
      this.store.completeAction(workspaceId, action.id, this.now().toISOString()); return;
    }
    const rendered = renderProofEmail({ workspace: ws, profile, version: emailVersion, sender, publicBaseUrl: this.settings.publicBaseUrl, unsubscribeSecret: this.settings.unsubscribeSecret });
    const mime = buildMime({ fromName: sender.fromName, fromEmail: sender.fromEmail, replyTo: sender.replyTo, to: profile.email, subject: rendered.subject, html: rendered.html, text: rendered.text, unsubscribeUrl: rendered.unsubscribeUrl });
    this.store.updateMessage(workspaceId, message.id, { state: "rendered", renderedHtml: rendered.html, renderedText: rendered.text, renderedMime: mime, renderedHash: rendered.hash, renderedAt: this.now().toISOString() });
    this.store.addTrace({ workspaceId, aggregateType: "message", aggregateId: message.id, kind: "message.rendered", detail: { renderedHash: rendered.hash, hasOneClickUnsubscribe: mime.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click") }, at: this.now().toISOString() });
    if (!this.settings.emailSendEnabled && this.provider.name !== "fake-ses") throw new Error("EMAIL_SEND_DISABLED");
    const fingerprint = createHash("sha256").update(message.id + "|" + rendered.hash).digest("hex");
    const attemptId = randomUUID();
    this.store.transaction(() => {
      this.store.addDeliveryAttempt({ id: attemptId, workspaceId, messageId: message.id, attemptNumber: 1, provider: this.provider.name, requestFingerprint: fingerprint, state: "created" });
      this.store.addOutbox({ id: randomUUID(), workspaceId, aggregateType: "message", aggregateId: message.id, eventType: "message.provider_submission_requested", payload: { attemptId, provider: this.provider.name }, createdAt: this.now().toISOString() });
    });
    const result = await this.provider.submit({ messageId: message.id, rawMime: mime, requestFingerprint: fingerprint });
    if (result.status === "submitted") {
      this.store.updateDeliveryAttempt(workspaceId, attemptId, { state: "submitted", providerMessageId: result.providerMessageId, submittedAt: this.now().toISOString() });
      this.store.updateMessage(workspaceId, message.id, { state: "submitted", providerMessageId: result.providerMessageId, submittedAt: this.now().toISOString() });
      this.store.addTrace({ workspaceId, aggregateType: "message", aggregateId: message.id, kind: "provider.submitted", detail: { provider: this.provider.name, providerMessageId: result.providerMessageId }, at: this.now().toISOString() });
    } else if (result.status === "unknown") {
      this.store.updateDeliveryAttempt(workspaceId, attemptId, { state: "unknown", submittedAt: this.now().toISOString() }); this.store.updateMessage(workspaceId, message.id, { state: "unknown" });
      this.store.addTrace({ workspaceId, aggregateType: "message", aggregateId: message.id, kind: "provider.unknown", detail: { provider: this.provider.name }, at: this.now().toISOString() });
    } else {
      this.store.updateDeliveryAttempt(workspaceId, attemptId, { state: "failed", errorCode: result.code }); this.store.updateMessage(workspaceId, message.id, { state: "failed", finalAt: this.now().toISOString() });
    }
    this.store.completeAction(workspaceId, action.id, this.now().toISOString()); this.store.updateFlowRun(workspaceId, run.id, { state: "completed", currentNodeId: "end", endedAt: this.now().toISOString() });
  }

  unsubscribe(workspaceId: string, profileId: string, source = "one_click"): void {
    const now = this.now().toISOString(); this.store.getProfile(workspaceId, profileId);
    this.store.transaction(() => {
      const latest = this.store.latestConsent(workspaceId, profileId);
      if (!latest || latest.status !== "withdrawn") {
        const consent: ConsentRecord = { id: randomUUID(), workspaceId, profileId, channel: "email", purpose: "marketing", status: "withdrawn", source, occurredAt: now, recordedAt: now };
        this.store.addConsent(consent);
      }
      if (!this.store.hasSuppression(workspaceId, profileId, "global_unsubscribe")) {
        const suppression: Suppression = { id: randomUUID(), workspaceId, profileId, channel: "email", reason: "global_unsubscribe", protected: true, createdAt: now };
        this.store.addSuppression(suppression);
      }
    });
  }

  async reconcileUnknown(workspaceId: string, messageId: string): Promise<"submitted" | "not_found" | "unchanged"> {
    const message = this.store.getMessage(workspaceId, messageId); if (message.state !== "unknown") return "unchanged";
    const attempt = this.store.attemptsForMessage(workspaceId, messageId).find((a) => a.state === "unknown"); if (!attempt) return "unchanged";
    const lookup = await this.provider.lookupSubmission(attempt.requestFingerprint);
    if (lookup.status === "submitted" && lookup.providerMessageId) {
      this.store.updateDeliveryAttempt(workspaceId, attempt.id, { state: "submitted", providerMessageId: lookup.providerMessageId }); this.store.updateMessage(workspaceId, messageId, { state: "submitted", providerMessageId: lookup.providerMessageId, submittedAt: this.now().toISOString() });
      this.store.addTrace({ workspaceId, aggregateType: "message", aggregateId: messageId, kind: "provider.reconciled", detail: { providerMessageId: lookup.providerMessageId }, at: this.now().toISOString() }); return "submitted";
    }
    return lookup.status === "not_found" ? "not_found" : "unchanged";
  }

  applyProviderFeedback(feedback: NormalizedProviderFeedback): boolean {
    const message = this.store.findMessageByProviderId(feedback.providerMessageId); if (!message) throw new Error("MESSAGE_NOT_FOUND_FOR_PROVIDER_FEEDBACK");
    const payloadHash = createHash("sha256").update(JSON.stringify(feedback)).digest("hex"); const receivedAt = this.now().toISOString();
    const addedInbox = this.store.addInbox({ id: randomUUID(), source: feedback.provider, workspaceId: message.workspaceId, externalId: feedback.providerEventId, payloadHash, receivedAt, status: "received" });
    if (!addedInbox) {
      const existingInbox = this.store.getInbox(feedback.provider, feedback.providerEventId);
      if (existingInbox?.status === "processed") return false;
      if (!existingInbox || existingInbox.status !== "received") throw new Error("FEEDBACK_INBOX_STATE_INVALID");
    }
    let applied = false;
    this.store.transaction(() => {
      const added = this.store.addDeliveryEvent({ id: randomUUID(), workspaceId: message.workspaceId, messageId: message.id, provider: feedback.provider, providerEventId: feedback.providerEventId, eventType: feedback.eventType, occurredAt: feedback.occurredAt, receivedAt });
      if (!added) return;
      applied = true;
      const nextState = projectProviderFeedbackState(message.state, feedback.eventType);
      this.store.updateMessage(message.workspaceId, message.id, {
        state: nextState,
        ...(nextState !== message.state && isProviderTerminalState(nextState) ? { finalAt: receivedAt } : {}),
      });
      if (feedback.eventType === "bounce") this.store.addSuppression({ id: randomUUID(), workspaceId: message.workspaceId, profileId: message.profileId, channel: "email", reason: "hard_bounce", protected: true, createdAt: receivedAt });
      if (feedback.eventType === "complaint") this.store.addSuppression({ id: randomUUID(), workspaceId: message.workspaceId, profileId: message.profileId, channel: "email", reason: "complaint", protected: true, createdAt: receivedAt });
      this.store.markInboxProcessed(feedback.provider, feedback.providerEventId, receivedAt);
      this.store.addTrace({ workspaceId: message.workspaceId, aggregateType: "message", aggregateId: message.id, kind: `feedback.${feedback.eventType}`, detail: { provider: feedback.provider }, at: receivedAt });
    });
    return applied;
  }
}
