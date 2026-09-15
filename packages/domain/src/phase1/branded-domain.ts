import { canonicalDnsName, normalizeDomain } from "./dns.js";
import {
  STATIC_DKIM_SELECTOR_PRIMARY,
  staticBrandedDkimSelectorHost,
} from "./static-branded-dns.js";

export const DOMAIN_LIFECYCLE_STATES = [
  "created","infrastructure_provisioning","awaiting_customer_dns","delegation_verified",
  "provider_provisioning","authentication_verifying","ready","warning","failed","held","archived",
  "DOMAIN_CREATED","AWS_RESOURCES_PREPARED","AWAITING_CUSTOMER_DNS","DNS_DELEGATED","SES_VERIFIED",
  "MAIL_FROM_CONFIGURING","MAIL_FROM_READY","TRACKING_READY","READY",
  "CREATED","WAITING_FOR_DNS","DNS_VERIFIED","OWNERSHIP_VERIFIED","SES_VERIFYING","DKIM_VERIFYING",
  "FAILED","DELETING","DELETED",
] as const;
export type DomainLifecycleState = typeof DOMAIN_LIFECYCLE_STATES[number];
export type DomainReadinessStatus = "not_ready"|"ready"|"warning"|"held";

export const DOMAIN_REASON_CODES = [
  "DNS_PROVIDER_NOT_CONFIGURED","VANITY_NAMESERVERS_NOT_CONFIGURED","VANITY_NAMESERVER_MAPPING_INVALID",
  "HOSTED_ZONE_PROVISIONING","DNS_DELEGATION_PENDING","DNS_DELEGATION_MISMATCH","EMAIL_IDENTITY_PENDING",
  "DKIM_PENDING","MAIL_FROM_PENDING","TRACKING_CERTIFICATE_PENDING","TRACKING_HTTPS_PENDING","DMARC_WARNING",
  "BUSINESS_INFORMATION_MISSING","FEEDBACK_NOT_READY","UNSUBSCRIBE_NOT_READY","SENDER_IDENTITY_MISSING","ROUTE_NOT_ACTIVE","WORKSPACE_HELD",
  "PROVIDER_ACCESS_DENIED","PROVIDER_AUTHENTICATION_FAILED",
  "DOMAIN_ALREADY_CLAIMED","ROUTE53_CREATE_FAILED","VANITY_NS_NOT_APPLIED","SOA_VERIFICATION_PENDING",
  "DKIM_RECORDS_PENDING","SES_VERIFICATION_PENDING","SES_VERIFICATION_FAILED","AWS_ACCESS_DENIED","AWS_THROTTLED",
  "OWNERSHIP_VERIFICATION_PENDING","STATIC_DNS_PENDING","STATIC_DKIM_DNS_PENDING","STATIC_SEND_ROUTING_PENDING","STATIC_DKIM_VM2_PENDING","VELIVOO_DNS_TARGET_PENDING","BYODKIM_PENDING","DKIM_KEY_UNAVAILABLE","DKIM_ROTATION_PENDING",
] as const;
export type DomainReasonCode = typeof DOMAIN_REASON_CODES[number];

export function sendingSubdomain(rootDomain:string,prefix="send"){
  const root=normalizeDomain(rootDomain),label=prefix.trim().toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))throw new Error("SENDING_DOMAIN_PREFIX_INVALID");
  return `${label}.${root}`;
}

