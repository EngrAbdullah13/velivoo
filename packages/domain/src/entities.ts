import type { MessageState, PolicyOutcome } from "../../contracts/src/types.js";

export interface Workspace {
  id: string;
  name: string;
  legalName: string;
  businessAddress: string;
  timezone: string;
  status: "active" | "paused";
  sendingEnabled: boolean;
  senderReady: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  workspaceId: string;
  email: string;
  firstName?: string;
  createdAt: string;
}

export interface ConsentRecord {
  id: string;
  workspaceId: string;
  profileId: string;
  channel: "email";
  purpose: "marketing";
  status: "granted" | "withdrawn";
  source: string;
  occurredAt: string;
  recordedAt: string;
}

export interface Suppression {
  id: string;
  workspaceId: string;
  profileId: string;
  channel: "email";
  reason: "global_unsubscribe" | "complaint" | "hard_bounce" | "manual" | "administrative";
  protected: boolean;
  createdAt: string;
}

export interface SenderIdentity {
  id: string;
  workspaceId: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  domainReady: boolean;
}

export interface EmailVersion {
  id: string;
  workspaceId: string;
  definitionId: string;
  versionNumber: number;
  subjectTemplate: string;
  htmlTemplate: string;
  textTemplate: string;
  senderIdentityId: string;
  contentHash: string;
  publishedAt: string;
}

export type FlowNode =
  | { id: string; type: "trigger" }
  | { id: string; type: "delay"; durationMs: number }
  | { id: string; type: "email"; emailVersionId: string }
  | { id: string; type: "end" };

export interface FlowGraph {
  nodes: FlowNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface FlowVersion {
  id: string;
  workspaceId: string;
  flowId: string;
  versionNumber: number;
  graph: FlowGraph;
  graphHash: string;
  publishedAt: string;
}

export interface FlowRun {
  id: string;
  workspaceId: string;
  flowId: string;
  flowVersionId: string;
  profileId: string;
  state: "active" | "waiting" | "completed" | "exited" | "cancelled" | "failed";
  currentNodeId: string;
  enteredAt: string;
  endedAt?: string;
  exitReason?: string;
  correlationId: string;
}

export interface FlowNodeExecution {
  id: string;
  workspaceId: string;
  flowRunId: string;
  nodeId: string;
  state: "scheduled" | "started" | "completed" | "skipped" | "failed";
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  evaluation?: Record<string, unknown>;
}

export interface ScheduledAction {
  id: string;
  workspaceId: string;
  actionType: "flow.email";
  aggregateId: string;
  dueAt: string;
  state: "pending" | "leased" | "completed" | "cancelled";
  leaseOwner?: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  payload: { flowRunId: string; emailNodeId: string };
  createdAt: string;
  completedAt?: string;
}

export interface PolicyDecision {
  outcome: PolicyOutcome;
  reasons: string[];
  evaluatedAt: string;
  policyVersion: 1;
}

export interface Message {
  id: string;
  workspaceId: string;
  flowRunId: string;
  nodeId: string;
  profileId: string;
  emailVersionId: string;
  idempotencyKey: string;
  state: MessageState;
  policyDecision?: PolicyDecision;
  renderedHtml?: string;
  renderedText?: string;
  renderedMime?: string;
  renderedHash?: string;
  providerMessageId?: string;
  scheduledFor: string;
  createdAt: string;
  renderedAt?: string;
  submittedAt?: string;
  finalAt?: string;
}

export interface DeliveryAttempt {
  id: string;
  workspaceId: string;
  messageId: string;
  attemptNumber: number;
  provider: string;
  requestFingerprint: string;
  providerMessageId?: string;
  state: "created" | "submitted" | "unknown" | "failed";
  submittedAt?: string;
  errorCode?: string;
}

export interface DeliveryEvent {
  id: string;
  workspaceId: string;
  messageId: string;
  provider: string;
  providerEventId: string;
    eventType: "delivery" | "bounce" | "complaint" | "delay" | "reject" | "open";
  occurredAt: string;
  receivedAt: string;
}

export interface OutboxEvent {
  id: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  publishedAt?: string;
}

export interface InboxMessage {
  id: string;
  source: string;
  workspaceId: string;
  externalId: string;
  payloadHash: string;
  receivedAt: string;
  processedAt?: string;
  status: "received" | "processed" | "rejected";
}

export interface TraceEvent {
  id: string;
  workspaceId: string;
  aggregateType: "flow_run" | "message" | "system";
  aggregateId: string;
  kind: string;
  detail: Record<string, unknown>;
  at: string;
}
