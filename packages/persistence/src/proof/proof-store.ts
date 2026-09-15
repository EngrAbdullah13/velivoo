import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ConsentRecord, DeliveryAttempt, DeliveryEvent, EmailVersion, FlowNodeExecution, FlowRun, FlowVersion,
  InboxMessage, Message, OutboxEvent, Profile, ScheduledAction, SenderIdentity, Suppression, TraceEvent, Workspace
} from "../../../domain/src/entities.js";

interface State {
  workspaces: Workspace[];
  profiles: Profile[];
  consents: ConsentRecord[];
  suppressions: Suppression[];
  senderIdentities: SenderIdentity[];
  emailVersions: EmailVersion[];
  flowVersions: FlowVersion[];
  flowRuns: FlowRun[];
  nodeExecutions: FlowNodeExecution[];
  scheduledActions: ScheduledAction[];
  messages: Message[];
  deliveryAttempts: DeliveryAttempt[];
  deliveryEvents: DeliveryEvent[];
  outbox: OutboxEvent[];
  inbox: InboxMessage[];
  traces: TraceEvent[];
}

const emptyState = (): State => ({
  workspaces: [], profiles: [], consents: [], suppressions: [], senderIdentities: [], emailVersions: [],
  flowVersions: [], flowRuns: [], nodeExecutions: [], scheduledActions: [], messages: [], deliveryAttempts: [],
  deliveryEvents: [], outbox: [], inbox: [], traces: []
});

export class TenantIsolationError extends Error {
  constructor() { super("TENANT_ISOLATION_VIOLATION"); }
}

