import { randomUUID } from "node:crypto";
import type { UnsubscribeTokenPayload, UnsubscribeTokenPayloadV2 } from "../../../email-renderer/src/unsubscribe-token.js";
import { mapConsentSourceToUnsubscribeSource, type UnsubscribeMethod, type UnsubscribeSource } from "../../../domain/src/marketing/marketing-eligibility.js";

export interface ApplyMarketingUnsubscribeInput {
  payload: UnsubscribeTokenPayload;
  externalId: string;
  method: UnsubscribeMethod;
  now?: Date;
}

export interface ApplyMarketingUnsubscribeResult {
  brandName: string;
  alreadyUnsubscribed: boolean;
  workspaceId: string;
  profileId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidRef(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

type Tx = {
  inboxMessage: { create: (args: any) => Promise<any>; update: (args: any) => Promise<any>; findUnique: (args: any) => Promise<any | null> };
  profile: { findFirst: (args: any) => Promise<any | null> };
  workspace: { findUnique: (args: any) => Promise<any | null> };
  consentRecord: { findFirst: (args: any) => Promise<any | null>; create: (args: any) => Promise<any> };
  suppression: { createMany: (args: any) => Promise<any> };
  subscriptionState: { findUnique: (args: any) => Promise<any | null>; upsert: (args: any) => Promise<any> };
  message: { updateMany: (args: any) => Promise<any>; findFirst?: (args: any) => Promise<any | null> };
  traceEvent: { create: (args: any) => Promise<any> };
};

function resolveUnsubscribeContext(payload: UnsubscribeTokenPayload): {
  source: UnsubscribeSource;
  campaignId: string | null;
  messageId: string | null;
} {
  if (payload.v === 2) {
    const v2 = payload as UnsubscribeTokenPayloadV2;
    const sourceType = v2.sourceType === "flow" ? "FLOW" : v2.sourceType === "campaign" ? "CAMPAIGN" : v2.sourceType === "test" ? "MANUAL" : mapConsentSourceToUnsubscribeSource("one_click", v2.sourceType);
    return {
      source: sourceType,
      campaignId: v2.sourceType === "campaign" && v2.sourceId ? v2.sourceId : null,
      messageId: v2.messageId ?? null,
    };
  }
  return { source: "CAMPAIGN", campaignId: null, messageId: null };
}

/** Idempotently withdraw marketing consent for one workspace profile. */
export async function applyMarketingUnsubscribe(tx: Tx, input: ApplyMarketingUnsubscribeInput): Promise<ApplyMarketingUnsubscribeResult> {
  const now = input.now ?? new Date();
  const { payload, externalId, method } = input;
  const ctx = resolveUnsubscribeContext(payload);

  await tx.inboxMessage.create({ data: {
    id: randomUUID(), source: "one_click_unsubscribe", workspaceId: payload.workspaceId,
    externalId, payloadHash: externalId, payloadJson: { tokenVersion: payload.v, purpose: payload.purpose, method },
    status: "received", receivedAt: now,
  }});

  const profile = await tx.profile.findFirst({ where: { id: payload.profileId, workspaceId: payload.workspaceId, deletedAt: null } });
  if (!profile) throw new Error("UNSUBSCRIBE_PROFILE_NOT_FOUND");

  const workspace = await tx.workspace.findUnique({ where: { id: payload.workspaceId }, select: { legalName: true } });
  const brandName = workspace?.legalName?.trim() || "this sender";

  const latest = await tx.consentRecord.findFirst({
    where: { workspaceId: payload.workspaceId, profileId: payload.profileId, channel: "email", purpose: payload.purpose },
    orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
  });
  const alreadyUnsubscribed = latest?.status === "withdrawn";
  let consentRecordId = latest?.id ?? randomUUID();

  if (!alreadyUnsubscribed) {
    const created = await tx.consentRecord.create({ data: {
      id: randomUUID(), workspaceId: payload.workspaceId, profileId: payload.profileId,
      channel: "email", purpose: payload.purpose, status: "withdrawn", occurredAt: now,
      source: method === "ONE_CLICK" ? "one_click" : "email_footer",
      sourceDetails: { tokenVersion: payload.v, unsubscribeSource: ctx.source, unsubscribeMethod: method, messageId: ctx.messageId, campaignId: ctx.campaignId },
    }});
    consentRecordId = created.id;
  }

  await tx.suppression.createMany({ data: [{
    id: randomUUID(), workspaceId: payload.workspaceId, profileId: payload.profileId,
    channel: "email", scope: "global", reason: "global_unsubscribe", source: method === "ONE_CLICK" ? "one_click" : "email_footer",
    sourceReference: externalId, protected: true, createdAt: now,
    metadataJson: { unsubscribeSource: ctx.source, unsubscribeMethod: method, messageId: ctx.messageId, campaignId: ctx.campaignId },
  }], skipDuplicates: true });

  const current = await tx.subscriptionState.findUnique({
    where: { workspaceId_profileId_channel_purpose: { workspaceId: payload.workspaceId, profileId: payload.profileId, channel: "email", purpose: payload.purpose } },
  });
  if (!current || now >= current.effectiveAt || !alreadyUnsubscribed) {
    await tx.subscriptionState.upsert({
      where: { workspaceId_profileId_channel_purpose: { workspaceId: payload.workspaceId, profileId: payload.profileId, channel: "email", purpose: payload.purpose } },
      create: {
        workspaceId: payload.workspaceId, profileId: payload.profileId, channel: "email", purpose: payload.purpose,
        currentStatus: "withdrawn", effectiveAt: now, sourceConsentRecordId: consentRecordId, revision: 1,
        unsubscribedAt: now, unsubscribeSource: ctx.source, unsubscribeCampaignId: uuidRef(ctx.campaignId), unsubscribeMessageId: uuidRef(ctx.messageId), unsubscribeMethod: method,
      },
      update: {
        currentStatus: "withdrawn", effectiveAt: now, sourceConsentRecordId: consentRecordId, revision: { increment: 1 },
        unsubscribedAt: current?.unsubscribedAt ?? now, unsubscribeSource: ctx.source, unsubscribeCampaignId: uuidRef(ctx.campaignId), unsubscribeMessageId: uuidRef(ctx.messageId), unsubscribeMethod: method,
      },
    });
  }

  await tx.message.updateMany({
    where: {
      workspaceId: payload.workspaceId,
      profileId: payload.profileId,
      state: { in: ["created", "evaluating", "eligible", "rendered", "held"] },
    },
    data: { state: "cancelled", finalAt: now },
  });

  await tx.inboxMessage.update({
    where: { source_externalId: { source: "one_click_unsubscribe", externalId } },
    data: { status: "processed", processedAt: now },
  });

  await tx.traceEvent.create({ data: {
    workspaceId: payload.workspaceId,
    aggregateType: "profile",
    aggregateId: payload.profileId,
    kind: "EMAIL_MARKETING_UNSUBSCRIBED",
    detailJson: {
      source: ctx.source,
      method,
      campaignId: ctx.campaignId,
      messageId: ctx.messageId,
      occurredAt: now.toISOString(),
    },
    occurredAt: now,
  }});

  return { brandName, alreadyUnsubscribed, workspaceId: payload.workspaceId, profileId: payload.profileId };
}
