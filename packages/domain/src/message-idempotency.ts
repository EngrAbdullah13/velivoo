import { createHash } from "node:crypto";

export function buildMessageIdempotencyKey(input: {
  workspaceId: string;
  flowRunId: string;
  nodeId: string;
  recipient: string;
  emailVersionId: string;
  sequence?: number;
}): string {
  return createHash("sha256")
    .update([
      input.workspaceId,
      input.flowRunId,
      input.nodeId,
      String(input.sequence ?? 1),
      input.recipient,
      input.emailVersionId,
    ].join("|"))
    .digest("hex");
}
