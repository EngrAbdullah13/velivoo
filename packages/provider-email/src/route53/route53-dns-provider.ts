import { Resolver } from "node:dns/promises";
import { ChangeResourceRecordSetsCommand, CreateHostedZoneCommand, DeleteHostedZoneCommand, GetHostedZoneCommand, GetReusableDelegationSetCommand, ListHostedZonesByNameCommand, ListHostedZonesCommand, ListResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";
import type { DelegationEvidence, DnsCheckEvidence, DnsProvider, DnsZone, ManagedDnsRecord } from "../../../application/src/ports/dns-provider.js";
import { rewriteSoaPrimary, sameDnsSet } from "../../../domain/src/phase1/dns.js";

type Route53Send=Pick<Route53Client,"send">;
const clean=(value:string)=>value.trim().toLowerCase().replace(/\.$/,"");
const zoneId=(value:string)=>value.replace(/^\/hostedzone\//,"");
function awsErrorDetail(error:unknown){
  const name=error&&typeof error==="object"&&"name" in error?String((error as any).name):"";
  const message=error instanceof Error?error.message:String(error);
  const metadata=(error as any)?.$metadata;
  return {name:name||"Error",message,httpStatusCode:typeof metadata?.httpStatusCode==="number"?metadata.httpStatusCode:undefined,requestId:typeof metadata?.requestId==="string"?metadata.requestId:undefined};
}
function mapError(error:unknown,operation:string){const name=awsErrorDetail(error).name;if(["AccessDenied","AccessDeniedException"].includes(name))return new Error("PROVIDER_ACCESS_DENIED");if(["UnrecognizedClientException","InvalidClientTokenId","SignatureDoesNotMatch","CredentialsProviderError"].includes(name))return new Error("PROVIDER_AUTHENTICATION_FAILED");return new Error(`DNS_${operation}_FAILED`)}
function missingHostedZone(error:unknown){
  const detail=awsErrorDetail(error);
  return ["NoSuchHostedZone","HostedZoneNotFound"].includes(detail.name)
    || /no hosted zone found/i.test(detail.message)
    || /hosted.?zone.?not.?found/i.test(detail.message);
}
function hostedZoneCreateFailed(error:unknown,operation:"ListHostedZonesByName"|"ListHostedZones"|"CreateHostedZone",params:Record<string,unknown>){
  const detail=awsErrorDetail(error);
  console.error(JSON.stringify({event:"route53.hostedZone.create.failed",operation,params,DelegationSetIdTransformed:params.DelegationSetId??null,awsErrorName:detail.name,awsErrorMessage:detail.message,httpStatusCode:detail.httpStatusCode,requestId:detail.requestId}));
  if(["AccessDenied","AccessDeniedException"].includes(detail.name))return new Error("PROVIDER_ACCESS_DENIED");
  if(["UnrecognizedClientException","InvalidClientTokenId","SignatureDoesNotMatch","CredentialsProviderError"].includes(detail.name))return new Error("PROVIDER_AUTHENTICATION_FAILED");
  return new Error(`DNS_HOSTED_ZONE_CREATE_FAILED: ${detail.name}: ${detail.message}`);
}
function dnsFailure(error:unknown):DnsCheckEvidence["status"]{const code=String((error as any)?.code??(error as any)?.name??"").toUpperCase();if(code.includes("TIMEOUT")||code==="ETIMEOUT")return "timeout";if(code.includes("SERVFAIL")||code==="ESERVFAIL")return "servfail";if(code.includes("NOTFOUND")||code.includes("NXDOMAIN")||code==="ENOTFOUND")return "nxdomain";return "pending"}

export interface VanityNameserverMapping {vanity:string;provider:string}
type PublicResolver={resolve4:(name:string)=>Promise<string[]>;resolve6:(name:string)=>Promise<string[]>;resolveNs:(name:string)=>Promise<string[]>;resolveSoa:(name:string)=>Promise<{nsname:string}>;resolveCname:(name:string)=>Promise<string[]>;resolveMx:(name:string)=>Promise<Array<{priority:number;exchange:string}>>;resolveTxt:(name:string)=>Promise<string[][]>};
function resolverAt(servers:string[]):PublicResolver{const resolver=new Resolver();resolver.setServers(servers);return {resolve4:name=>resolver.resolve4(name),resolve6:name=>resolver.resolve6(name),resolveNs:name=>resolver.resolveNs(name),resolveSoa:name=>resolver.resolveSoa(name),resolveCname:name=>resolver.resolveCname(name),resolveMx:name=>resolver.resolveMx(name),resolveTxt:name=>resolver.resolveTxt(name)}}
function publicResolvers(){const cloudflare=new Resolver(),google=new Resolver();cloudflare.setServers(["1.1.1.1","1.0.0.1"]);google.setServers(["8.8.8.8","8.8.4.4"]);return [{name:"cloudflare",resolveNs:(domain:string)=>cloudflare.resolveNs(domain)},{name:"google",resolveNs:(domain:string)=>google.resolveNs(domain)}]}
export class Route53DnsProvider implements DnsProvider {
  readonly provider="route53";
  constructor(private readonly client:Route53Send=new Route53Client({maxAttempts:5}),private readonly mappings:VanityNameserverMapping[],private readonly resolver:{resolve4:(name:string)=>Promise<string[]>;resolve6:(name:string)=>Promise<string[]>;resolveNs:(name:string)=>Promise<string[]>;resolveSoa?:(name:string)=>Promise<{nsname:string}>;resolveCname?:(name:string)=>Promise<string[]>;resolveMx?:(name:string)=>Promise<Array<{priority:number;exchange:string}>>;resolveTxt?:(name:string)=>Promise<string[][]>}=resolverAt(["1.1.1.1","1.0.0.1"]),private readonly brandedNameserverDomain?:string,private readonly diagnosticResolvers:Array<{name:string;resolveNs:(domain:string)=>Promise<string[]>}>=publicResolvers()){}

  private async get(reference:string):Promise<any>{try{return await this.client.send(new GetHostedZoneCommand({Id:zoneId(reference)}))}catch(error){if(missingHostedZone(error))return null;throw mapError(error,"HOSTED_ZONE_LOOKUP")}}
  async getZone(reference:string):Promise<DnsZone|null>{const result=await this.get(reference);if(!result?.HostedZone)return null;return {reference:zoneId(result.HostedZone.Id??reference),name:clean(result.HostedZone.Name??""),providerNameservers:(result.DelegationSet?.NameServers??[]).map(clean)}}

  async findZoneByName(domain:string,callerReference?:string):Promise<DnsZone|null>{
    try{
      const listed=await this.client.send(new ListHostedZonesByNameCommand({DNSName:domain,MaxItems:100}));
      const matches=(listed.HostedZones??[]).filter(item=>clean(item.Name??"")===clean(domain)&&(!callerReference||item.CallerReference===callerReference));
      if(matches.length!==1)return null;
      return matches[0]?.Id?this.getZone(matches[0].Id):null;
    }catch(error){throw mapError(error,"HOSTED_ZONE_LOOKUP")}
  }

  private async findZoneByCallerReference(input:{domain:string;callerReference:string}):Promise<DnsZone|null>{
    let marker:string|undefined;
    do{
      const page=await this.client.send(new ListHostedZonesCommand({Marker:marker,MaxItems:100}));
      const match=page.HostedZones?.find(item=>item.CallerReference===input.callerReference&&clean(item.Name??"")===clean(input.domain));
      if(match?.Id)return this.getZone(match.Id);
      marker=page.IsTruncated?page.NextMarker:undefined;
    }while(marker);
    return null;
  }

  private async validateMapping(providerNameservers:string[]){
    if(this.mappings.length!==4)throw new Error("VANITY_NAMESERVERS_NOT_CONFIGURED");
    if(this.brandedNameserverDomain&&this.mappings.some(item=>!clean(item.vanity).endsWith(`.${clean(this.brandedNameserverDomain!)}`)))throw new Error("VANITY_NAMESERVER_MAPPING_INVALID");
    const expected=providerNameservers.map(clean).sort(),mapped=this.mappings.map(item=>clean(item.provider)).sort();
    if(JSON.stringify(expected)!==JSON.stringify(mapped))throw new Error("VANITY_NAMESERVER_MAPPING_INVALID");
    for(const item of this.mappings){
      try{
        const [vanity4,provider4,vanity6,provider6]=await Promise.all([this.resolver.resolve4(clean(item.vanity)).catch(()=>[]),this.resolver.resolve4(clean(item.provider)).catch(()=>[]),this.resolver.resolve6(clean(item.vanity)).catch(()=>[]),this.resolver.resolve6(clean(item.provider)).catch(()=>[])]);
        const vanity=new Set([...vanity4,...vanity6]),provider=new Set([...provider4,...provider6]);
        if(!vanity.size||![...vanity].some(address=>provider.has(address)))throw new Error("VANITY_NAMESERVER_MAPPING_INVALID");
      }catch(error){if(error instanceof Error&&error.message==="VANITY_NAMESERVER_MAPPING_INVALID")throw error;throw new Error("VANITY_NAMESERVER_MAPPING_INVALID")}
    }
  }

  /** Read-only platform check used by the internal readiness screen. */
  async checkInfrastructure(delegationSetReference:string){
    try{
      const result:any=await this.client.send(new GetReusableDelegationSetCommand({Id:delegationSetReference}));
      const nameservers=(result?.DelegationSet?.NameServers??[]).map(clean);
      await this.validateMapping(nameservers);
      return {ready:true,reason:null as string|null};
    }catch(error){
      return {ready:false,reason:error instanceof Error?error.message:"DNS_INFRASTRUCTURE_CHECK_FAILED"};
    }
  }

  async ensureZone(input:{domain:string;existingReference?:string|null;delegationSetReference:string;callerReference:string}){
    let zone=input.existingReference?await this.getZone(input.existingReference):null;
    if(!zone){
      try{
        const listed=await this.client.send(new ListHostedZonesByNameCommand({DNSName:input.domain,MaxItems:1})),existing=listed.HostedZones?.find(item=>clean(item.Name??"")===clean(input.domain));
        if(existing)zone=await this.getZone(existing.Id??"");
        else{
          const params={Name:input.domain,CallerReference:input.callerReference,DelegationSetId:input.delegationSetReference,HostedZoneConfig:{Comment:`Velivoo sender infrastructure for ${input.domain}`,PrivateZone:false as const}};
          // No DelegationSetId rewrite exists today: env/config value is sent unchanged.
          console.error(JSON.stringify({event:"route53.CreateHostedZone.request",Name:params.Name,CallerReference:params.CallerReference,DelegationSetId:params.DelegationSetId,DelegationSetIdTransformed:params.DelegationSetId,HostedZoneConfig:params.HostedZoneConfig}));
          try{
            const created=await this.client.send(new CreateHostedZoneCommand(params));
            zone={reference:zoneId(created.HostedZone?.Id??""),name:clean(input.domain),providerNameservers:(created.DelegationSet?.NameServers??[]).map(clean)};
          }catch(error){
            if(awsErrorDetail(error).name!=="HostedZoneAlreadyExists")throw hostedZoneCreateFailed(error,"CreateHostedZone",params);
            console.error(JSON.stringify({event:"route53.hostedZone.create.already_exists",Name:params.Name,CallerReference:params.CallerReference,DelegationSetId:params.DelegationSetId}));
            try{zone=await this.findZoneByCallerReference({domain:input.domain,callerReference:input.callerReference})}
            catch(lookupError){throw hostedZoneCreateFailed(lookupError,"ListHostedZones",{CallerReference:input.callerReference,DNSName:input.domain})}
            if(!zone)throw hostedZoneCreateFailed(error,"CreateHostedZone",params);
            console.error(JSON.stringify({event:"route53.hostedZone.create.reused",Name:params.Name,CallerReference:params.CallerReference,hostedZoneReference:zone.reference}));
          }
        }
      }catch(error){
        if(error instanceof Error&&(error.message.startsWith("DNS_HOSTED_ZONE_CREATE_FAILED")||error.message==="PROVIDER_ACCESS_DENIED"||error.message==="PROVIDER_AUTHENTICATION_FAILED"))throw error;
        throw hostedZoneCreateFailed(error,"ListHostedZonesByName",{DNSName:input.domain,MaxItems:"1",DelegationSetId:input.delegationSetReference});
      }
    }
    if(!zone?.reference)throw new Error("DNS_HOSTED_ZONE_CREATE_FAILED");
    await this.validateMapping(zone.providerNameservers);
    const vanity=this.mappings.map(item=>clean(item.vanity)),records=await this.listRecords(zone.reference),soa=records.find(record=>record.type==="SOA"&&clean(record.name)===clean(input.domain));
    await this.upsertRecord({zoneReference:zone.reference,record:{type:"NS",name:input.domain,values:vanity,ttl:172800}});
    if(soa?.values[0]){
      await this.upsertRecord({zoneReference:zone.reference,record:{type:"SOA",name:input.domain,values:[rewriteSoaPrimary(soa.values[0],vanity[0]!)],ttl:soa.ttl||900}});
    }
    return zone;
  }

  async upsertRecord(input:{zoneReference:string;record:ManagedDnsRecord}){try{await this.client.send(new ChangeResourceRecordSetsCommand({HostedZoneId:zoneId(input.zoneReference),ChangeBatch:{Comment:"Managed by branded domain provisioning",Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:input.record.name,Type:input.record.type,TTL:input.record.ttl,ResourceRecords:input.record.values.map(Value=>({Value}))}}]}}))}catch(error){const detail=awsErrorDetail(error);console.error(JSON.stringify({event:"route53.record.upsert.failed",zoneReference:zoneId(input.zoneReference),recordType:input.record.type,recordName:input.record.name,valueCount:input.record.values.length,awsErrorName:detail.name,awsErrorMessage:detail.message,httpStatusCode:detail.httpStatusCode,requestId:detail.requestId}));throw mapError(error,"RECORD_CREATE")}}
  async listRecords(reference:string){const rows:ManagedDnsRecord[]=[];let name:string|undefined,type:any|undefined,identifier:string|undefined;do{const page=await this.client.send(new ListResourceRecordSetsCommand({HostedZoneId:zoneId(reference),StartRecordName:name,StartRecordType:type,StartRecordIdentifier:identifier}));for(const item of page.ResourceRecordSets??[])rows.push({type:item.Type as ManagedDnsRecord["type"],name:clean(item.Name??""),values:(item.ResourceRecords??[]).map(record=>record.Value??"").filter(Boolean),ttl:item.TTL??300});name=page.NextRecordName;type=page.NextRecordType;identifier=page.NextRecordIdentifier;if(!page.IsTruncated)break}while(name);return rows}
  async checkDelegation(input:{domain:string;expectedNameservers:string[]}):Promise<DelegationEvidence>{const expected=input.expectedNameservers.map(clean).sort(),checkedAt=new Date();try{const observed=(await this.resolver.resolveNs(input.domain)).map(clean).sort(),status=observed.length===0?"pending":sameDnsSet(observed,expected)?"verified":"mismatch";return {status,expected,observed,checkedAt}}catch(error){return {status:dnsFailure(error),expected,observed:[],checkedAt}}}
  async diagnoseDelegation(input:{domain:string;expectedNameservers:string[]}){const expected=input.expectedNameservers.map(clean).sort();return Promise.all(this.diagnosticResolvers.map(async perspective=>{const checkedAt=new Date();try{const observed=(await perspective.resolveNs(input.domain)).map(clean).sort();return {resolver:perspective.name,status:(observed.length===0?"pending":sameDnsSet(observed,expected)?"verified":"mismatch") as DelegationEvidence["status"],expected,observed,checkedAt}}catch(error){return {resolver:perspective.name,status:dnsFailure(error),expected,observed:[],checkedAt}}}))}
  async checkSoa(input:{domain:string;expectedPrimary:string}):Promise<DnsCheckEvidence>{const checkedAt=new Date(),expected=[clean(input.expectedPrimary)];try{if(!this.resolver.resolveSoa)throw new Error("DNS_RESOLVER_UNAVAILABLE");const soa=await this.resolver.resolveSoa(input.domain),observed=[clean(soa.nsname)];return {status:observed[0]===expected[0]?"verified":"mismatch",expected,observed,checkedAt,authoritative:true}}catch(error){return {status:dnsFailure(error),expected,observed:[],checkedAt,authoritative:false}}}
  async checkCname(input:{name:string;expectedTarget:string}):Promise<DnsCheckEvidence>{const checkedAt=new Date(),expected=[clean(input.expectedTarget)];try{if(!this.resolver.resolveCname)throw new Error("DNS_RESOLVER_UNAVAILABLE");const observed=(await this.resolver.resolveCname(input.name)).map(clean);return {status:sameDnsSet(observed,expected)?"verified":"mismatch",expected,observed,checkedAt}}catch(error){return {status:dnsFailure(error),expected,observed:[],checkedAt}}}
  async checkMx(input:{name:string;expectedPriority:number;expectedExchange:string}):Promise<DnsCheckEvidence>{const checkedAt=new Date(),expectedExchange=clean(input.expectedExchange),expected=[`${input.expectedPriority} ${expectedExchange}`];try{if(!this.resolver.resolveMx)throw new Error("DNS_RESOLVER_UNAVAILABLE");const rows=await this.resolver.resolveMx(input.name),observed=rows.map(row=>`${row.priority} ${clean(row.exchange)}`),matched=observed.some(value=>{const [priority,exchange]=value.split(/\s+/,2);return Number(priority)===input.expectedPriority&&clean(exchange??"")===expectedExchange});return {status:matched?"verified":observed.length?"mismatch":"pending",expected,observed,checkedAt}}catch(error){return {status:dnsFailure(error),expected,observed:[],checkedAt}}}
  async resolveTxt(name:string):Promise<DnsCheckEvidence>{const checkedAt=new Date();try{if(!this.resolver.resolveTxt)throw new Error("DNS_RESOLVER_UNAVAILABLE");const observed=(await this.resolver.resolveTxt(name)).map(parts=>parts.join(""));return {status:observed.length?"verified":"pending",expected:[],observed,checkedAt}}catch(error){return {status:dnsFailure(error),expected:[],observed:[],checkedAt}}}
  async deleteZoneSafely(input:{zoneReference:string;allowedRecords:ManagedDnsRecord[]}){
    let existing:ManagedDnsRecord[];
    try{existing=await this.listRecords(input.zoneReference)}
    catch(error){
      if(missingHostedZone(error)){
        console.error(JSON.stringify({event:"domain.delete",step:"route53.cleanup.already_missing",hostedZoneReference:input.zoneReference,awsErrorName:awsErrorDetail(error).name,awsErrorMessage:awsErrorDetail(error).message}));
        return {deleted:true,alreadyMissing:true};
      }
      throw mapError(error,"HOSTED_ZONE_LOOKUP");
    }
    const allowed=new Map<string,Set<string>>();
    for(const record of input.allowedRecords){const key=`${record.type}|${clean(record.name)}`,values=allowed.get(key)??new Set<string>();record.values.map(clean).forEach(value=>values.add(value));allowed.set(key,values)}
    const managed=existing.filter(record=>!["NS","SOA"].includes(record.type)),unsafe=managed.filter(record=>{const values=allowed.get(`${record.type}|${clean(record.name)}`);return !values||record.values.some(value=>!values.has(clean(value)))});
    console.error(JSON.stringify({event:"domain.delete",step:"route53.cleanup.inspect",hostedZoneReference:input.zoneReference,existingCount:existing.length,managedCount:managed.length,unsafeCount:unsafe.length,unsafe:unsafe.slice(0,20).map(record=>({type:record.type,name:record.name}))}));
    if(unsafe.length)throw new Error(`DNS_ZONE_CONTAINS_UNMANAGED_RECORDS: ${unsafe.map(record=>`${record.type} ${record.name}`).join(", ")}`);
    try{
      for(const record of managed)await this.client.send(new ChangeResourceRecordSetsCommand({HostedZoneId:zoneId(input.zoneReference),ChangeBatch:{Comment:"Disconnect Velivoo sender domain",Changes:[{Action:"DELETE",ResourceRecordSet:{Name:record.name,Type:record.type,TTL:record.ttl,ResourceRecords:record.values.map(Value=>({Value}))}}]}}));
      await this.client.send(new DeleteHostedZoneCommand({Id:zoneId(input.zoneReference)}));
      console.error(JSON.stringify({event:"domain.delete",step:"route53.cleanup.deleted",hostedZoneReference:input.zoneReference,deletedRecordCount:managed.length}));
      return {deleted:true};
    }catch(error){
      if(missingHostedZone(error)){
        console.error(JSON.stringify({event:"domain.delete",step:"route53.cleanup.already_missing",hostedZoneReference:input.zoneReference,awsErrorName:awsErrorDetail(error).name,awsErrorMessage:awsErrorDetail(error).message}));
        return {deleted:true,alreadyMissing:true};
      }
      const mapped=mapError(error,"HOSTED_ZONE_DELETE");
      console.error(JSON.stringify({event:"domain.delete",step:"route53.cleanup.failed",hostedZoneReference:input.zoneReference,code:mapped.message}));
      throw mapped;
    }
  }
}
