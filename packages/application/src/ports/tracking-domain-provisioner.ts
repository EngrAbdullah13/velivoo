import type { ManagedDnsRecord } from "./dns-provider.js";
export type TrackingValidationMethod="cloudfront_managed_http"|"cloudfront_dns_challenge"|"acm_dns"|"platform_global";
export interface TrackingDomainState {
  provider:string;mode:"cloudfront_saas"|"standard_staging_fallback"|"platform";hostname:string;
  tenantReference?:string;distributionReference?:string;connectionGroupReference?:string;routingEndpoint?:string;
  certificateReference?:string;certificateStatus:string;domainStatus:string;httpsStatus:string;
  validationMethod:TrackingValidationMethod;validationRecords:ManagedDnsRecord[];dnsRecord?:ManagedDnsRecord;ready:boolean;
  evidence:Record<string,unknown>;
}
export interface TrackingDomainProvisioner {
  readonly provider:string;readonly mode:TrackingDomainState["mode"];
  ensure(input:{workspaceId:string;senderDomainId:string;hostname:string;zoneReference:string;current?:Partial<TrackingDomainState>}):Promise<TrackingDomainState>;
  check(input:{hostname:string;current:Partial<TrackingDomainState>}):Promise<TrackingDomainState>;
  remove(input:{hostname:string;tenantReference?:string}):Promise<void>;
}
