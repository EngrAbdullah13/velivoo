import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";

/**
 * Reconcile uncertain provider submissions without ever issuing a new send.
 * Providers that can look up an accepted request may advance the message to
 * submitted. Otherwise the message remains unknown for feedback/operator review.
 */
export async function reconcileUnknownMessage(
  provider: EmailDeliveryProvider,
  workspaceId: string,
  messageId: string,
): Promise<"submitted" | "not_found" | "unknown" | "unchanged"> {
  const message = await prisma.message.findFirst({ where: { id: messageId, workspaceId } });
  if (!message || message.state !== "unknown") return "unchanged";
  const attempt = await prisma.deliveryAttempt.findFirst({
    where: { workspaceId, messageId, state: "unknown" },
    orderBy: { attemptNumber: "desc" },
  });
  if (!attempt) return "unchanged";

  const result = await provider.lookupSubmission(attempt.requestFingerprint);
  const now = new Date();
  if (result.status === "submitted" && result.providerMessageId) {
    await prisma.$transaction([
      prisma.deliveryAttempt.update({
        where: { id: attempt.id },
        data: { state: "submitted", providerMessageId: result.providerMessageId, responseAt: now },
      }),
      prisma.message.update({
        where: { id: message.id },
        data: { state: "submitted", submittedAt: message.submittedAt ?? now },
      }),
      prisma.traceEvent.create({ data: {
        workspaceId,
        aggregateType: "message",
        aggregateId: message.id,
        kind: "provider.reconciled",
        detailJson: { provider: provider.name, providerMessageId: result.providerMessageId, policy: "no_resend" },
        occurredAt: now,
      }}),
    ]);
    return "submitted";
  }

  await prisma.traceEvent.create({ data: {
    workspaceId,
    aggregateType: "message",
    aggregateId: message.id,
    kind: result.status === "not_found" ? "provider.reconcile_not_found" : "provider.reconcile_still_unknown",
    detailJson: { provider: provider.name, policy: "do_not_blind_retry" },
    occurredAt: now,
  }});
  // `not_found` is not treated as permission to resend automatically. A remote
  // timeout can make provider certainty impossible; operator review is safer.
  return result.status === "not_found" ? "not_found" : "unknown";
}
