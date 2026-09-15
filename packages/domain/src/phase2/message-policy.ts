export type PolicyOutcome = "allow" | "skip" | "hold" | "cancel";

export type PolicyReason =
  | "OPERATIONAL_HOLD"
  | "MESSAGE_CANCELLED"
  | "RECIPIENT_INVALID"
  | "PROTECTED_SUPPRESSION"
  | "NO_MARKETING_CONSENT"
  | "SENDER_NOT_READY"
  | "PROVIDER_NOT_READY"
  | "FEEDBACK_STALE"
  | "FREQUENCY_CAP"
  | "QUIET_HOURS"
  | "WARMING_LIMIT"
  | "FLOW_EXIT"
  | "ELIGIBLE";

export interface MessagePolicyInput {
  policyVersion: number;
  operationalHold: boolean;
  cancelled: boolean;
  recipientValid: boolean;
  protectedSuppression: boolean;
  marketingConsent: boolean;
  senderReady: boolean;
  providerReady: boolean;
  feedbackSafetyCurrent: boolean;
  frequencyAllowed: boolean;
  quietHoursActive: boolean;
  warmingAllowed: boolean;
  flowExitMatched?: boolean;
  evaluatedAt?: string;
}

export interface MessagePolicyDecision {
  outcome: PolicyOutcome;
  reason: PolicyReason;
  policyVersion: number;
  evaluatedAt: string;
  evidence: Record<string, boolean>;
}

export function evaluateMessagePolicy(input: MessagePolicyInput): MessagePolicyDecision {
  const base = {
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    evidence: {
      operationalHold: input.operationalHold,
      cancelled: input.cancelled,
      recipientValid: input.recipientValid,
      protectedSuppression: input.protectedSuppression,
      marketingConsent: input.marketingConsent,
      senderReady: input.senderReady,
      providerReady: input.providerReady,
      feedbackSafetyCurrent: input.feedbackSafetyCurrent,
      frequencyAllowed: input.frequencyAllowed,
      quietHoursActive: input.quietHoursActive,
      warmingAllowed: input.warmingAllowed,
      flowExitMatched: Boolean(input.flowExitMatched),
    },
  };
  if (input.cancelled || input.flowExitMatched) return { ...base, outcome: "cancel", reason: input.cancelled ? "MESSAGE_CANCELLED" : "FLOW_EXIT" };
  if (input.operationalHold) return { ...base, outcome: "hold", reason: "OPERATIONAL_HOLD" };
  if (!input.recipientValid) return { ...base, outcome: "skip", reason: "RECIPIENT_INVALID" };
  if (input.protectedSuppression) return { ...base, outcome: "skip", reason: "PROTECTED_SUPPRESSION" };
  if (!input.marketingConsent) return { ...base, outcome: "skip", reason: "NO_MARKETING_CONSENT" };
  if (!input.senderReady) return { ...base, outcome: "hold", reason: "SENDER_NOT_READY" };
  if (!input.providerReady) return { ...base, outcome: "hold", reason: "PROVIDER_NOT_READY" };
  if (!input.feedbackSafetyCurrent) return { ...base, outcome: "hold", reason: "FEEDBACK_STALE" };
  if (!input.frequencyAllowed) return { ...base, outcome: "hold", reason: "FREQUENCY_CAP" };
  if (input.quietHoursActive) return { ...base, outcome: "hold", reason: "QUIET_HOURS" };
  if (!input.warmingAllowed) return { ...base, outcome: "hold", reason: "WARMING_LIMIT" };
  return { ...base, outcome: "allow", reason: "ELIGIBLE" };
}
