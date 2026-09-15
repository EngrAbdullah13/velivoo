import type { ConsentStatus } from "../phase1/consent.js";

export type MarketingEmailStatus = "SUBSCRIBED" | "UNSUBSCRIBED" | "UNKNOWN";

export type UnsubscribeSource = "CAMPAIGN" | "FLOW" | "MANUAL" | "IMPORT" | "API";
export type UnsubscribeMethod = "EMAIL_FOOTER" | "ONE_CLICK" | "PROFILE" | "ADMIN" | "API";

export interface MarketingEligibilityInput {
  consent: ConsentStatus;
  protectedSuppression: boolean;
  identifierValid: boolean;
}

export interface MarketingEligibilityResult {
  allowed: boolean;
  reason?: "UNSUBSCRIBED" | "INVALID_IDENTIFIER" | "PROTECTED_SUPPRESSION";
}

/** Central marketing send gate. Extend with bounce/complaint without redesigning callers. */
export function canReceiveMarketingEmail(input: MarketingEligibilityInput): MarketingEligibilityResult {
  if (!input.identifierValid) return { allowed: false, reason: "INVALID_IDENTIFIER" };
  if (input.protectedSuppression) return { allowed: false, reason: "UNSUBSCRIBED" };
  if (input.consent !== "granted") return { allowed: false, reason: "UNSUBSCRIBED" };
  return { allowed: true };
}

export function marketingEmailStatus(consent: ConsentStatus): MarketingEmailStatus {
  if (consent === "granted") return "SUBSCRIBED";
  if (consent === "withdrawn" || consent === "denied") return "UNSUBSCRIBED";
  return "UNKNOWN";
}

export function mapConsentSourceToUnsubscribeSource(source: string, sourceType?: string): UnsubscribeSource {
  const normalized = `${sourceType ?? ""} ${source}`.toLowerCase();
  if (normalized.includes("flow")) return "FLOW";
  if (normalized.includes("campaign")) return "CAMPAIGN";
  if (normalized.includes("import")) return "IMPORT";
  if (normalized.includes("api")) return "API";
  return "MANUAL";
}

export function formatUnsubscribeMethod(method: UnsubscribeMethod | string | null | undefined): string {
  switch (method) {
    case "EMAIL_FOOTER": return "Email unsubscribe link";
    case "ONE_CLICK": return "One-click unsubscribe";
    case "PROFILE": return "Profile preference";
    case "ADMIN": return "Admin action";
    case "API": return "API";
    default: return "Unsubscribe";
  }
}
