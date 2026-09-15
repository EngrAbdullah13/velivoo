import type { ConsentStatus } from "./consent.js";

export type BlankPolicy = "ignore" | "clear";
/** CSV header names mapped to canonical Profile fields. `properties` maps a CSV
 * header to an already-defined, workspace-scoped custom-property key. */
export interface ImportMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  locale?: string;
  timezone?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  properties?: Record<string,string>;
}
export interface ImportPolicy {
  source: string;
  upsert: boolean;
  blankPolicy: BlankPolicy;
  destinationListId?: string;
  consent?: { status: ConsentStatus; source: string; evidenceNote?: string };
}

export function validateImportPolicy(mapping: ImportMapping, policy: ImportPolicy): void {
  if (!mapping.email?.trim()) throw new Error("IMPORT_EMAIL_MAPPING_REQUIRED");
  if (!policy.source?.trim()) throw new Error("IMPORT_SOURCE_REQUIRED");
  if (policy.consent) {
    if (!policy.consent.source?.trim()) throw new Error("CONSENT_SOURCE_REQUIRED");
    if (policy.consent.status === "granted" && !policy.consent.evidenceNote?.trim()) throw new Error("CONSENT_EVIDENCE_REQUIRED");
  }
}
