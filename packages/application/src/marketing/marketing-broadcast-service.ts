import { randomUUID } from "node:crypto";
import { canReceiveMarketingEmail } from "../../../domain/src/marketing/marketing-eligibility.js";
import type { Phase2Service, Phase2ServiceActor } from "../phase2/phase2-service.js";

export interface MarketingBroadcastInput {
  campaignId: string;
  emailVersionId: string;
  audienceType: "list" | "segment";
  audienceId: string;
}

export interface MarketingBroadcastResult {
  campaignId: string;
  selected: number;
  eligible: number;
  suppressed: number;
  queued: number;
  messageIds: string[];
}

export interface MarketingAudiencePort {
  listActiveProfileIds(workspaceId: string, listId: string): Promise<string[]>;
  segmentMemberProfileIds(workspaceId: string, segmentId: string): Promise<string[]>;
  marketingEligibility(workspaceId: string, profileId: string): Promise<{ consent: "granted" | "denied" | "withdrawn" | "unknown"; protectedSuppression: boolean; identifierValid: boolean }>;
}

export class MarketingBroadcastService {
  constructor(
    private readonly phase2: Phase2Service,
    private readonly audience: MarketingAudiencePort,
    private readonly enqueuePolicy: (workspaceId: string, messageId: string) => Promise<void>,
  ) {}

  async sendCampaign(actor: Phase2ServiceActor, input: MarketingBroadcastInput): Promise<MarketingBroadcastResult> {
    const profileIds = input.audienceType === "list"
      ? await this.audience.listActiveProfileIds(actor.workspaceId, input.audienceId)
      : await this.audience.segmentMemberProfileIds(actor.workspaceId, input.audienceId);

    const messageIds: string[] = [];
    let eligible = 0;
    let suppressed = 0;

    for (const profileId of profileIds) {
      const facts = await this.audience.marketingEligibility(actor.workspaceId, profileId);
      const gate = canReceiveMarketingEmail(facts);
      if (!gate.allowed) {
        suppressed++;
        continue;
      }
      eligible++;
      const message = await this.phase2.createMessageIntent(actor, {
        sourceType: "campaign",
        sourceId: input.campaignId,
        profileId,
        emailVersionId: input.emailVersionId,
        sequence: messageIds.length + 1,
      });
      messageIds.push(message.id);
      await this.enqueuePolicy(actor.workspaceId, message.id);
    }

    return {
      campaignId: input.campaignId,
      selected: profileIds.length,
      eligible,
      suppressed,
      queued: messageIds.length,
      messageIds,
    };
  }
}

export function newCampaignId(): string {
  return randomUUID();
}