export class ProofStore {
  private state: State;
  private transactionDepth = 0;
  private dirty = false;
  constructor(public readonly filePath: string, reset = false) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (!reset && existsSync(filePath)) this.state = JSON.parse(readFileSync(filePath, "utf8")) as State;
    else { this.state = emptyState(); this.persist(); }
  }

  reset(): void { this.state = emptyState(); this.persist(); }
  snapshot(): Readonly<State> { return structuredClone(this.state); }

  private persist(): void {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.filePath);
  }
  private save(): void {
    if (this.transactionDepth > 0) { this.dirty = true; return; }
    this.persist();
  }
  transaction<T>(fn: () => T): T {
    const before = structuredClone(this.state);
    this.transactionDepth += 1;
    try {
      const result = fn();
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.dirty) { this.dirty = false; this.persist(); }
      return result;
    } catch (error) {
      this.state = before;
      this.transactionDepth -= 1;
      this.dirty = false;
      if (this.transactionDepth === 0) this.persist();
      throw error;
    }
  }
  private requireWorkspace(workspaceId: string): Workspace {
    const ws = this.state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) throw new TenantIsolationError();
    return ws;
  }

  addWorkspace(row: Workspace): void { this.state.workspaces.push(row); this.save(); }
  getWorkspace(workspaceId: string): Workspace { return structuredClone(this.requireWorkspace(workspaceId)); }
  updateWorkspace(workspaceId: string, patch: Partial<Workspace>): void { const idx=this.state.workspaces.findIndex(w=>w.id===workspaceId); if(idx<0) throw new TenantIsolationError(); this.state.workspaces[idx]={...this.state.workspaces[idx]!,...patch,id:workspaceId}; this.save(); }

  addProfile(row: Profile): void {
    this.requireWorkspace(row.workspaceId);
    if (this.state.profiles.some((p) => p.workspaceId === row.workspaceId && p.email === row.email)) throw new Error("PROFILE_EMAIL_UNIQUE");
    this.state.profiles.push(row); this.save();
  }
  getProfile(workspaceId: string, profileId: string): Profile {
    this.requireWorkspace(workspaceId);
    const row = this.state.profiles.find((p) => p.workspaceId === workspaceId && p.id === profileId);
    if (!row) throw new TenantIsolationError();
    return structuredClone(row);
  }
  findProfileByEmail(workspaceId: string, email: string): Profile | undefined {
    this.requireWorkspace(workspaceId);
    const row = this.state.profiles.find((p) => p.workspaceId === workspaceId && p.email === email);
    return row ? structuredClone(row) : undefined;
  }

  addConsent(row: ConsentRecord): void { this.getProfile(row.workspaceId, row.profileId); this.state.consents.push(row); this.save(); }
  latestConsent(workspaceId: string, profileId: string): ConsentRecord | undefined {
    this.getProfile(workspaceId, profileId);
    const rows = this.state.consents.filter((c) => c.workspaceId === workspaceId && c.profileId === profileId);
    return rows.length ? structuredClone(rows[rows.length - 1]!) : undefined;
  }
  addSuppression(row: Suppression): void {
    this.getProfile(row.workspaceId, row.profileId);
    if (!this.state.suppressions.some((s) => s.workspaceId === row.workspaceId && s.profileId === row.profileId && s.reason === row.reason)) {
      this.state.suppressions.push(row); this.save();
    }
  }
  hasSuppression(workspaceId: string, profileId: string, reason: Suppression["reason"]): boolean { this.getProfile(workspaceId, profileId); return this.state.suppressions.some(s=>s.workspaceId===workspaceId&&s.profileId===profileId&&s.reason===reason); }
  suppressions(workspaceId: string, profileId: string): Suppression[] {
    this.getProfile(workspaceId, profileId);
    return structuredClone(this.state.suppressions.filter((s) => s.workspaceId === workspaceId && s.profileId === profileId));
  }

  addSenderIdentity(row: SenderIdentity): void { this.requireWorkspace(row.workspaceId); this.state.senderIdentities.push(row); this.save(); }
  getSenderIdentity(workspaceId: string, id: string): SenderIdentity {
    this.requireWorkspace(workspaceId);
    const row = this.state.senderIdentities.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }
  addEmailVersion(row: EmailVersion): void { this.requireWorkspace(row.workspaceId); this.state.emailVersions.push(row); this.save(); }
  getEmailVersion(workspaceId: string, id: string): EmailVersion {
    this.requireWorkspace(workspaceId);
    const row = this.state.emailVersions.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }
  addFlowVersion(row: FlowVersion): void { this.requireWorkspace(row.workspaceId); this.state.flowVersions.push(row); this.save(); }
  getFlowVersion(workspaceId: string, id: string): FlowVersion {
    this.requireWorkspace(workspaceId);
    const row = this.state.flowVersions.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }

  addFlowRun(row: FlowRun): void { this.getProfile(row.workspaceId, row.profileId); this.getFlowVersion(row.workspaceId, row.flowVersionId); this.state.flowRuns.push(row); this.save(); }
  getFlowRun(workspaceId: string, id: string): FlowRun {
    this.requireWorkspace(workspaceId);
    const row = this.state.flowRuns.find((x) => x.workspaceId === workspaceId && x.id === id);
    if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }
  updateFlowRun(workspaceId: string, id: string, patch: Partial<FlowRun>): void {
    const idx = this.state.flowRuns.findIndex((x) => x.workspaceId === workspaceId && x.id === id); if (idx < 0) throw new TenantIsolationError();
    this.state.flowRuns[idx] = { ...this.state.flowRuns[idx]!, ...patch, workspaceId, id }; this.save();
  }
  addNodeExecution(row: FlowNodeExecution): void { this.getFlowRun(row.workspaceId, row.flowRunId); this.state.nodeExecutions.push(row); this.save(); }
  updateNodeExecution(workspaceId: string, id: string, patch: Partial<FlowNodeExecution>): void {
    const idx = this.state.nodeExecutions.findIndex((x) => x.workspaceId === workspaceId && x.id === id); if (idx < 0) throw new TenantIsolationError();
    this.state.nodeExecutions[idx] = { ...this.state.nodeExecutions[idx]!, ...patch, workspaceId, id }; this.save();
  }

  addScheduledAction(row: ScheduledAction): void { this.requireWorkspace(row.workspaceId); this.state.scheduledActions.push(row); this.save(); }
  getScheduledAction(workspaceId: string, id: string): ScheduledAction {
    this.requireWorkspace(workspaceId);
    const row = this.state.scheduledActions.find((x) => x.workspaceId === workspaceId && x.id === id); if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }
  dueActions(now: string): ScheduledAction[] {
    return structuredClone(this.state.scheduledActions.filter((a) => a.state === "pending" && a.dueAt <= now || (a.state === "leased" && (a.leaseExpiresAt ?? "") <= now)));
  }
  claimAction(workspaceId: string, id: string, owner: string, leaseExpiresAt: string): boolean {
    const idx = this.state.scheduledActions.findIndex((a) => a.workspaceId === workspaceId && a.id === id); if (idx < 0) throw new TenantIsolationError();
    const a = this.state.scheduledActions[idx]!;
    const now = new Date().toISOString();
    if (!(a.state === "pending" || (a.state === "leased" && (a.leaseExpiresAt ?? "") <= now))) return false;
    this.state.scheduledActions[idx] = { ...a, state: "leased", leaseOwner: owner, leaseExpiresAt, attemptCount: a.attemptCount + 1 };
    this.save(); return true;
  }
  completeAction(workspaceId: string, id: string, at: string): void {
    const idx = this.state.scheduledActions.findIndex((a) => a.workspaceId === workspaceId && a.id === id); if (idx < 0) throw new TenantIsolationError();
    this.state.scheduledActions[idx] = { ...this.state.scheduledActions[idx]!, state: "completed", completedAt: at, leaseExpiresAt: undefined };
    this.save();
  }

  createMessageIfAbsent(row: Message): { message: Message; created: boolean } {
    this.requireWorkspace(row.workspaceId);
    const existing = this.state.messages.find((m) => m.workspaceId === row.workspaceId && m.idempotencyKey === row.idempotencyKey);
    if (existing) return { message: structuredClone(existing), created: false };
    this.state.messages.push(row); this.save(); return { message: structuredClone(row), created: true };
  }
  getMessage(workspaceId: string, id: string): Message {
    this.requireWorkspace(workspaceId); const row = this.state.messages.find((m) => m.workspaceId === workspaceId && m.id === id); if (!row) throw new TenantIsolationError(); return structuredClone(row);
  }
  findMessageByProviderId(providerMessageId: string): Message | undefined {
    const row = this.state.messages.find((m) => m.providerMessageId === providerMessageId); return row ? structuredClone(row) : undefined;
  }
  updateMessage(workspaceId: string, id: string, patch: Partial<Message>): void {
    const idx = this.state.messages.findIndex((m) => m.workspaceId === workspaceId && m.id === id); if (idx < 0) throw new TenantIsolationError();
    this.state.messages[idx] = { ...this.state.messages[idx]!, ...patch, workspaceId, id }; this.save();
  }

  addDeliveryAttempt(row: DeliveryAttempt): void { this.getMessage(row.workspaceId, row.messageId); this.state.deliveryAttempts.push(row); this.save(); }
  attemptsForMessage(workspaceId: string, messageId: string): DeliveryAttempt[] { this.getMessage(workspaceId, messageId); return structuredClone(this.state.deliveryAttempts.filter((x) => x.workspaceId === workspaceId && x.messageId === messageId)); }
  updateDeliveryAttempt(workspaceId: string, id: string, patch: Partial<DeliveryAttempt>): void {
    const idx = this.state.deliveryAttempts.findIndex((x) => x.workspaceId === workspaceId && x.id === id); if (idx < 0) throw new TenantIsolationError();
    this.state.deliveryAttempts[idx] = { ...this.state.deliveryAttempts[idx]!, ...patch, workspaceId, id }; this.save();
  }
  addDeliveryEvent(row: DeliveryEvent): boolean {
    if (this.state.deliveryEvents.some((x) => x.provider === row.provider && x.providerEventId === row.providerEventId)) return false;
    this.getMessage(row.workspaceId, row.messageId); this.state.deliveryEvents.push(row); this.save(); return true;
  }

  addOutbox(row: OutboxEvent): void { this.requireWorkspace(row.workspaceId); this.state.outbox.push(row); this.save(); }
  addInbox(row: InboxMessage): boolean {
    if (this.state.inbox.some((x) => x.source === row.source && x.externalId === row.externalId)) return false;
    this.state.inbox.push(row); this.save(); return true;
  }
  getInbox(source: string, externalId: string): InboxMessage | undefined {
    const row = this.state.inbox.find((x) => x.source === source && x.externalId === externalId);
    return row ? structuredClone(row) : undefined;
  }
  markInboxProcessed(source: string, externalId: string, at: string): void {
    const idx = this.state.inbox.findIndex((x) => x.source === source && x.externalId === externalId); if (idx < 0) return;
    this.state.inbox[idx] = { ...this.state.inbox[idx]!, status: "processed", processedAt: at }; this.save();
  }

  addTrace(row: Omit<TraceEvent, "id"> & { id?: string }): void { this.requireWorkspace(row.workspaceId); this.state.traces.push({ ...row, id: row.id ?? randomUUID() }); this.save(); }
  traceFor(workspaceId: string, aggregateId: string): TraceEvent[] { this.requireWorkspace(workspaceId); return structuredClone(this.state.traces.filter((t) => t.workspaceId === workspaceId && t.aggregateId === aggregateId).sort((a,b) => a.at.localeCompare(b.at))); }
}
