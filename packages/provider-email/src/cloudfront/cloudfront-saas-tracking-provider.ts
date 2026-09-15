import { createHash } from "node:crypto";
import { CloudFrontClient, CreateDistributionTenantCommand, DeleteDistributionTenantCommand, GetDistributionCommand, GetDistributionTenantByDomainCommand, GetDistributionTenantCommand, ListConnectionGroupsCommand, UpdateDistributionTenantCommand } from "@aws-sdk/client-cloudfront";
import type { TrackingDomainProvisioner, TrackingDomainState } from "../../../application/src/ports/tracking-domain-provisioner.js";
import type { ManagedDnsRecord } from "../../../application/src/ports/dns-provider.js";

type CloudFrontSend=Pick<CloudFrontClient,"send">;
function mapped(error:unknown){const name=error&&typeof error==="object"&&"name" in error?String((error as any).name):"";if(["AccessDenied","AccessDeniedException"].includes(name))return new Error("PROVIDER_ACCESS_DENIED");if(["UnrecognizedClientException","InvalidClientTokenId","SignatureDoesNotMatch","CredentialsProviderError"].includes(name))return new Error("PROVIDER_AUTHENTICATION_FAILED");return new Error("TRACKING_PROVIDER_REQUEST_FAILED")}
export class CloudFrontSaasTrackingDomainProvisioner implements TrackingDomainProvisioner {
  readonly provider="cloudfront";readonly mode="cloudfront_saas" as const;
  constructor(private readonly config:{distributionId:string;connectionGroupId?:string;healthPath?:string},private readonly client:CloudFrontSend=new CloudFrontClient({}),private readonly http:typeof fetch=fetch){if(!config.distributionId)throw new Error("TRACKING_PROVIDER_NOT_CONFIGURED")}
  private async platform(){try{const result:any=await this.client.send(new GetDistributionCommand({Id:this.config.distributionId}));if(!result?.Distribution?.Id)throw new Error("TRACKING_MULTI_TENANT_DISTRIBUTION_NOT_FOUND");const connectionMode=result.Distribution?.DistributionConfig?.ConnectionMode;if(connectionMode&&connectionMode!=="tenant-only")throw new Error("TRACKING_MULTI_TENANT_DISTRIBUTION_INVALID")}catch(error){if(error instanceof Error&&error.message.startsWith("TRACKING_"))throw error;throw mapped(error)}}
  private async tenant(hostname:string){try{const result:any=await this.client.send(new GetDistributionTenantByDomainCommand({Domain:hostname}));return result?.DistributionTenant??null}catch(error){if((error as any)?.name==="EntityNotFound")return null;throw mapped(error)}}
  private async connection(id?:string){let marker:string|undefined;do{const result:any=await this.client.send(new ListConnectionGroupsCommand({Marker:marker,MaxItems:100})),items=result?.ConnectionGroupList?.Items??result?.ConnectionGroups??[];const found=items.find((item:any)=>item.Id===(id||this.config.connectionGroupId));if(found)return found;marker=result?.ConnectionGroupList?.NextMarker??result?.NextMarker;if(!marker)break}while(marker);throw new Error("TRACKING_CONNECTION_GROUP_NOT_FOUND")}
  private async httpsReady(hostname:string){try{const response=await this.http(`https://${hostname}${this.config.healthPath??"/health/tracking"}`,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(10_000)});return response.status>=200&&response.status<500}catch{return false}}
  private state(hostname:string,tenant:any,connection:any,httpsReady:boolean,current?:Partial<TrackingDomainState>):TrackingDomainState{
    const domain=tenant?.Domains?.find((item:any)=>String(item.Domain).toLowerCase()===hostname.toLowerCase()),domainActive=String(domain?.Status??"").toLowerCase()==="active",tenantActive=tenant?.Enabled!==false&&["deployed","active"].includes(String(tenant?.Status??"").toLowerCase()),certificateReference=tenant?.Customizations?.Certificate?.Arn;
    // CloudFront is authoritative for certificate/domain validation. Consume
    // records only when AWS actually returns them; never synthesize a
    // `_cf-challenge` or ACM validation record from the hostname.
    const candidates=[domain?.ValidationRecords,domain?.DnsValidationRecords,tenant?.ValidationRecords,tenant?.ManagedCertificateRequest?.ValidationRecords,tenant?.Customizations?.Certificate?.ValidationRecords].flat().filter(Boolean),validationRecords:ManagedDnsRecord[]=candidates.map((record:any)=>({type:String(record.Type??record.ResourceRecord?.Type??"CNAME").toUpperCase() as ManagedDnsRecord["type"],name:String(record.Name??record.ResourceRecord?.Name??""),values:[String(record.Value??record.ResourceRecord?.Value??"")],ttl:Number(record.TTL??record.Ttl??300)})).filter((record:any)=>record.name&&record.values[0]);
    const tokenHost=String(tenant?.ManagedCertificateRequest?.ValidationTokenHost??domain?.ValidationTokenHost??"").toLowerCase(),validationMethod=validationRecords.length?(validationRecords.some((record:any)=>record.name.toLowerCase().startsWith("_cf-challenge."))?"cloudfront_dns_challenge":"acm_dns"):(current?.validationMethod??(tokenHost==="self-hosted"?"cloudfront_dns_challenge":"cloudfront_managed_http"));
    return {provider:this.provider,mode:this.mode,hostname,tenantReference:tenant?.Id??tenant?.Arn,distributionReference:tenant?.DistributionId,connectionGroupReference:tenant?.ConnectionGroupId,routingEndpoint:connection?.RoutingEndpoint,certificateReference,certificateStatus:domainActive?"issued":"pending",domainStatus:String(domain?.Status??tenant?.Status??"pending").toLowerCase(),httpsStatus:httpsReady?"verified":"pending",validationMethod,validationRecords,dnsRecord:connection?.RoutingEndpoint?{type:"CNAME",name:hostname,values:[connection.RoutingEndpoint],ttl:300}:undefined,ready:domainActive&&tenantActive&&httpsReady,evidence:{tenantStatus:tenant?.Status??null,domainStatus:domain?.Status??null,httpsCheckedAt:new Date().toISOString(),validationTokenHost:tokenHost||null,validationMethod,validationRecordCount:validationRecords.length,routingEndpoint:connection?.RoutingEndpoint??null}}
  }
  async ensure(input:{workspaceId:string;senderDomainId:string;hostname:string;zoneReference:string;current?:Partial<TrackingDomainState>}){await this.platform();let tenant=await this.tenant(input.hostname);if(!tenant){const name=`tracking-${createHash("sha256").update(`${input.workspaceId}:${input.senderDomainId}`).digest("hex").slice(0,40)}`;try{const result:any=await this.client.send(new CreateDistributionTenantCommand({DistributionId:this.config.distributionId,ConnectionGroupId:this.config.connectionGroupId,Name:name,Domains:[{Domain:input.hostname}],Enabled:true,ManagedCertificateRequest:{ValidationTokenHost:"cloudfront",PrimaryDomainName:input.hostname,CertificateTransparencyLoggingPreference:"enabled"},Tags:{Items:[{Key:"workspace-id",Value:input.workspaceId},{Key:"sender-domain-id",Value:input.senderDomainId}]}}));tenant=result?.DistributionTenant}catch(error){if((error as any)?.name!=="EntityAlreadyExists"&&(error as any)?.name!=="CNAMEAlreadyExists")throw mapped(error);tenant=await this.tenant(input.hostname)}}if(!tenant)throw new Error("TRACKING_TENANT_CREATE_FAILED");const connection=await this.connection(tenant.ConnectionGroupId),httpsReady=await this.httpsReady(input.hostname);return this.state(input.hostname,tenant,connection,httpsReady,input.current)}
  async check(input:{hostname:string;current:Partial<TrackingDomainState>}){const tenant=await this.tenant(input.hostname);if(!tenant)throw new Error("TRACKING_TENANT_NOT_FOUND");const connection=await this.connection(tenant.ConnectionGroupId),httpsReady=await this.httpsReady(input.hostname);return this.state(input.hostname,tenant,connection,httpsReady,input.current)}
  async remove(input:{hostname:string;tenantReference?:string}){
    const found=await this.tenant(input.hostname),identifier=input.tenantReference??found?.Id;
    if(!identifier)return;
    try{
      let current:any=await this.client.send(new GetDistributionTenantCommand({Identifier:identifier}));
      if(current?.DistributionTenant?.Enabled!==false){await this.client.send(new UpdateDistributionTenantCommand({Id:current.DistributionTenant.Id,IfMatch:current.ETag,Enabled:false}));current=await this.client.send(new GetDistributionTenantCommand({Identifier:identifier}))}
      await this.client.send(new DeleteDistributionTenantCommand({Id:current.DistributionTenant?.Id??identifier,IfMatch:current.ETag}));
    }catch(error){if(["EntityNotFound","NoSuchDistributionTenant"].includes(String((error as any)?.name)))return;throw mapped(error)}
  }
  /** Read-only platform check; it never creates a tenant or alters a distribution. */
  async checkInfrastructure(){
    try{await this.platform();const connection=await this.connection(this.config.connectionGroupId);return {ready:Boolean(connection?.RoutingEndpoint),reason:connection?.RoutingEndpoint?null:"TRACKING_ROUTING_ENDPOINT_MISSING"}}
    catch(error){return {ready:false,reason:error instanceof Error?error.message:"TRACKING_INFRASTRUCTURE_CHECK_FAILED"}}
  }
}

export class PlatformTrackingDomainProvisioner implements TrackingDomainProvisioner {
  readonly provider="platform";readonly mode="platform" as const;
  constructor(private readonly publicBaseUrl:string){}
  async ensure(input:{hostname:string}){return this.result(input.hostname)}
  async check(input:{hostname:string}){return this.result(input.hostname)}
  async remove(_input:{hostname:string;tenantReference?:string}){}
  private result(hostname:string):TrackingDomainState{return {provider:this.provider,mode:this.mode,hostname,certificateStatus:"not_applicable",domainStatus:"not_applicable",httpsStatus:"not_applicable",validationMethod:"platform_global",validationRecords:[],ready:true,evidence:{platformBaseUrl:this.publicBaseUrl}}}
}
