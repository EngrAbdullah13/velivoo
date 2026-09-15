import type { ManagedDnsRecord } from "./dns-provider.js";

export interface StaticDnsCheckResult {
  status: "pending" | "verified" | "mismatch";
  observed: string[];
  checkedAt: Date;
}

export interface StaticDnsInfrastructure {
  readonly provider: string;
  publishDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }): Promise<ManagedDnsRecord>;
  checkDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }): Promise<StaticDnsCheckResult>;
  removeDkimPublicKey?(input: { routingId: string; selector: string }): Promise<void>;
  publishSendRouting(input: { routingId: string; target?: string }): Promise<ManagedDnsRecord>;
  checkSendRouting(input: { routingId: string; target?: string }): Promise<StaticDnsCheckResult>;
  removeSendRouting?(input: { routingId: string }): Promise<void>;
}
