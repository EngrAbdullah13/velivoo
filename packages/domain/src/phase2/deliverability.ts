export type DeliverabilityHealthState = "healthy" | "attention" | "restricted" | "paused" | "setup";

export interface DeliverabilityHealthInput {
  domainCount: number;
  verifiedDomainCount: number;
  activeHoldCount: number;
  submitted: number;
  hardBounces: number;
  complaints: number;
  feedbackLatestAt?: Date | null;
  feedbackStaleAfterMs?: number;
}

export interface DeliverabilityReason {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  action: "add_domain" | "verify_domain" | "review_feedback" | "review_holds" | "review_bounces" | "review_complaints";
}

export interface DeliverabilityHealth {
  state: DeliverabilityHealthState;
  evaluatedAt: Date;
  reasons: DeliverabilityReason[];
}

export interface DeliverabilityMetric {
  key: "delivery_rate" | "hard_bounce_rate" | "soft_bounce_rate" | "complaint_rate" | "unsubscribe_rate";
  numerator: number;
  denominator: number;
  rate: number | null;
  definition: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function deliverabilityRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function buildDeliverabilityMetrics(input: {
  submitted: number;
  delivered: number;
  hardBounces: number;
  softBounces: number;
  complaints: number;
  unsubscribes: number;
}): DeliverabilityMetric[] {
  const denominator = input.submitted;
  return [
    { key: "delivery_rate", numerator: input.delivered, denominator, rate: deliverabilityRate(input.delivered, denominator), definition: "Delivered provider events divided by submitted production messages in the selected window." },
    { key: "hard_bounce_rate", numerator: input.hardBounces, denominator, rate: deliverabilityRate(input.hardBounces, denominator), definition: "Permanent/hard bounce events divided by submitted production messages in the selected window." },
    { key: "soft_bounce_rate", numerator: input.softBounces, denominator, rate: deliverabilityRate(input.softBounces, denominator), definition: "Temporary/soft bounce events divided by submitted production messages in the selected window." },
    { key: "complaint_rate", numerator: input.complaints, denominator, rate: deliverabilityRate(input.complaints, denominator), definition: "Provider complaint events divided by submitted production messages in the selected window." },
    { key: "unsubscribe_rate", numerator: input.unsubscribes, denominator, rate: deliverabilityRate(input.unsubscribes, denominator), definition: "Recorded unsubscribe suppressions divided by submitted production messages in the selected window." },
  ];
}

export function assessDeliverabilityHealth(input: DeliverabilityHealthInput, now = new Date()): DeliverabilityHealth {
  const reasons: DeliverabilityReason[] = [];
  if (input.activeHoldCount > 0) {
    reasons.push({ code: "ACTIVE_OPERATIONAL_HOLD", severity: "critical", title: "Sending is paused by an operational hold", detail: `${input.activeHoldCount} active hold${input.activeHoldCount === 1 ? " is" : "s are"} restricting new delivery.`, action: "review_holds" });
  }
  if (input.domainCount === 0) {
    reasons.push({ code: "DOMAIN_MISSING", severity: "critical", title: "Add a sending domain", detail: "Production sending remains locked until a sending domain is authenticated.", action: "add_domain" });
  } else if (input.verifiedDomainCount === 0) {
    reasons.push({ code: "DOMAIN_UNVERIFIED", severity: "critical", title: "Verify a sending domain", detail: "DNS and provider readiness must pass before production sending can begin.", action: "verify_domain" });
  }
  if (input.submitted > 0) {
    if (!input.feedbackLatestAt) {
      reasons.push({ code: "FEEDBACK_MISSING", severity: "critical", title: "No provider feedback has been processed", detail: "Submitted messages require an observable bounce and complaint feedback path.", action: "review_feedback" });
    } else if (now.getTime() - input.feedbackLatestAt.getTime() > (input.feedbackStaleAfterMs ?? DAY_MS)) {
      reasons.push({ code: "FEEDBACK_STALE", severity: "critical", title: "Provider feedback is stale", detail: "The latest processed provider event is older than the configured 24-hour safety interval.", action: "review_feedback" });
    }
  }
  if (input.complaints > 0) {
    reasons.push({ code: "COMPLAINT_RECORDED", severity: "warning", title: "Complaint feedback needs review", detail: `${input.complaints} complaint event${input.complaints === 1 ? " was" : "s were"} recorded in the selected window.`, action: "review_complaints" });
  }
  if (input.hardBounces > 0) {
    reasons.push({ code: "HARD_BOUNCE_RECORDED", severity: "warning", title: "Hard bounce feedback needs review", detail: `${input.hardBounces} hard bounce event${input.hardBounces === 1 ? " was" : "s were"} recorded in the selected window.`, action: "review_bounces" });
  }
  const state: DeliverabilityHealthState = input.activeHoldCount > 0 ? "paused"
    : input.domainCount === 0 ? "setup"
    : input.verifiedDomainCount === 0 || reasons.some(reason => reason.code === "FEEDBACK_MISSING" || reason.code === "FEEDBACK_STALE") ? "restricted"
    : reasons.some(reason => reason.severity === "warning") ? "attention"
    : "healthy";
  return { state, evaluatedAt: now, reasons };
}
