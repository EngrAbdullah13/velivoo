import type { MessageState, NormalizedProviderFeedback } from "../../contracts/src/types.js";

const terminalRank: Partial<Record<MessageState, number>> = {
  delivered: 70,
  failed: 80,
  bounced: 90,
  complained: 100,
};

const feedbackTarget: Record<NormalizedProviderFeedback["eventType"], MessageState | null> = {
  delivery: "delivered",
  bounce: "bounced",
  complaint: "complained",
  reject: "failed",
  delay: null,
};

/**
 * Projects provider facts onto the message lifecycle without allowing a late,
 * lower-precedence provider fact to erase a more protective terminal state.
 * Complaint > bounce > reject/failure > delivery.
 */
export function projectProviderFeedbackState(
  current: MessageState,
  eventType: NormalizedProviderFeedback["eventType"],
): MessageState {
  const target = feedbackTarget[eventType];
  if (!target) return current;

  // Messages that never reached provider submission must not be revived by a
  // stray callback. Correlation should normally prevent this; this is defense in depth.
  if (["skipped", "cancelled"].includes(current)) return current;

  const currentRank = terminalRank[current] ?? 0;
  const targetRank = terminalRank[target] ?? 0;
  return targetRank >= currentRank ? target : current;
}

export function isProviderTerminalState(state: MessageState): boolean {
  return state === "delivered" || state === "bounced" || state === "complained" || state === "failed";
}
