export type ConsentStatus = "granted" | "denied" | "withdrawn" | "unknown";
export type SuppressionReason = "complaint" | "global_unsubscribe" | "hard_bounce" | "category_unsubscribe" | "manual" | "administrative" | "legal";

const protectedReasons = new Set<SuppressionReason>([
  "complaint", "global_unsubscribe", "hard_bounce", "administrative", "legal",
]);

const precedence: Record<SuppressionReason, number> = {
  legal: 700,
  administrative: 650,
  complaint: 600,
  global_unsubscribe: 500,
  hard_bounce: 400,
  category_unsubscribe: 300,
  manual: 100,
};

export function isProtectedSuppression(reason: SuppressionReason): boolean {
  return protectedReasons.has(reason);
}

export function strongestSuppression<T extends { reason: SuppressionReason; revokedAt?: string | null }>(items: T[]): T | null {
  const active = items.filter((x) => !x.revokedAt);
  return active.sort((a, b) => precedence[b.reason] - precedence[a.reason])[0] ?? null;
}

export interface EligibilityInput {
  consent: ConsentStatus;
  suppressions: Array<{ reason: SuppressionReason; revokedAt?: string | null }>;
  identifierValid: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  code: string;
  explanation: string;
}

export function explainEligibility(input: EligibilityInput): EligibilityResult {
  if (!input.identifierValid) return { eligible: false, code: "INVALID_IDENTIFIER", explanation: "The profile has no valid email delivery identifier." };
  const block = strongestSuppression(input.suppressions);
  if (block) return { eligible: false, code: `SUPPRESSED_${block.reason.toUpperCase()}`, explanation: `Delivery is blocked by an active ${block.reason.replaceAll("_", " ")} suppression.` };
  if (input.consent !== "granted") return { eligible: false, code: "NO_MARKETING_CONSENT", explanation: "No current affirmative marketing-email consent is recorded." };
  return { eligible: true, code: "ELIGIBLE", explanation: "The profile currently passes the Release 1 marketing eligibility checks available in Phase 1." };
}
