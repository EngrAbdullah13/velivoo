import { createHash } from "node:crypto";
import { config } from "../../../packages/config/src/env.js";
import { verifyUnsubscribeToken } from "../../../packages/email-renderer/src/unsubscribe-token.js";
import { applyMarketingUnsubscribe } from "../../../packages/application/src/marketing/apply-marketing-unsubscribe.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";

function p2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2002";
}

export interface UnsubscribeApplyResult {
  brandName: string;
  alreadyUnsubscribed: boolean;
}

/** Idempotently apply a signed marketing unsubscribe token. */
export async function applyOneClickUnsubscribe(token: string, method: "ONE_CLICK" | "EMAIL_FOOTER" = "ONE_CLICK"): Promise<UnsubscribeApplyResult> {
  if (!token || token === "test-preview") throw new Error("INVALID_UNSUBSCRIBE_TOKEN");
  const payload = verifyUnsubscribeToken(token, config.unsubscribeSecret);
  const externalId = createHash("sha256").update(token).digest("hex");
  try {
    return await prisma.$transaction(async (tx: any) => applyMarketingUnsubscribe(tx, { payload, externalId, method }));
  } catch (error) {
    if (!p2002(error)) throw error;
    const existing = await prisma.inboxMessage.findUnique({
      where: { source_externalId: { source: "one_click_unsubscribe", externalId } },
    });
    if (existing?.status !== "processed") throw error;
    const profile = await prisma.profile.findFirst({ where: { id: payload.profileId, workspaceId: payload.workspaceId, deletedAt: null } });
    const workspace = await prisma.workspace.findUnique({ where: { id: payload.workspaceId }, select: { legalName: true } });
    return {
      brandName: workspace?.legalName?.trim() || "this sender",
      alreadyUnsubscribed: true,
    };
  }
}
