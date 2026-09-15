export type ManagedDnsRecordType="A"|"AAAA"|"CNAME"|"MX"|"NS"|"SOA"|"TXT";
export interface ManagedDnsRecord {type:ManagedDnsRecordType;name:string;values:string[];ttl:number}
export interface DnsZone {reference:string;name:string;providerNameservers:string[]}
export interface DelegationEvidence {status:"pending"|"verified"|"mismatch"|"timeout"|"servfail"|"nxdomain";expected:string[];observed:string[];checkedAt:Date}
export interface DnsCheckEvidence {status:"pending"|"verified"|"mismatch"|"timeout"|"servfail"|"nxdomain";expected:string[];observed:string[];checkedAt:Date;authoritative?:boolean}
export interface DnsProvider {
  readonly provider:string;
  ensureZone(input:{domain:string;existingReference?:string|null;delegationSetReference:string;callerReference:string}):Promise<DnsZone>;
  getZone(reference:string):Promise<DnsZone|null>;
  findZoneByName?(domain:string,callerReference?:string):Promise<DnsZone|null>;
  upsertRecord(input:{zoneReference:string;record:ManagedDnsRecord}):Promise<void>;
  listRecords(zoneReference:string):Promise<ManagedDnsRecord[]>;
  checkDelegation(input:{domain:string;expectedNameservers:string[]}):Promise<DelegationEvidence>;
  diagnoseDelegation?(input:{domain:string;expectedNameservers:string[]}):Promise<Array<DelegationEvidence&{resolver:string}>>;
  checkSoa(input:{domain:string;expectedPrimary:string}):Promise<DnsCheckEvidence>;
  checkCname(input:{name:string;expectedTarget:string}):Promise<DnsCheckEvidence>;
  checkMx?(input:{name:string;expectedPriority:number;expectedExchange:string}):Promise<DnsCheckEvidence>;
  resolveTxt(name:string):Promise<DnsCheckEvidence>;
  deleteZoneSafely(input:{zoneReference:string;allowedRecords:ManagedDnsRecord[]}):Promise<{deleted:boolean;alreadyMissing?:boolean}>;
}
