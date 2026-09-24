import { randomUUID } from "node:crypto";
import { customerDnsUsesProviderBranding, delegatedEasyDkimRecords, infraDomain, isDelegatedEasyDkimVersion, isRootSenderVersion, isStaticBrandedMode, mailFromDomain, SETUP_MODE_MANAGED_DELEGATION, SETUP_MODE_STATIC_BRANDED, trackingDomain, VELIVOO_OWNERSHIP_PREFIX, v3LifecycleState, V2_ROOT_SENDER_DELEGATED_INFRA, V3_ROOT_SENDER_DELEGATED_EASY_DKIM, V3_ROOT_SENDER_PLATFORM_DKIM } from "../../../domain/src/phase1/branded-domain.js";
import { generateOwnershipToken, hashOwnershipToken } from "../../../domain/src/phase1/dkim-key.js";
import { canonicalDnsName, normalizeDomain, txtMatches } from "../../../domain/src/phase1/dns.js";
import type { DnsCheckEvidence, DnsProvider, ManagedDnsRecord } from "../ports/dns-provider.js";
import type { DomainProvisioningRepository, ProvisioningDomain } from "../ports/domain-provisioning-repository.js";
import type { EmailDomainIdentityState, EmailDomainProvider } from "../ports/email-domain-provider.js";
import type { TrackingDomainProvisioner, TrackingDomainState } from "../ports/tracking-domain-provisioner.js";
import type { StaticBrandedProvisioner } from "./static-branded-provisioner.js";
import { velivooOwnershipRecord } from "./velivoo-ownership.js";

export interface BrandedDomainConfig {
  sendingPrefix:string;mailFromPrefix:string;trackingPrefix:string;sesRegion:string;delegationSetReference?:string;
  brandedNameserverDomain?:string;vanityNameservers:string[];snsTopicArn?:string;dmarcPolicy:string;dmarcRequired:boolean;
}

const TERMINAL=new Set(["DELETING","DELETED","deleted","archived"]);
const validDmarc=(value:string)=>/^v=DMARC1\s*;/i.test(value.trim())&&/;\s*p=(none|quarantine|reject)(?:\s*;|$)/i.test(value.trim());
const errorCode=(error:unknown)=>error instanceof Error?(error.message.split(":")[0]||"DOMAIN_PROVISIONING_FAILED"):"DOMAIN_PROVISIONING_FAILED";
const retryable=new Set(["AWS_THROTTLED","DNS_DELEGATION_PENDING","DNS_DELEGATION_MISMATCH","DNS_TIMEOUT","DNS_SERVFAIL","SOA_VERIFICATION_PENDING","OWNERSHIP_VERIFICATION_PENDING","EMAIL_IDENTITY_PENDING","SES_VERIFICATION_PENDING","DKIM_PENDING","DKIM_RECORDS_PENDING","MAIL_FROM_PENDING"]);
const verified=(e:DnsCheckEvidence)=>e.status==="verified";
const success=(value?:string|null)=>String(value??"").toUpperCase()==="SUCCESS";
function deleteTrace(step:string,payload:Record<string,unknown>){console.error(JSON.stringify({event:"domain.delete",step,at:new Date().toISOString(),...payload}))}

export class DomainProvisioningService {
  constructor(private readonly repo:DomainProvisioningRepository,private readonly dns:DnsProvider|undefined,private readonly email:EmailDomainProvider|undefined,private readonly tracking:TrackingDomainProvisioner|undefined,private readonly cfg:BrandedDomainConfig,private readonly staticBranded?:StaticBrandedProvisioner){}

  private assertInfrastructure(){
    if(!this.dns||!this.cfg.delegationSetReference)throw new Error("DNS_PROVIDER_NOT_CONFIGURED");
    if(!this.email)throw new Error("EMAIL_DOMAIN_PROVIDER_NOT_CONFIGURED");
    if(this.cfg.vanityNameservers.length!==4)throw new Error("VANITY_NAMESERVERS_NOT_CONFIGURED");
    if(this.cfg.brandedNameserverDomain&&this.cfg.vanityNameservers.some(name=>!canonicalDnsName(name).endsWith(`.${canonicalDnsName(this.cfg.brandedNameserverDomain!)}`)))throw new Error("VANITY_NAMESERVER_MAPPING_INVALID");
  }

  private async withLock<T>(domain:ProvisioningDomain,run:()=>Promise<T>){
    const owner=`domain:${randomUUID()}`,claimed=await this.repo.claimDomainProvisioning({workspaceId:domain.workspaceId,senderDomainId:domain.id,owner,leaseUntil:new Date(Date.now()+120_000)});
    if(!claimed)throw new Error("DOMAIN_PROVISIONING_IN_PROGRESS");
    try{return await run()}finally{await this.repo.releaseDomainProvisioning({workspaceId:domain.workspaceId,senderDomainId:domain.id,owner})}
  }

  private currentVersion(domain:ProvisioningDomain){
    return domain.provisioningVersion===V2_ROOT_SENDER_DELEGATED_INFRA?V2_ROOT_SENDER_DELEGATED_INFRA:V3_ROOT_SENDER_DELEGATED_EASY_DKIM;
  }


