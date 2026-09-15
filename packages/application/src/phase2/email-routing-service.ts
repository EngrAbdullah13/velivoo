import type { P2DeliveryRoute, P2SenderDomain, P2SenderIdentity, P2WorkspaceProviderConfig, Phase2Repository } from "../ports/phase2-repository.js";

export interface ResolvedEmailRoute {identity:P2SenderIdentity;domain:P2SenderDomain;route:P2DeliveryRoute|null;providerMapping:P2WorkspaceProviderConfig|null;ready:boolean;reason?:string;providerRegion?:string;configurationSetName?:string;trackingBaseUrl?:string}
export class EmailRoutingService {
  constructor(private readonly repo:Phase2Repository,private readonly platformTrackingBaseUrl:string){}
  async resolve(input:{workspaceId:string;senderIdentityId:string;messagePurpose:string}):Promise<ResolvedEmailRoute>{
    const identity=await this.repo.senderIdentity(input.workspaceId,input.senderIdentityId);if(!identity)return Promise.reject(new Error("SENDER_NOT_FOUND"));
    const domain=await this.repo.senderDomain(input.workspaceId,identity.domainId);if(!domain)return Promise.reject(new Error("SENDER_DOMAIN_NOT_FOUND"));
    const providerMapping=await this.repo.workspaceProviderConfig(input.workspaceId,"ses"),deliveryRoute=this.repo.deliveryRoute?await this.repo.deliveryRoute(input.workspaceId,domain.id):null;
    if(domain.workspacePrimary===false)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"WORKSPACE_SENDING_DOMAIN_NOT_CURRENT"};
    if(domain.provisioningMode==="static_branded"){
      if(identity.status!=="active")return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_NOT_ACTIVE"};
      const isTest=input.messagePurpose==="test";
      const purposeReady=isTest?domain.authenticationStatus==="verified":domain.readinessStatus==="ready";
      if(!purposeReady)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:isTest?"DOMAIN_NOT_READY":"PRODUCTION_NOT_READY"};
      if(!deliveryRoute||deliveryRoute.status!=="active")return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:deliveryRoute?.holdReason??"ROUTE_NOT_ACTIVE"};
      const fromDomain=identity.fromEmail.split("@")[1]?.toLowerCase(),expected=(domain.rootDomain??domain.domain).toLowerCase();
      if(fromDomain!==expected)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_ROUTE_IDENTITY_MISMATCH"};
      if(deliveryRoute.providerIdentityReference&&deliveryRoute.providerIdentityReference.toLowerCase()!==expected)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_ROUTE_IDENTITY_MISMATCH"};
      if(domain.providerRegion&&deliveryRoute.providerRegion&&domain.providerRegion!==deliveryRoute.providerRegion)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_ROUTE_REGION_MISMATCH"};
      if(!deliveryRoute.mailFromDomain)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"MAIL_FROM_PENDING"};
      const trackingBaseUrl=deliveryRoute.trackingMode==="platform"?this.platformTrackingBaseUrl:deliveryRoute.trackingHostname?`https://${deliveryRoute.trackingHostname}`:undefined;
      return {identity,domain,route:deliveryRoute,providerMapping,ready:true,providerRegion:deliveryRoute.providerRegion,configurationSetName:deliveryRoute.configurationSetName??undefined,trackingBaseUrl};
    }
    if(domain.provisioningMode==="branded_delegation"){
      if(identity.status!=="active")return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_NOT_ACTIVE"};
      if(domain.authenticationStatus!=="verified"||!["ready","warning"].includes(domain.readinessStatus??""))return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"DOMAIN_NOT_READY"};
      if(!deliveryRoute||deliveryRoute.status!=="active")return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:deliveryRoute?.holdReason??"ROUTE_NOT_ACTIVE"};
      const rootSender=["V2_ROOT_SENDER_DELEGATED_INFRA","V3_ROOT_SENDER_DELEGATED_EASY_DKIM","V3_ROOT_SENDER_PLATFORM_DKIM"].includes(domain.provisioningVersion??"");
      const fromDomain=identity.fromEmail.split("@")[1]?.toLowerCase(),expected=rootSender?(domain.rootDomain??domain.domain).toLowerCase():(domain.delegatedSubdomain??domain.domain).toLowerCase();
      if(fromDomain!==expected||deliveryRoute.providerIdentityReference!==expected)return {identity,domain,route:deliveryRoute,providerMapping,ready:false,reason:"SENDER_ROUTE_IDENTITY_MISMATCH"};
      const trackingBaseUrl=deliveryRoute.trackingMode==="platform"?this.platformTrackingBaseUrl:deliveryRoute.trackingHostname?`https://${deliveryRoute.trackingHostname}`:undefined;
      return {identity,domain,route:deliveryRoute,providerMapping,ready:true,providerRegion:deliveryRoute.providerRegion,configurationSetName:deliveryRoute.configurationSetName??undefined,trackingBaseUrl};
    }
    // Legacy routes predate workspace provider mappings. Keep their established
    // verified sender compatibility; the configured delivery provider remains
    // responsible for server-side region and configuration requirements.
    const ready=identity.status==="active"&&domain.status==="verified";
    return {identity,domain,route:null,providerMapping,ready,reason:ready?undefined:"DOMAIN_NOT_READY",providerRegion:domain.providerRegion??providerMapping?.region,configurationSetName:providerMapping?.configurationSetName??undefined,trackingBaseUrl:this.platformTrackingBaseUrl};
  }
}
