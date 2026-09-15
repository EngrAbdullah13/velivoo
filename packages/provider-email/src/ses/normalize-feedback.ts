import { createHash } from "node:crypto";
import type { NormalizedProviderFeedback } from "../../../contracts/src/types.js";
import type { SnsEnvelope } from "./sns-verifier.js";

export function normalizeSesSnsEnvelope(envelope: SnsEnvelope): NormalizedProviderFeedback[] {
  if (envelope.Type !== "Notification") return [];
  const parsed = JSON.parse(envelope.Message) as Record<string, any>;
  const mail = parsed.mail ?? {};
  const providerMessageId = String(mail.messageId ?? "");
  if (!providerMessageId) throw new Error("SES_FEEDBACK_MISSING_MESSAGE_ID");
  const type = String(parsed.notificationType ?? parsed.eventType ?? "").toLowerCase();
  let eventType: NormalizedProviderFeedback["eventType"];
  let occurredAt = String(mail.timestamp ?? envelope.Timestamp);
  if (type === "delivery") { eventType = "delivery"; occurredAt = String(parsed.delivery?.timestamp ?? occurredAt); }
  else if (type === "bounce") { eventType = "bounce"; occurredAt = String(parsed.bounce?.timestamp ?? occurredAt); }
  else if (type === "complaint") { eventType = "complaint"; occurredAt = String(parsed.complaint?.timestamp ?? occurredAt); }
  else if (type === "deliverydelay" || type === "delay") { eventType = "delay"; occurredAt = String(parsed.deliveryDelay?.timestamp ?? occurredAt); }
  else if (type === "reject") { eventType = "reject"; }
  else return [];
  return [{
    providerEventId: envelope.MessageId || createHash("sha256").update(envelope.Message).digest("hex"),
    provider: "ses",
    providerMessageId,
    eventType,
    occurredAt,
    rawType: type,
    metadata: {
      platformMessageId: Array.isArray(mail.tags?.platformMessageId) ? String(mail.tags.platformMessageId[0] ?? "") : undefined,
      requestFingerprint: Array.isArray(mail.tags?.requestFingerprint) ? String(mail.tags.requestFingerprint[0] ?? "") : undefined,
      bounceType: parsed.bounce?.bounceType ? String(parsed.bounce.bounceType) : undefined,
      bounceSubType: parsed.bounce?.bounceSubType ? String(parsed.bounce.bounceSubType) : undefined,
      complaintFeedbackType: parsed.complaint?.complaintFeedbackType ? String(parsed.complaint.complaintFeedbackType) : undefined,
    },
  }];
}