export const V1_LEGACY_SEND_SUBDOMAIN="V1_LEGACY_SEND_SUBDOMAIN" as const;
export const V2_ROOT_SENDER_DELEGATED_INFRA="V2_ROOT_SENDER_DELEGATED_INFRA" as const;
export const V3_ROOT_SENDER_DELEGATED_EASY_DKIM="V3_ROOT_SENDER_DELEGATED_EASY_DKIM" as const;
/** Leftover rows from the removed platform-managed DKIM path. Recheck uses delegated Easy DKIM. */
export const V3_ROOT_SENDER_PLATFORM_DKIM="V3_ROOT_SENDER_PLATFORM_DKIM" as const;
export const V4_STATIC_BRANDED_BYODKIM="V4_STATIC_BRANDED_BYODKIM" as const;
export const V5_STATIC_BRANDED_KLAVIYO="V5_STATIC_BRANDED_KLAVIYO" as const;
export const SETUP_MODE_MANAGED_DELEGATION="MANAGED_DELEGATION" as const;
export const SETUP_MODE_STATIC_BRANDED="STATIC_BRANDED" as const;
export const PROVISIONING_MODE_STATIC_BRANDED="static_branded" as const;
export const DKIM_MODE_EASY_DKIM="EASY_DKIM" as const;
export const DKIM_MODE_BYODKIM="BYODKIM" as const;
export const DEFAULT_DKIM_SELECTOR="v1" as const;
export const VELIVOO_OWNERSHIP_PREFIX="velivoo-site-verification=" as const;
export const infraDomain=(rootDomain:string)=>sendingSubdomain(rootDomain,"send");
export const mailFromDomain=(rootDomain:string)=>`bounce.${infraDomain(rootDomain)}`;
export const trackingDomain=(rootDomain:string)=>`click.${infraDomain(rootDomain)}`;
export function isDelegatedEasyDkimVersion(version?:string|null){
  return version===V3_ROOT_SENDER_DELEGATED_EASY_DKIM||version===V3_ROOT_SENDER_PLATFORM_DKIM;
}
export function isStaticBrandedVersion(version?:string|null){return version===V4_STATIC_BRANDED_BYODKIM||version===V5_STATIC_BRANDED_KLAVIYO}
export function isStaticBrandedMode(provisioningMode?:string|null){return provisioningMode===PROVISIONING_MODE_STATIC_BRANDED}
export function isRootSenderVersion(version?:string|null){
  return version===V2_ROOT_SENDER_DELEGATED_INFRA||isDelegatedEasyDkimVersion(version)||isStaticBrandedVersion(version);
}
export function senderDomainAuthenticationReady(domain:{provisioningMode?:string|null;authenticationStatus?:string|null;status?:string|null}){
  if(domain.provisioningMode==="branded_delegation"||domain.provisioningMode==="static_branded")return domain.authenticationStatus==="verified";
  return domain.status==="verified";
}
export function byodkimIdentityReady(identity:{dkimSigningOrigin?:string|null;dkimStatus?:string|null;dkimSigningSelector?:string|null},expectedSelector?:string|null){
  if(String(identity.dkimSigningOrigin??"").toUpperCase()!=="EXTERNAL")return false;
  if(String(identity.dkimStatus??"").toUpperCase()!=="SUCCESS")return false;
  if(expectedSelector&&identity.dkimSigningSelector&&identity.dkimSigningSelector!==expectedSelector)return false;
  return true;
}
export function mailFromIdentityReady(identity:{mailFromStatus?:string|null}){
  return String(identity.mailFromStatus??"").toUpperCase()==="SUCCESS";
}
export function velivooOwnershipValue(token:string){return `${VELIVOO_OWNERSHIP_PREFIX}${token}`}
/** @deprecated Use staticBrandedDkimSelectorHost from static-branded-dns.ts */
export function staticBrandedDkimHost(routingId:string,staticDnsDomain:string){return staticBrandedDkimSelectorHost(routingId,STATIC_DKIM_SELECTOR_PRIMARY,staticDnsDomain)}
export function staticBrandedDkimApex(staticDnsDomain:string){
  const canonical=canonicalDnsName(staticDnsDomain);
  if(!canonical)throw new Error("STATIC_DNS_DOMAIN_INVALID");
  return canonical.startsWith("dkim.")?canonical.slice("dkim.".length):canonical;
}
export function customerDnsUsesProviderBranding(record:{name?:string;value?:string;host?:string;target?:string;purpose?:string},options?:{allowLegacyProviderDkim?:boolean}){
  const purpose=String(record.purpose??"").toLowerCase();
  if(purpose==="mail_from"||purpose==="mail_from_mx"||purpose==="mail_from_spf")return false;
  const name=(record.name??record.host??"").toLowerCase();
  const value=(record.value??record.target??"").toLowerCase();
  if(name.includes("_amazonses"))return true;
  if(!options?.allowLegacyProviderDkim&&(value.includes("amazonses.com")||/\bamazon ses\b/.test(value)))return true;
  return false;
}
export function staticLifecycleState(input:{deleting?:boolean;deleted?:boolean;failed?:boolean;ownershipVerified:boolean;sendRoutingVerified?:boolean;dkimDnsVerified:boolean;sesIdentitySuccess:boolean;dkimSuccess:boolean;mailFromVerified?:boolean;ready:boolean;previous?:string|null}):DomainLifecycleState{
  if(input.deleted)return "DELETED";
  if(input.deleting)return "DELETING";
  if(input.failed)return "FAILED";
  if(input.ready)return "READY";
  const customerDnsReady=input.ownershipVerified&&(input.sendRoutingVerified??true)&&input.dkimDnsVerified;
  if(!customerDnsReady)return "WAITING_FOR_DNS";
  if(!input.sesIdentitySuccess)return "SES_VERIFYING";
  if(!input.dkimSuccess)return "DKIM_VERIFYING";
  if(input.mailFromVerified===false)return "MAIL_FROM_CONFIGURING";
  return "authentication_verifying";
}
export function delegatedEasyDkimRecords<T extends {name:string}>(records:T[],rootDomain:string,infra:string){
  const root=canonicalDnsName(rootDomain),delegated=canonicalDnsName(infra),from=`._domainkey.${root}`,to=`._domainkey.${delegated}`;
  return records.map(record=>{
    const name=canonicalDnsName(record.name);
    if(!name.endsWith(from))throw new Error("DKIM_EVIDENCE_UNAVAILABLE");
    return {...record,name:`${name.slice(0,-from.length)}${to}`};
  });
}
export function delegatedAuthenticationAlignment(dmarcValue:string|null){
  const strict=(tag:"adkim"|"aspf")=>Boolean(dmarcValue&&new RegExp(`(?:^|;)\\s*${tag}\\s*=\\s*s\\s*(?:;|$)`,"i").test(dmarcValue));
  return {dkimStrictUnsupported:strict("adkim"),spfStrict:strict("aspf")};
}

