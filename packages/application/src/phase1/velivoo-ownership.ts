import { velivooOwnershipValue } from "../../../domain/src/phase1/branded-domain.js";
import type { ManagedDnsRecord } from "../ports/dns-provider.js";

export function velivooOwnershipRecord(rootDomain: string, token: string): ManagedDnsRecord {
  return { type: "TXT", name: `_velivoo.${rootDomain}`, values: [velivooOwnershipValue(token)], ttl: 300 };
}
