import type { ExpectedDnsRecord, ObservedDnsRecord } from "../../../domain/src/phase1/dns.js";
export interface DnsResolver { resolve(records: ExpectedDnsRecord[]): Promise<ObservedDnsRecord[]>; }