export function senderAddress(localPart:string,visibleDomain:string){
  const local=localPart.trim().toLowerCase(),domain=canonicalDnsName(visibleDomain);
  if(!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(domain))throw new Error("INVALID_DOMAIN");
  if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/i.test(local)||local.startsWith(".")||local.endsWith(".")||local.includes(".."))throw new Error("SENDER_LOCAL_PART_INVALID");
  return `${local}@${domain}`;
}

export interface DomainReadinessInput {
  delegationVerified:boolean;identityVerified:boolean;dkimVerified:boolean;mailFromVerified:boolean;
  trackingReady:boolean;trackingApplicable:boolean;dmarcValid:boolean;senderIdentityExists:boolean;
  businessReady:boolean;feedbackReady:boolean;unsubscribeReady:boolean;routeActive:boolean;held:boolean;dmarcRequired?:boolean;
}

export function v3LifecycleState(input:{
  deleting?:boolean;deleted?:boolean;failed?:boolean;
  dnsVerified:boolean;ownershipVerified:boolean;
  sesIdentitySuccess:boolean;dkimSuccess:boolean;ready:boolean;
  previous?:string|null;
}): DomainLifecycleState {
  if(input.deleted)return "DELETED";
  if(input.deleting)return "DELETING";
  if(input.failed)return "FAILED";
  if(input.ready)return "READY";
  if(!input.dnsVerified)return "WAITING_FOR_DNS";
  if(!input.ownershipVerified)return "DNS_VERIFIED";
  if(!input.sesIdentitySuccess){
    const prev=input.previous??"";
    if(prev==="OWNERSHIP_VERIFIED"||prev==="SES_VERIFYING"||prev==="DKIM_VERIFYING")return "SES_VERIFYING";
    return "OWNERSHIP_VERIFIED";
  }
  return "DKIM_VERIFYING";
}

export function evaluateDomainReadiness(input:DomainReadinessInput):{status:DomainReadinessStatus;lifecycle:DomainLifecycleState;reasons:DomainReasonCode[]}{
  const reasons:DomainReasonCode[]=[];
  if(!input.delegationVerified)reasons.push("DNS_DELEGATION_PENDING");
  if(!input.identityVerified)reasons.push("EMAIL_IDENTITY_PENDING");
  if(!input.dkimVerified)reasons.push("DKIM_PENDING");
  if(!input.mailFromVerified)reasons.push("MAIL_FROM_PENDING");
  if(input.trackingApplicable&&!input.trackingReady)reasons.push("TRACKING_HTTPS_PENDING");
  if(!input.dmarcValid)reasons.push("DMARC_WARNING");
  if(!input.senderIdentityExists)reasons.push("SENDER_IDENTITY_MISSING");
  if(!input.businessReady)reasons.push("BUSINESS_INFORMATION_MISSING");
  if(!input.feedbackReady)reasons.push("FEEDBACK_NOT_READY");
  if(!input.unsubscribeReady)reasons.push("UNSUBSCRIBE_NOT_READY");
  if(!input.routeActive)reasons.push("ROUTE_NOT_ACTIVE");
  if(input.held)reasons.push("WORKSPACE_HELD");
  const blocking=reasons.filter(reason=>(reason!=="DMARC_WARNING"||input.dmarcRequired)&&reason!=="SENDER_IDENTITY_MISSING");
  if(input.held)return {status:"held",lifecycle:"held",reasons};
  if(blocking.length)return {status:"not_ready",lifecycle:input.delegationVerified?"authentication_verifying":"awaiting_customer_dns",reasons};
  if(reasons.length)return {status:"warning",lifecycle:"warning",reasons};
  return {status:"ready",lifecycle:"ready",reasons};
}
