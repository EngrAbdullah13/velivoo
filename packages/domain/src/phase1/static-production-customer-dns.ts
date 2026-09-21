import { presentCustomerDnsRecord, type CustomerDnsPresentation } from "./customer-dns-presentation.js";
import {
  STATIC_PRODUCTION_SENDING_DNS_PURPOSES,
  staticProductionDnsPurposes,
  staticProductionDnsRecordCount,
} from "./static-branded-dns.js";

export { staticProductionDnsPurposes, staticProductionDnsRecordCount };

export interface StaticProductionDnsEvidenceRow {
  purpose: string;
  recordType: string;
  name: string;
  expectedValue: string;
  verificationStatus: string;
  observedValues?: unknown;
  lastCheckedAt?: Date | null;
}

export interface StaticProductionCustomerRecord {
  type: string;
  name: string;
  value: string;
  purpose: string;
  status: string;
  observedValues?: unknown;
  lastCheckedAt?: Date | null;
  presentation: CustomerDnsPresentation;
}

const STATUS_RANK: Record<string, number> = {
  verified: 0,
  verifying: 1,
  pending: 2,
  advisory: 3,
  mismatch: 4,
  nxdomain: 5,
  timeout: 6,
  servfail: 7,
  archived: 99,
};

export function pickDnsEvidenceForPurpose(rows: StaticProductionDnsEvidenceRow[], purpose: string) {
  const matches = rows.filter(
    (row) => row.purpose === purpose && String(row.verificationStatus ?? "").toLowerCase() !== "archived",
  );
  if (!matches.length) return null;
  return matches.sort((left, right) => {
    const rank =
      (STATUS_RANK[String(left.verificationStatus ?? "").toLowerCase()] ?? 50) -
      (STATUS_RANK[String(right.verificationStatus ?? "").toLowerCase()] ?? 50);
    if (rank !== 0) return rank;
    return String(left.expectedValue).localeCompare(String(right.expectedValue));
  })[0]!;
}

export function buildStaticProductionCustomerRecords(input: {
  rootDomain: string;
  dmarcRequired: boolean;
  evidence: StaticProductionDnsEvidenceRow[];
}): StaticProductionCustomerRecord[] {
  const purposes = staticProductionDnsPurposes(input.dmarcRequired);
  return purposes.map((purpose) => {
    const row = pickDnsEvidenceForPurpose(input.evidence, purpose);
    const type = row?.recordType ?? defaultRecordType(purpose);
    const name = row?.name ?? defaultRecordName(purpose, input.rootDomain);
    const value = row?.expectedValue ?? "";
    const status = row?.verificationStatus ?? "pending";
    return {
      type,
      name,
      value,
      purpose,
      status,
      observedValues: row?.observedValues,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      presentation: presentCustomerDnsRecord({
        type,
        name,
        value,
        purpose,
        rootDomain: input.rootDomain,
      }),
    };
  });
}

function defaultRecordType(purpose: string) {
  if (purpose === "ownership" || purpose === "mail_from_spf" || purpose === "dmarc_advisory") return "TXT";
  if (purpose === "mail_from_mx") return "MX";
  return "CNAME";
}

function defaultRecordName(purpose: string, rootDomain: string) {
  if (purpose === "ownership") return rootDomain;
  if (purpose === "dkim_vm1") return `vm1._domainkey.${rootDomain}`;
  if (purpose === "dkim_vm2") return `vm2._domainkey.${rootDomain}`;
  if (purpose === "mail_from_mx" || purpose === "mail_from_spf") return `bounce.${rootDomain}`;
  if (purpose === "dmarc_advisory") return `_dmarc.${rootDomain}`;
  return rootDomain;
}

export function isStaticProductionCustomerPurpose(purpose: string, dmarcRequired: boolean) {
  return (staticProductionDnsPurposes(dmarcRequired) as readonly string[]).includes(purpose);
}

export function staticProductionSendingPurposesOnly() {
  return STATIC_PRODUCTION_SENDING_DNS_PURPOSES;
}
