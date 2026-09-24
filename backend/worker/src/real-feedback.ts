import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { MessageState, NormalizedProviderFeedback } from "../../../packages/contracts/src/types.js";
import { isProviderTerminalState, projectProviderFeedbackState } from "../../../packages/domain/src/delivery-state.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";

function p2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2002";
}

type StoredFeedback = {
  messageId: string;
  event: NormalizedProviderFeedback;
};

function parseStoredFeedback(payload: unknown): StoredFeedback {
  if (!payload || typeof payload !== "object") throw new Error("FEEDBACK_PAYLOAD_MISSING");
  const value = payload as any;
  if (typeof value.messageId !== "string" || !value.event || typeof value.event.providerEventId !== "string") {
    throw new Error("FEEDBACK_PAYLOAD_INVALID");
  }
  return { messageId: value.messageId, event: value.event as NormalizedProviderFeedback };
}

/** Apply one already-verified, durably received SES feedback inbox item. */
export async function processFeedbackInbox(workspaceId: string, inboxId: string): Promise<{ outcome: string; messageId?: string }> {
  const inbox = await prisma.inboxMessage.findFirst({ where: { id: inboxId, source: "ses", workspaceId } });
  if (!inbox) throw new Error("FEEDBACK_INBOX_NOT_FOUND");
  if (inbox.status === "processed") return { outcome: "already_processed" };

  const stored = parseStoredFeedback(inbox.payloadJson);
  const { event, messageId } = stored;
  const message = await prisma.message.findFirst({ where: { id: messageId, workspaceId } });
  if (!message) throw new Error("FEEDBACK_MESSAGE_NOT_FOUND");
  const receivedAt = new Date();
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("FEEDBACK_OCCURRED_AT_INVALID");

  try {
    await prisma.$transaction(async (tx: any) => {
      let eventInserted = false;
      try {
        await tx.deliveryEvent.create({ data: {
          id: randomUUID(),
          workspaceId,
          messageId: message.id,
          provider: "ses",
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          occurredAt,
          receivedAt,
          normalizedPayload: event as any,
        }});
        eventInserted = true;
      } catch (error) {
        if (!p2002(error)) throw error;
      }
      const currentState = message.state as MessageState;
      const nextState = projectProviderFeedbackState(currentState, event.eventType);
      const stateAdvanced = nextState !== currentState;

      if (eventInserted) {
        await tx.message.update({
          where: { id: message.id },
          data: {
            state: nextState,
            ...(stateAdvanced && isProviderTerminalState(nextState) ? { finalAt: receivedAt } : {}),
          },
        });

        if (event.eventType === "open") {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "message"
            SET
              "first_opened_at" = CASE WHEN "first_opened_at" IS NULL OR "first_opened_at" > ${occurredAt} THEN ${occurredAt} ELSE "first_opened_at" END,
              "last_opened_at" = CASE WHEN "last_opened_at" IS NULL OR "last_opened_at" < ${occurredAt} THEN ${occurredAt} ELSE "last_opened_at" END,
              "open_count" = "open_count" + 1
            WHERE "id" = ${message.id}::uuid AND "workspace_id" = ${workspaceId}::uuid
          `);
          await tx.traceEvent.create({ data: {
            workspaceId,
            aggregateType: "message",
            aggregateId: message.id,
            kind: "engagement.open",
            detailJson: { classification: "provider", provider: "ses", isBotEvent: event.metadata?.openIsBotEvent ?? null },
            occurredAt,
          }});
        }

      // A provider callback can recover an uncertain API response by using the
      // internal SES tag that was attached to the original submission.
      const platformMessageId = typeof event.metadata?.platformMessageId === "string" ? event.metadata.platformMessageId : "";
      if (platformMessageId === message.id) {
        await tx.deliveryAttempt.updateMany({
          where: { messageId: message.id, attemptNumber: 1, providerMessageId: null },
          data: { providerMessageId: event.providerMessageId, state: "submitted", responseAt: receivedAt },
        });
      }

      let protectedRestriction: "complaint" | "hard_bounce" | null = null;
      if (event.eventType === "complaint") protectedRestriction = "complaint";
      const bounceType = typeof event.metadata?.bounceType === "string" ? event.metadata.bounceType.toLowerCase() : "";
      if (event.eventType === "bounce" && bounceType === "permanent") protectedRestriction = "hard_bounce";

      if (protectedRestriction) {
        await tx.suppression.createMany({
          data: [{
            id: randomUUID(), workspaceId, profileId: message.profileId, channel: "email",
            scope: protectedRestriction === "complaint" ? "global" : "delivery",
            reason: protectedRestriction, source: "ses", sourceReference: event.providerEventId,
            protected: true, createdAt: receivedAt,
          }],
          skipDuplicates: true,
        });
        // Apply the safety effect immediately to any other message that has not
        // reached provider submission.
        await tx.message.updateMany({
          where: {
            workspaceId,
            profileId: message.profileId,
            id: { not: message.id },
            state: { in: ["created", "evaluating", "eligible", "rendered", "held"] },
          },
          data: { state: "cancelled", finalAt: receivedAt },
        });
      }

      await tx.traceEvent.create({ data: {
        workspaceId,
        aggregateType: "message",
        aggregateId: message.id,
        kind: `feedback.${event.eventType}`,
        detailJson: {
          provider: "ses",
          providerMessageId: event.providerMessageId,
          providerEventId: event.providerEventId,
          projectedState: nextState,
          stateAdvanced,
          protectedRestriction,
        },
        occurredAt: receivedAt,
      }});
      }
      await tx.inboxMessage.update({
        where: { id: inbox.id },
        data: { status: "processed", processedAt: receivedAt, errorCode: null },
      });
    });
    return { outcome: "applied", messageId: message.id };
  } catch (error) {
    await prisma.inboxMessage.updateMany({
      where: { id: inbox.id, status: { not: "processed" } },
      data: {
        status: "received",
        errorCode: error instanceof Error ? error.message.slice(0, 120) : "FEEDBACK_APPLY_FAILED",
      },
    });
    throw error;
  }
}