  private async resetAttempt(domain:ProvisioningDomain){
    return this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{
      lifecycleState:"CREATED",status:"pending",authenticationStatus:"pending",readinessStatus:"not_ready",readinessReasons:["HOSTED_ZONE_PROVISIONING"],
      provisioningCallerReference:`sender-domain:${domain.id}:${randomUUID()}`,provisioningLeaseOwner:null,provisioningLeaseExpiresAt:null,
      expectedRecords:[],observedRecords:[],providerReference:null,providerStatus:null,providerEvidence:null,verificationStatus:null,dkimStatus:null,mailFromStatus:null,dmarcStatus:null,dmarcObservation:null,
      dkimTokens:null,dkimSigningHostedZone:null,dkimSigningMode:null,dkimSigningDomain:null,dkimSelector:null,ownershipVerificationToken:null,
      delegationStatus:null,soaStatus:null,dnsProvider:null,hostedZoneReference:null,delegationSetReference:null,
      trackingProvider:null,trackingTenantReference:null,trackingConnectionGroupReference:null,trackingRoutingEndpoint:null,trackingCertificateReference:null,trackingCertificateStatus:null,trackingHttpsStatus:null,trackingValidationMethod:null,
      disconnectStatus:null,lastCheckedAt:null,verifiedAt:null,lastErrorCode:null,lastErrorMessage:null,
    }});
  }

  private easyDkimRecords(identity:EmailDomainIdentityState,root:string,infra:string,delegated:boolean){
    if(identity.dkimRecords.length!==3||!identity.dkimSigningHostedZone)throw new Error("DKIM_EVIDENCE_UNAVAILABLE");
    return delegated?delegatedEasyDkimRecords(identity.dkimRecords,root,infra):identity.dkimRecords;
  }

  private resolveVelivooOwnershipToken(domain:ProvisioningDomain){
    const stored=String(domain.ownershipVerificationToken??"").trim();
    if(stored.startsWith(VELIVOO_OWNERSHIP_PREFIX))return stored.slice(VELIVOO_OWNERSHIP_PREFIX.length);
    if(stored)return stored;
    return generateOwnershipToken();
  }

  private velivooOwnership(root:string,domain:ProvisioningDomain){
    const token=this.resolveVelivooOwnershipToken(domain);
    return {token,tokenHash:hashOwnershipToken(token),record:velivooOwnershipRecord(root,token)};
  }

  private customerRecordsFromEvidence(records:Awaited<ReturnType<DomainProvisioningRepository["listDnsEvidence"]>>,domain:ProvisioningDomain){
    const allowLegacyProviderDkim=domain.provisioningVersion===V2_ROOT_SENDER_DELEGATED_INFRA;
    return records.filter(record=>record.customerActionRequired!==false&&!customerDnsUsesProviderBranding({name:record.name,value:record.expectedValue,purpose:record.purpose},{allowLegacyProviderDkim})).map(record=>({type:record.recordType,name:record.name,value:record.expectedValue,purpose:record.purpose,status:record.verificationStatus,observedValues:record.observedValues,lastCheckedAt:record.lastCheckedAt}));
  }

  private async recordEasyDkimIdentity(domain:ProvisioningDomain,identity:EmailDomainIdentityState,records:ManagedDnsRecord[],customerRequired:boolean){
    for(const record of records)await this.repo.upsertDnsEvidence({workspaceId:domain.workspaceId,senderDomainId:domain.id,purpose:"dkim",ownership:customerRequired?"customer":"platform",record,verificationStatus:"pending",customerActionRequired:customerRequired,lastCheckedAt:new Date()});
    return this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{providerReference:identity.reference,providerRegion:this.email!.region,providerStatus:identity.identityVerified?"verified":"pending",verificationStatus:identity.verificationStatus,dkimStatus:identity.dkimStatus,mailFromStatus:identity.mailFromStatus,dkimTokens:identity.dkimTokens,dkimSigningHostedZone:identity.dkimSigningHostedZone,dkimSigningMode:customerRequired?null:"ses_easy_dkim",dkimSigningDomain:customerRequired?null:domain.delegatedSubdomain??null,dkimSelector:null}});
  }

  private async publishDelegatedEasyDkim(domain:ProvisioningDomain,zoneReference:string,records:ManagedDnsRecord[]){
    for(const record of records){
      await this.dns!.upsertRecord({zoneReference,record});
      await this.repo.upsertDnsEvidence({workspaceId:domain.workspaceId,senderDomainId:domain.id,purpose:"dkim",ownership:"platform",record,verificationStatus:"pending",customerActionRequired:false,lastCheckedAt:new Date()});
    }
  }

  private async audit(domain:ProvisioningDomain,action:string,after?:unknown,before?:unknown){
    if(!this.repo.recordAudit)return;
    await this.repo.recordAudit({workspaceId:domain.workspaceId,action,objectId:domain.id,riskLevel:"high",after,before});
  }

  private async prepareUnlocked(domain:ProvisioningDomain){
    const version=this.currentVersion(domain),isV3=isDelegatedEasyDkimVersion(version);
    this.assertInfrastructure();
    const root=domain.rootDomain??domain.domain,infra=domain.delegatedSubdomain??infraDomain(root),caller=domain.provisioningCallerReference??`sender-domain:${domain.id}`;
    await this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{lifecycleState:"CREATED",provisioningVersion:version,provisioningCallerReference:domain.provisioningCallerReference??`sender-domain:${domain.id}`,lastErrorCode:null,lastErrorMessage:null}});
    await this.repo.retireCustomerDnsEvidence(domain.workspaceId,domain.id);
    const zone=await this.dns!.ensureZone({domain:infra,existingReference:domain.hostedZoneReference,delegationSetReference:this.cfg.delegationSetReference!,callerReference:domain.provisioningCallerReference??caller});
    domain=await this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{hostedZoneReference:zone.reference,delegationSetReference:this.cfg.delegationSetReference,dnsProvider:this.dns!.provider,delegatedSubdomain:infra,lifecycleState:"CREATED"}});
    const identity=await this.email!.ensureIdentity({domain:root,existingReference:domain.providerReference,workspaceId:domain.workspaceId,senderDomainId:domain.id});
    const dkimRecords=this.easyDkimRecords(identity,root,infra,isV3);
    if(isV3){
      await this.publishDelegatedEasyDkim(domain,zone.reference,dkimRecords);
      domain=await this.recordEasyDkimIdentity(domain,identity,dkimRecords,false);
    }else{
      domain=await this.recordEasyDkimIdentity(domain,identity,dkimRecords,true);
    }
    const ownershipMeta=isV3?this.velivooOwnership(root,domain):null;
    const ownership=ownershipMeta?.record??null;
    const ns=this.cfg.vanityNameservers.map(canonicalDnsName);
    for(const nameserver of ns)await this.repo.upsertDnsEvidence({workspaceId:domain.workspaceId,senderDomainId:domain.id,purpose:"delegation",ownership:"customer",record:{type:"NS",name:infra,values:[nameserver],ttl:3600},verificationStatus:"pending",customerActionRequired:true});
    if(ownership)await this.repo.upsertDnsEvidence({workspaceId:domain.workspaceId,senderDomainId:domain.id,purpose:"ownership",ownership:"customer",record:ownership,verificationStatus:"pending",customerActionRequired:true});
    const expectedRecords=ns.map(value=>({type:"NS",host:infra,value,required:true})).concat(
      isV3&&ownership?[{type:ownership.type,host:ownership.name,value:ownership.values[0]!,required:true}]:dkimRecords.map(record=>({type:record.type,host:record.name,value:record.values[0]!,required:true})),
    );
    domain=await this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{expectedRecords,lifecycleState:isV3?"WAITING_FOR_DNS":"AWAITING_CUSTOMER_DNS",delegationStatus:"pending",soaStatus:"pending",readinessStatus:"not_ready",readinessReasons:["DNS_DELEGATION_PENDING",isV3?"OWNERSHIP_VERIFICATION_PENDING":"DKIM_RECORDS_PENDING"],mailFromDomain:mailFromDomain(root),trackingDomain:trackingDomain(root),ownershipVerificationToken:ownershipMeta?.token??null,ownershipVerificationTokenHash:ownershipMeta?.tokenHash??null,ownershipVerificationStatus:"pending"}});
    return domain;
  }

  async create(workspaceId:string,rootInput:string,setupMode?:string){
    if(setupMode===SETUP_MODE_STATIC_BRANDED){
      if(!this.staticBranded)throw new Error("STATIC_DNS_NOT_CONFIGURED");
      return this.staticBranded.create(workspaceId,rootInput);
    }
    const rootDomain=normalizeDomain(rootInput),foreign=await this.repo.findProvisioningDomainOutsideWorkspace(workspaceId,rootDomain);
    if(foreign)throw new Error("DOMAIN_ALREADY_CLAIMED");
    const primary=await this.repo.findWorkspacePrimaryProvisioningDomain(workspaceId);
    let domain=await this.repo.findProvisioningDomainByRoot(workspaceId,rootDomain);
    if(primary&&primary.id!==domain?.id)throw new Error("WORKSPACE_SENDING_DOMAIN_EXISTS");
    if(domain&&!isRootSenderVersion(domain.provisioningVersion))return this.customerView(domain);
    if(!domain)domain=await this.repo.createBrandedDomain({workspaceId,rootDomain,delegatedSubdomain:infraDomain(rootDomain),region:this.cfg.sesRegion,provisioningVersion:V3_ROOT_SENDER_DELEGATED_EASY_DKIM});
    const lifecycle=String(domain.lifecycleState??"").toUpperCase();
    if(lifecycle==="DELETING")throw new Error("DOMAIN_PROVISIONING_IN_PROGRESS");
    if(lifecycle==="DELETED")domain=await this.resetAttempt(domain);
    const first=!domain.hostedZoneReference;
    try{
      const view=await this.withLock(domain,async()=>this.customerView(await this.prepareUnlocked(domain!)));
      if(first)await this.audit(domain,"domain.created",{rootDomain,provisioningVersion:view.provisioningVersion,expectedRecordCount:view.customerRecords.length});
      return view;
    }catch(error){await this.fail(domain,error);throw error}
  }

  private async fail(domain:ProvisioningDomain,error:unknown){
    if(TERMINAL.has(String(domain.lifecycleState??"")))return;
    const code=errorCode(error),isRetryable=retryable.has(code),isV3=isDelegatedEasyDkimVersion(domain.provisioningVersion);
    const monitoring=new Set(["CREATED","WAITING_FOR_DNS","DNS_VERIFIED","OWNERSHIP_VERIFIED","SES_VERIFYING","DKIM_VERIFYING","AWAITING_CUSTOMER_DNS","DNS_DELEGATED","SES_VERIFIED","MAIL_FROM_CONFIGURING","MAIL_FROM_READY","TRACKING_READY"]);
    await this.repo.updateProvisioningDomain({workspaceId:domain.workspaceId,domainId:domain.id,patch:{lifecycleState:isRetryable?(monitoring.has(domain.lifecycleState)?domain.lifecycleState:(isV3?"WAITING_FOR_DNS":"AWAITING_CUSTOMER_DNS")):(isV3?"FAILED":"failed"),readinessStatus:"not_ready",readinessReasons:[code],lastErrorCode:code,lastErrorMessage:error instanceof Error?error.message:code}});
  }

  private async updateDnsEvidence(domain:ProvisioningDomain,purpose:string,record:ManagedDnsRecord,evidence:DnsCheckEvidence,customerActionRequired:boolean){
    await this.repo.upsertDnsEvidence({workspaceId:domain.workspaceId,senderDomainId:domain.id,purpose,ownership:customerActionRequired?"customer":"platform",record,verificationStatus:evidence.status,customerActionRequired,observedValues:evidence.observed,lastCheckedAt:evidence.checkedAt});
  }

  async recheck(workspaceId:string,domainId:string){
    let domain=await this.repo.findProvisioningDomain(workspaceId,domainId);
    if(!domain)throw new Error("NOT_FOUND");
    if(isStaticBrandedMode(domain.provisioningMode)){
      if(!this.staticBranded)throw new Error("STATIC_DNS_NOT_CONFIGURED");
      return this.staticBranded.recheck(workspaceId,domainId);
    }
    if(TERMINAL.has(String(domain.lifecycleState??"")))return this.customerView(domain);
    if(!isRootSenderVersion(domain.provisioningVersion))throw new Error("DOMAIN_LEGACY_RECHECK_REQUIRED");
    try{return await this.withLock(domain,async()=>{
      const leftoverPlatformDkim=domain!.provisioningVersion===V3_ROOT_SENDER_PLATFORM_DKIM;
      const hostedZoneMissing=domain!.hostedZoneReference?!(await this.dns!.getZone(domain!.hostedZoneReference)):true;
      if(hostedZoneMissing&&String(domain!.lifecycleState??"").toUpperCase()==="FAILED")domain=await this.resetAttempt(domain!);
      if(!domain!.hostedZoneReference||hostedZoneMissing||!domain!.providerReference||leftoverPlatformDkim)domain=await this.prepareUnlocked(domain!);
      const previous=domain!;
      const root=domain!.rootDomain??domain!.domain,infra=domain!.delegatedSubdomain??infraDomain(root),isV3=isDelegatedEasyDkimVersion(domain!.provisioningVersion);
      const identity=isV3
        ? await this.email!.ensureIdentity({domain:root,existingReference:domain!.providerReference,workspaceId,senderDomainId:domain!.id})
        : await this.email!.getIdentity({domain:root,reference:domain!.providerReference});
      const dkimRecords=this.easyDkimRecords(identity,root,infra,isV3);
      if(isV3){
        await this.publishDelegatedEasyDkim(domain!,domain!.hostedZoneReference!,dkimRecords);
        domain=await this.recordEasyDkimIdentity(domain!,identity,dkimRecords,false);
      }else{
        domain=await this.recordEasyDkimIdentity(domain!,identity,dkimRecords,true);
      }
      const ownershipMeta=this.velivooOwnership(root,domain!);
      const ownership=ownershipMeta.record;
      const delegation=await this.dns!.checkDelegation({domain:infra,expectedNameservers:this.cfg.vanityNameservers}),soa=await this.dns!.checkSoa({domain:infra,expectedPrimary:this.cfg.vanityNameservers[0]!});
      for(const nameserver of this.cfg.vanityNameservers)await this.repo.upsertDnsEvidence({workspaceId,senderDomainId:domain!.id,purpose:"delegation",ownership:"customer",record:{type:"NS",name:infra,values:[canonicalDnsName(nameserver)],ttl:3600},verificationStatus:delegation.status,customerActionRequired:true,observedValues:delegation.observed,lastCheckedAt:delegation.checkedAt});
      let ownershipVerified=!isV3;
      if(isV3){
        const txt=await this.dns!.resolveTxt(ownership.name);
        ownershipVerified=verified(txt)&&txtMatches(txt.observed,ownership.values[0]!);
        await this.updateDnsEvidence(domain!,"ownership",ownership,{...txt,status:ownershipVerified?"verified":(txt.status==="verified"?"mismatch":txt.status),expected:ownership.values},true);
      }
      const dkimChecks=await Promise.all(dkimRecords.map(record=>this.dns!.checkCname({name:record.name,expectedTarget:record.values[0]!})));
      for(let i=0;i<dkimRecords.length;i++)await this.updateDnsEvidence(domain!,"dkim",dkimRecords[i]!,dkimChecks[i]!,!isV3);
      const dmarc=await this.dns!.resolveTxt(`_dmarc.${root}`),dmarcValue=dmarc.observed.find(validDmarc)??null;
      const dmarcObservation={status:dmarcValue?"observed":dmarc.status,value:dmarcValue,observedValues:dmarc.observed,checkedAt:dmarc.checkedAt.toISOString(),dkimAlignment:"provider_easy_dkim",spfAlignment:"mail_from"};
      const dkimPublic=dkimChecks.length===3&&dkimChecks.every(verified);
      const dnsVerified=delegation.status==="verified"&&verified(soa);
      const sesIdentitySuccess=success(identity.verificationStatus);
      const dkimReady=success(identity.dkimStatus)&&dkimPublic;
      const publicReady=dnsVerified&&(isV3?ownershipVerified:dkimPublic);
      const sesReady=identity.identityVerified&&dkimReady;
      const reasons:string[]=[];
      if(delegation.status!=="verified")reasons.push(delegation.status==="mismatch"?"DNS_DELEGATION_MISMATCH":delegation.status==="timeout"?"DNS_TIMEOUT":delegation.status==="servfail"?"DNS_SERVFAIL":"DNS_DELEGATION_PENDING");
      if(!verified(soa))reasons.push("SOA_VERIFICATION_PENDING");
      if(isV3&&!ownershipVerified)reasons.push("OWNERSHIP_VERIFICATION_PENDING");
      if(!isV3&&!dkimPublic)reasons.push("DKIM_RECORDS_PENDING");
      if(isV3&&!sesIdentitySuccess)reasons.push(identity.verificationStatus==="FAILED"?"SES_VERIFICATION_FAILED":"SES_VERIFICATION_PENDING");
      if(!dkimReady)reasons.push(identity.dkimStatus==="FAILED"?"SES_VERIFICATION_FAILED":isV3?"DKIM_PENDING":"DKIM_RECORDS_PENDING");
      let latest=identity,lifecycle=isV3
        ? v3LifecycleState({dnsVerified,ownershipVerified,sesIdentitySuccess,dkimSuccess:dkimReady,ready:false,previous:previous.lifecycleState})
        : (publicReady?"DNS_DELEGATED":"AWAITING_CUSTOMER_DNS");
      if(publicReady&&sesReady){
        if(!isV3)lifecycle="SES_VERIFIED";
        const mf=mailFromDomain(root),mailRecords=await this.email!.configureMailFrom({domain:root,mailFromDomain:mf});
        if(!isV3)lifecycle="MAIL_FROM_CONFIGURING";
        for(const record of mailRecords){await this.dns!.upsertRecord({zoneReference:domain!.hostedZoneReference!,record});await this.repo.upsertDnsEvidence({workspaceId,senderDomainId:domain!.id,purpose:"mail_from",ownership:"platform",record,verificationStatus:"pending",customerActionRequired:false,lastCheckedAt:new Date()})}
        latest=await this.email!.getIdentity({domain:root,reference:domain!.providerReference});
        if(success(latest.mailFromStatus)){if(!isV3)lifecycle="MAIL_FROM_READY"}else reasons.push("MAIL_FROM_PENDING");
      }
      const mapping=await this.repo.upsertWorkspaceProviderConfig({workspaceId,provider:this.email!.provider,region:this.email!.region}),configuration=await this.email!.ensureWorkspaceConfigurationSet({workspaceId,existingName:mapping.configurationSetName,snsTopicArn:this.cfg.snsTopicArn});
      await this.repo.updateWorkspaceProviderConfigurationSet(workspaceId,this.email!.provider,configuration.name);if(this.email!.associateConfigurationSet)await this.email!.associateConfigurationSet({domain:root,configurationSetName:configuration.name});
      const quota=await this.email!.readQuota(),fetchedAt=new Date();await this.repo.upsertProviderQuotaSnapshot({provider:this.email!.provider,region:this.email!.region,...quota,fetchedAt,expiresAt:new Date(fetchedAt.getTime()+5*60_000)});
      let trackingState:TrackingDomainState|undefined;
      if(success(latest.mailFromStatus)&&this.tracking){trackingState=await this.tracking.ensure({workspaceId,senderDomainId:domain!.id,hostname:trackingDomain(root),zoneReference:domain!.hostedZoneReference!,current:{hostname:trackingDomain(root),tenantReference:domain!.trackingTenantReference??undefined,connectionGroupReference:domain!.trackingConnectionGroupReference??undefined,routingEndpoint:domain!.trackingRoutingEndpoint??undefined,certificateReference:domain!.trackingCertificateReference??undefined,certificateStatus:domain!.trackingCertificateStatus??undefined,httpsStatus:domain!.trackingHttpsStatus??undefined,validationMethod:domain!.trackingValidationMethod as TrackingDomainState["validationMethod"]|undefined}});for(const record of trackingState.validationRecords){await this.dns!.upsertRecord({zoneReference:domain!.hostedZoneReference!,record});await this.repo.upsertDnsEvidence({workspaceId,senderDomainId:domain!.id,purpose:"certificate_validation",ownership:"platform",record,verificationStatus:trackingState.certificateStatus.toLowerCase()==="issued"?"verified":"pending",customerActionRequired:false,validationMethod:trackingState.validationMethod,lastCheckedAt:new Date()})}if(trackingState.dnsRecord){await this.dns!.upsertRecord({zoneReference:domain!.hostedZoneReference!,record:trackingState.dnsRecord});await this.repo.upsertDnsEvidence({workspaceId,senderDomainId:domain!.id,purpose:"tracking",ownership:"platform",record:trackingState.dnsRecord,verificationStatus:trackingState.ready?"verified":"pending",customerActionRequired:false,validationMethod:trackingState.validationMethod,lastCheckedAt:new Date()})}if(trackingState.ready){if(!isV3)lifecycle="TRACKING_READY"}else reasons.push("TRACKING_HTTPS_PENDING")}
      const trackingReady=!this.tracking||trackingState?.ready===true,operational=await this.repo.workspaceOperationalReadiness(workspaceId),authenticationVerified=publicReady&&sesReady&&success(latest.mailFromStatus);
      if(!configuration.feedbackReady||!operational.feedbackReady)reasons.push("FEEDBACK_NOT_READY");if(!operational.unsubscribeReady)reasons.push("UNSUBSCRIBE_NOT_READY");if(!operational.businessReady)reasons.push("BUSINESS_INFORMATION_MISSING");if(operational.held)reasons.push("WORKSPACE_HELD");if(this.cfg.dmarcRequired&&!dmarcValue)reasons.push("DMARC_WARNING");
      const routeActive=authenticationVerified&&trackingReady&&configuration.feedbackReady&&operational.feedbackReady&&operational.unsubscribeReady&&operational.businessReady&&!operational.held&&(!this.cfg.dmarcRequired||Boolean(dmarcValue));
      const route=await this.repo.upsertDeliveryRoute({workspaceId,senderDomainId:domain!.id,provider:this.email!.provider,providerRegion:this.email!.region,providerIdentityReference:latest.reference,configurationSetName:configuration.name,mailFromDomain:mailFromDomain(root),trackingMode:trackingState?.mode??"platform",trackingHostname:trackingState?.hostname,status:routeActive?"active":"held",holdReason:routeActive?null:"DOMAIN_NOT_READY",rateLimitPerSecond:quota.maxSendRate?Math.max(1,Math.floor(quota.maxSendRate*.8)):undefined,warmingDailyLimit:quota.max24Hour?Math.max(1,Math.floor(quota.max24Hour*.8)):undefined});
      if(route.status==="active")lifecycle="READY";
      else if(isV3)lifecycle=v3LifecycleState({dnsVerified,ownershipVerified,sesIdentitySuccess:success(latest.verificationStatus),dkimSuccess:success(latest.dkimStatus)&&dkimPublic,ready:false,previous:previous.lifecycleState});
      const interrupting=await this.repo.findProvisioningDomain(workspaceId,domainId);
      if(!interrupting||TERMINAL.has(String(interrupting.lifecycleState??""))){
        deleteTrace("recheck.skipped_terminal",{workspaceId,domainId,lifecycleState:interrupting?.lifecycleState??null});
        return this.customerView(interrupting??domain!);
      }
      domain=await this.repo.updateProvisioningDomain({workspaceId,domainId,patch:{providerStatus:latest.identityVerified?"verified":"pending",verificationStatus:latest.verificationStatus,dkimStatus:latest.dkimStatus,mailFromStatus:latest.mailFromStatus,delegationStatus:delegation.status,soaStatus:soa.status,dmarcStatus:dmarcValue?"verified":"warning",dmarcObservation,mailFromDomain:mailFromDomain(root),trackingDomain:trackingDomain(root),trackingProvider:trackingState?.provider,trackingTenantReference:trackingState?.tenantReference,trackingConnectionGroupReference:trackingState?.connectionGroupReference,trackingRoutingEndpoint:trackingState?.routingEndpoint,trackingCertificateReference:trackingState?.certificateReference,trackingCertificateStatus:trackingState?.certificateStatus,trackingHttpsStatus:trackingState?.httpsStatus,trackingValidationMethod:trackingState?.validationMethod,authenticationStatus:authenticationVerified?"verified":"pending",status:routeActive?"verified":"pending",lifecycleState:lifecycle,readinessStatus:routeActive?"ready":"not_ready",readinessReasons:[...new Set(reasons)],lastCheckedAt:new Date(),verifiedAt:authenticationVerified?new Date():null,lastErrorCode:null,lastErrorMessage:null,...(isV3?{ownershipVerificationToken:ownershipMeta.token,ownershipVerificationTokenHash:ownershipMeta.tokenHash,ownershipVerificationStatus:ownershipVerified?"verified":"pending",ownershipVerifiedAt:ownershipVerified?new Date():null}: {})}});
      if(dnsVerified&&previous.delegationStatus!=="verified")await this.audit(domain,"domain.dns.verified",{delegation:delegation.status,soa:soa.status});
      if(sesIdentitySuccess&&!success(previous.verificationStatus))await this.audit(domain,"domain.ses.verified",{verificationStatus:latest.verificationStatus});
      if(dkimReady&&!success(previous.dkimStatus))await this.audit(domain,"domain.dkim.verified",{dkimStatus:latest.dkimStatus});
      return this.customerView(domain);
    })}catch(error){await this.fail(domain,error);throw error}
  }

  async retryProvisioning(workspaceId:string,domainId:string){
    const domain=await this.repo.findProvisioningDomain(workspaceId,domainId);
    if(!domain)throw new Error("NOT_FOUND");
    if(isStaticBrandedMode(domain.provisioningMode)){
      if(!this.staticBranded)throw new Error("STATIC_DNS_NOT_CONFIGURED");
      return this.staticBranded.retryProvisioning(workspaceId,domainId);
    }
    return this.recheck(workspaceId,domainId);
  }

  async customerView(domain:ProvisioningDomain){
    if(isStaticBrandedMode(domain.provisioningMode)&&this.staticBranded)return this.staticBranded.enrichCustomerView(domain,this.staticBranded.customerView(domain));
    const records=await this.repo.listDnsEvidence(domain.workspaceId,domain.id,true),root=domain.rootDomain??domain.domain;
    const reasonList=Array.isArray(domain.readinessReasons)?domain.readinessReasons as string[]:[];
    return {id:domain.id,workspaceId:domain.workspaceId,domain:root,rootDomain:root,sendingPurpose:domain.sendingPurpose??null,infraDomain:domain.delegatedSubdomain??infraDomain(root),sendingDomain:root,mailFromDomain:domain.mailFromDomain??mailFromDomain(root),trackingDomain:domain.trackingDomain??trackingDomain(root),provisioningMode:domain.provisioningMode,setupMode:(domain as any).setupMode??SETUP_MODE_MANAGED_DELEGATION,provisioningVersion:domain.provisioningVersion,lifecycleState:domain.lifecycleState,authenticationStatus:domain.authenticationStatus,readinessStatus:domain.readinessStatus,readinessReasons:reasonList,lastCheckedAt:(domain as any).lastCheckedAt??null,checks:{delegation:domain.delegationStatus??"pending",soa:domain.soaStatus??"pending",ownership:records.some(record=>record.purpose==="ownership")?(records.find(record=>record.purpose==="ownership")?.verificationStatus??"pending"):"not_applicable",sesIdentity:domain.verificationStatus??"pending",dkim:domain.dkimStatus??"pending",mailFrom:domain.mailFromStatus??"pending",dmarc:(domain.dmarcObservation as any)?.status??"not_observed"},nextAction:reasonList[0]??(domain.readinessStatus==="ready"?"Domain is ready.":"Velivoo is completing domain setup."),customerRecords:this.customerRecordsFromEvidence(records,domain)};
  }

  async archive(workspaceId:string,domainId:string){
    const domain=await this.repo.findProvisioningDomain(workspaceId,domainId);if(!domain)throw new Error("NOT_FOUND");
    if(isStaticBrandedMode(domain.provisioningMode)&&this.staticBranded)return this.staticBranded.archive(workspaceId,domainId);
    deleteTrace("archive.received",{workspaceId,domainId,lifecycleState:domain.lifecycleState,provisioningVersion:domain.provisioningVersion,hasProviderReference:Boolean(domain.providerReference),hasHostedZone:Boolean(domain.hostedZoneReference),hasTracking:Boolean(domain.trackingDomain)});
    await this.repo.holdDomainRoute(workspaceId,domainId,"DOMAIN_DISCONNECTING");
    if(await this.repo.hasActiveDeliveryAttempts(workspaceId,domainId)){deleteTrace("blocked.active_sends",{workspaceId,domainId});throw new Error("DOMAIN_HAS_ACTIVE_SENDS")}
    const isV3=isDelegatedEasyDkimVersion(domain.provisioningVersion);
    const deleting=isV3||isRootSenderVersion(domain.provisioningVersion)?"DELETING":"held";
    await this.repo.updateProvisioningDomain({workspaceId,domainId,patch:{disconnectStatus:"in_progress",readinessStatus:"held",status:"held",lifecycleState:deleting}});
    deleteTrace("lifecycle.DELETING",{workspaceId,domainId,lifecycleState:deleting});
    try{
      const root=domain.rootDomain??domain.domain;
      const sesIdentity=isRootSenderVersion(domain.provisioningVersion)?root:(domain.delegatedSubdomain??domain.domain);
      let sesAlreadyMissing=false,zoneAlreadyMissing=false,sesDeleteFailed=false,zoneDeleteFailed=false;
      if(this.tracking&&domain.trackingDomain){
        try{await this.tracking.remove({hostname:domain.trackingDomain,tenantReference:domain.trackingTenantReference??undefined})}
        catch(error){deleteTrace("tracking.delete.failed",{workspaceId,domainId,hostname:domain.trackingDomain,code:errorCode(error),message:error instanceof Error?error.message:String(error)})}
      }
      if(this.email&&(domain.providerReference||isRootSenderVersion(domain.provisioningVersion))){
        deleteTrace("ses.delete.start",{workspaceId,domainId,identity:sesIdentity,hasReference:Boolean(domain.providerReference)});
        try{
          const ses=await this.email.removeIdentity({domain:sesIdentity,reference:domain.providerReference??undefined});
          sesAlreadyMissing=Boolean(ses?.alreadyMissing);
          deleteTrace(sesAlreadyMissing?"ses.delete.already_missing":"ses.delete.done",{workspaceId,domainId,identity:sesIdentity});
        }catch(error){
          sesDeleteFailed=true;
          deleteTrace("ses.delete.failed",{workspaceId,domainId,identity:sesIdentity,code:errorCode(error),message:error instanceof Error?error.message:String(error)});
          await this.audit({...domain,lifecycleState:"DELETING"},"domain.ses.delete_failed",{identity:sesIdentity,providerReference:domain.providerReference,code:errorCode(error)});
        }
      }
      else deleteTrace("ses.delete.skipped",{workspaceId,domainId,reason:!this.email?"email_provider_missing":"no_provider_reference"});
      const zoneName=domain.delegatedSubdomain??infraDomain(root),findHostedZone=async()=>this.dns?.findZoneByName&&domain.provisioningCallerReference?await this.dns.findZoneByName(zoneName,domain.provisioningCallerReference):null;
      let hostedZoneReference=domain.hostedZoneReference??(await findHostedZone())?.reference??null;
      if(hostedZoneReference&&this.dns){
        const evidence=await this.repo.listDnsEvidence(workspaceId,domainId,false),allowed=evidence.map(row=>({type:row.recordType as ManagedDnsRecord["type"],name:row.name,values:[row.expectedValue],ttl:300}));
        deleteTrace("route53.cleanup.start",{workspaceId,domainId,hostedZoneReference,allowedRecordCount:allowed.length});
        try{
          let zone=await this.dns.deleteZoneSafely({zoneReference:hostedZoneReference,allowedRecords:allowed});
          if(zone.alreadyMissing){
            const fallback=await findHostedZone();
            if(fallback?.reference&&fallback.reference!==hostedZoneReference){
              hostedZoneReference=fallback.reference;
              deleteTrace("route53.cleanup.fallback",{workspaceId,domainId,hostedZoneReference});
              zone=await this.dns.deleteZoneSafely({zoneReference:hostedZoneReference,allowedRecords:allowed});
            }
          }
          zoneAlreadyMissing=Boolean(zone.alreadyMissing);
          deleteTrace(zoneAlreadyMissing?"route53.cleanup.already_missing":"route53.cleanup.done",{workspaceId,domainId,hostedZoneReference});
        }catch(error){
          zoneDeleteFailed=true;
          deleteTrace("route53.cleanup.failed",{workspaceId,domainId,hostedZoneReference,code:errorCode(error),message:error instanceof Error?error.message:String(error)});
          await this.audit({...domain,lifecycleState:"DELETING"},"domain.route53.delete_failed",{hostedZoneReference,code:errorCode(error)});
        }
      }
      else deleteTrace("route53.cleanup.skipped",{workspaceId,domainId,reason:!this.dns?"dns_provider_missing":"no_hosted_zone_reference"});
      if(sesAlreadyMissing)await this.audit({...domain,lifecycleState:"DELETING"},"domain.ses.already_deleted",{identity:sesIdentity,providerReference:domain.providerReference});
      if(zoneAlreadyMissing)await this.audit({...domain,lifecycleState:"DELETING"},"domain.route53.already_deleted",{hostedZoneReference});
      await this.repo.archiveProvisioningDomain(workspaceId,domainId,new Date());
      deleteTrace("lifecycle.DELETED",{workspaceId,domainId,rootDomain:root,sesAlreadyMissing,zoneAlreadyMissing,sesDeleteFailed,zoneDeleteFailed});
      await this.audit({...domain,lifecycleState:"DELETED"},"domain.deleted",{rootDomain:root,sesIdentityRemoved:Boolean(domain.providerReference||isRootSenderVersion(domain.provisioningVersion))&&!sesDeleteFailed,hostedZoneRemoved:Boolean(hostedZoneReference)&&!zoneDeleteFailed,sesAlreadyMissing,zoneAlreadyMissing,sesDeleteFailed,zoneDeleteFailed});
      return {ok:true,archived:true,cleanupRecords:(await this.repo.listDnsEvidence(workspaceId,domainId,true)).map(row=>({type:row.recordType,name:row.name,value:row.expectedValue}))};
    }catch(error){const code=errorCode(error);deleteTrace("archive.failed",{workspaceId,domainId,code,message:error instanceof Error?error.message:String(error)});await this.repo.updateProvisioningDomain({workspaceId,domainId,patch:{disconnectStatus:"failed",lifecycleState:isDelegatedEasyDkimVersion(domain.provisioningVersion)?"FAILED":domain.lifecycleState,lastErrorCode:code,lastErrorMessage:error instanceof Error?error.message:code}});throw error}
  }
}
