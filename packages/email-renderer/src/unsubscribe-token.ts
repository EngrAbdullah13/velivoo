import { createHmac, timingSafeEqual } from "node:crypto";

export interface UnsubscribeTokenPayloadV1 {
  workspaceId: string;
  profileId: string;
  purpose: "marketing";
  v: 1;
}

export interface UnsubscribeTokenPayloadV2 {
  workspaceId: string;
  profileId: string;
  purpose: "marketing";
  v: 2;
  messageId?: string;
  sourceType?: "campaign" | "flow" | "manual" | "test";
  sourceId?: string;
}

export type UnsubscribeTokenPayload = UnsubscribeTokenPayloadV1 | UnsubscribeTokenPayloadV2;

function b64url(input: Buffer | string): string { return Buffer.from(input).toString("base64url"); }

export function signUnsubscribeToken(payload: UnsubscribeTokenPayload, secret: string): string {
  if (Buffer.byteLength(secret) < 32) throw new Error("UNSUBSCRIBE_SECRET_TOO_SHORT");
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("INVALID_UNSUBSCRIBE_TOKEN");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("INVALID_UNSUBSCRIBE_TOKEN");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribeTokenPayload;
  if ((payload.v !== 1 && payload.v !== 2) || payload.purpose !== "marketing") throw new Error("INVALID_UNSUBSCRIBE_TOKEN");
  if (!payload.workspaceId || !payload.profileId) throw new Error("INVALID_UNSUBSCRIBE_TOKEN");
  return payload;
}

export function createRecipientUnsubscribeToken(input: {
  workspaceId: string;
  profileId: string;
  messageId?: string;
  sourceType?: "campaign" | "flow" | "manual" | "test";
  sourceId?: string;
}, secret: string): string {
  if (input.messageId || input.sourceType || input.sourceId) {
    return signUnsubscribeToken({
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      purpose: "marketing",
      v: 2,
      messageId: input.messageId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    }, secret);
  }
  return signUnsubscribeToken({ workspaceId: input.workspaceId, profileId: input.profileId, purpose: "marketing", v: 1 }, secret);
}
