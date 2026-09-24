export type Id = string;

export type PolicyOutcome = "allow" | "skip" | "hold" | "cancel";
export type MessageState =
  | "created"
  | "evaluating"
  | "eligible"
  | "rendered"
  | "submitted"
  | "delivered"
  | "bounced"
  | "complained"
  | "skipped"
  | "held"
  | "cancelled"
  | "failed"
  | "unknown";

export interface JobEnvelope {
  jobType: "scheduled.execute" | "outbox.dispatch" | "feedback.apply";
  jobVersion: 1;
  jobId: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  enqueuedAt: string;
  attempt: number;
}

export interface NormalizedProviderFeedback {
  providerEventId: string;
  provider: string;
  providerMessageId: string;
  eventType: "delivery" | "bounce" | "complaint" | "delay" | "reject" | "open";
  occurredAt: string;
  rawType?: string;
  metadata?: Record<string, unknown>;
}
