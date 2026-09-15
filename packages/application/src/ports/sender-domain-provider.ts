import type { ExpectedDnsRecord, ObservedDnsRecord } from "../../../domain/src/phase1/dns.js";

export interface DomainProviderContext {
  workspaceId: string;
  domain: string;
  providerReference?: string | null;
  providerRegion?: string | null;
  configurationSetName?: string | null;
}

export interface SenderDomainProvision {
  expectedRecords: ExpectedDnsRecord[];
  providerReference: string;
  providerRegion: string;
  providerStatus: string;
  providerEvidence?: unknown;
  dkimStatus?: string | null;
  mailFromStatus?: string | null;
}

export interface SenderDomainCheck {
  status: "pending" | "verified" | "warning" | "failed";
  observedRecords: ObservedDnsRecord[];
  providerStatus: string;
  providerEvidence?: unknown;
  dkimStatus?: string | null;
  mailFromStatus?: string | null;
}

/** Product-level port. Customer-facing code never depends on AWS SDK types. */
export interface SenderDomainProvider {
  readonly provider: string;
  readonly region: string;
  provision(context: DomainProviderContext): Promise<SenderDomainProvision>;
  check(context: DomainProviderContext, expectedRecords: ExpectedDnsRecord[]): Promise<SenderDomainCheck>;
  /** Removes the provider identity only after the application has made it safe to do so. */
  remove(context: DomainProviderContext): Promise<void>;
}
