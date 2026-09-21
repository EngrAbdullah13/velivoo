import test from "node:test";
import assert from "node:assert/strict";
import { CreateConfigurationSetEventDestinationCommand, CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetConfigurationSetCommand, GetEmailIdentityCommand, PutEmailIdentityDkimSigningAttributesCommand, UpdateConfigurationSetEventDestinationCommand } from "@aws-sdk/client-sesv2";
import { CreateDistributionTenantCommand, DeleteDistributionTenantCommand, GetDistributionCommand, GetDistributionTenantByDomainCommand, GetDistributionTenantCommand, ListConnectionGroupsCommand, UpdateDistributionTenantCommand } from "@aws-sdk/client-cloudfront";
import { ChangeResourceRecordSetsCommand, CreateHostedZoneCommand, DeleteHostedZoneCommand, GetHostedZoneCommand, GetReusableDelegationSetCommand, ListHostedZonesByNameCommand, ListHostedZonesCommand, ListResourceRecordSetsCommand } from "@aws-sdk/client-route-53";
import { DomainProvisioningService } from "../packages/application/src/phase1/domain-provisioning-service.js";
import { EmailRoutingService } from "../packages/application/src/phase2/email-routing-service.js";
import { CloudFrontSaasTrackingDomainProvisioner } from "../packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.js";
import { SesEmailDomainProvider } from "../packages/provider-email/src/ses/ses-email-domain-provider.js";
import { Route53DnsProvider } from "../packages/provider-email/src/route53/route53-dns-provider.js";
import { canonicalDnsName, normalizeDomain, rewriteSoaPrimary, sameDnsSet, txtMatches } from "../packages/domain/src/phase1/dns.js";
import { delegatedAuthenticationAlignment, delegatedEasyDkimRecords, evaluateDomainReadiness, infraDomain, mailFromDomain, senderAddress, sendingSubdomain, trackingDomain, v3LifecycleState, velivooOwnershipValue } from "../packages/domain/src/phase1/branded-domain.js";
import { GetIdentityVerificationAttributesCommand, SetIdentityDkimEnabledCommand, VerifyDomainIdentityCommand } from "@aws-sdk/client-ses";

test("V2 derives infrastructure separately and keeps the visible sender on the root", () => {
  assert.equal(sendingSubdomain("hollapic.com", "send"), "send.hollapic.com");
  assert.equal(infraDomain("hollapic.com"),"send.hollapic.com");
  assert.equal(mailFromDomain("hollapic.com"),"bounce.send.hollapic.com");
  assert.equal(trackingDomain("hollapic.com"),"click.send.hollapic.com");
  assert.equal(senderAddress("news", "hollapic.com"), "news@hollapic.com");
  assert.throws(() => senderAddress("news@other.example", "hollapic.com"), /SENDER_LOCAL_PART_INVALID/);
});

test("delegated authentication distinguishes relaxed and strict DMARC alignment",()=>{
  assert.deepEqual(delegatedAuthenticationAlignment("v=DMARC1; p=reject"),{dkimStrictUnsupported:false,spfStrict:false});
  assert.deepEqual(delegatedAuthenticationAlignment("v=DMARC1; p=reject; adkim=s; aspf=s"),{dkimStrictUnsupported:true,spfStrict:true});
});

test("root-domain normalization is PSL-aware, IDN-safe, and rejects unsafe inputs",()=>{
  assert.equal(normalizeDomain("WWW.Example.COM."),"example.com");
  assert.equal(normalizeDomain("münich.de"),"xn--mnich-kva.de");
  for(const value of ["https://example.com","127.0.0.1","localhost","example.test","mail.example.com","example.com:443","*.example.com"])assert.throws(()=>normalizeDomain(value));
});

test("DNS helpers canonicalize sets and preserve SOA timing fields",()=>{
  assert.equal(canonicalDnsName("NS1.VELIVOO.COM."),"ns1.velivoo.com");
  assert.equal(sameDnsSet(["ns2.velivoo.com.","NS1.VELIVOO.COM"],["ns1.velivoo.com","ns2.velivoo.com"]),true);
  assert.equal(sameDnsSet(["ns1.velivoo.com","extra.example"],["ns1.velivoo.com"]),false);
  assert.equal(rewriteSoaPrimary("ns-a.awsdns.test. hostmaster.awsdns.com. 1 7200 900 1209600 86400","ns1.velivoo.com"),"ns1.velivoo.com. hostmaster.awsdns.com. 1 7200 900 1209600 86400");
  assert.equal(txtMatches(['"abc"'],"abc"),true);
  assert.equal(txtMatches(["other"],"abc"),false);
});

test("V3 lifecycle maps DNS, ownership, SES, DKIM, ready, and delete states",()=>{
  assert.equal(v3LifecycleState({dnsVerified:false,ownershipVerified:false,sesIdentitySuccess:false,dkimSuccess:false,ready:false}),"WAITING_FOR_DNS");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:false,sesIdentitySuccess:false,dkimSuccess:false,ready:false}),"DNS_VERIFIED");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:false,dkimSuccess:false,ready:false}),"OWNERSHIP_VERIFIED");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:false,dkimSuccess:false,ready:false,previous:"OWNERSHIP_VERIFIED"}),"SES_VERIFYING");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:true,dkimSuccess:false,ready:false}),"DKIM_VERIFYING");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:true,dkimSuccess:true,ready:true}),"READY");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:true,dkimSuccess:true,ready:false,deleting:true}),"DELETING");
  assert.equal(v3LifecycleState({dnsVerified:true,ownershipVerified:true,sesIdentitySuccess:true,dkimSuccess:true,ready:false,deleted:true}),"DELETED");
});

test("V3 rewrites Easy DKIM CNAME names into the delegated zone",()=>{
  const records=delegatedEasyDkimRecords([{type:"CNAME",name:"one._domainkey.hollapic.com",values:["one.dkim.cell.example"],ttl:300},{type:"CNAME",name:"two._domainkey.hollapic.com.",values:["two.dkim.cell.example"],ttl:300}],"hollapic.com","send.hollapic.com");
  assert.deepEqual(records.map(record=>record.name),["one._domainkey.send.hollapic.com","two._domainkey.send.hollapic.com"]);
  assert.throws(()=>delegatedEasyDkimRecords([{name:"unrelated.hollapic.com"}],"hollapic.com","send.hollapic.com"),/DKIM_EVIDENCE_UNAVAILABLE/);
});

test("readiness separates authentication from operational delivery", () => {
  const result=evaluateDomainReadiness({delegationVerified:true,identityVerified:true,dkimVerified:true,mailFromVerified:true,trackingReady:true,trackingApplicable:true,dmarcValid:true,senderIdentityExists:true,businessReady:true,feedbackReady:false,unsubscribeReady:true,routeActive:false,held:false});
  assert.equal(result.status,"not_ready");
  assert.ok(result.reasons.includes("FEEDBACK_NOT_READY"));
  assert.ok(result.reasons.includes("ROUTE_NOT_ACTIVE"));
});

test("business information and required DMARC are blocking readiness evidence", () => {
  const result=evaluateDomainReadiness({delegationVerified:true,identityVerified:true,dkimVerified:true,mailFromVerified:true,trackingReady:true,trackingApplicable:true,dmarcValid:false,dmarcRequired:true,senderIdentityExists:true,businessReady:false,feedbackReady:true,unsubscribeReady:true,routeActive:false,held:false});
  assert.equal(result.status,"not_ready");
  assert.ok(result.reasons.includes("BUSINESS_INFORMATION_MISSING"));
  assert.ok(result.reasons.includes("DMARC_WARNING"));
});

test("missing branded capability fails only the invoked provisioning operation", async () => {
  const updates:Record<string,unknown>[]=[];
  const repo:any={
    findProvisioningDomainOutsideWorkspace:async()=>null,
    findWorkspacePrimaryProvisioningDomain:async()=>null,
    findProvisioningDomainByRoot:async()=>null,
    createBrandedDomain:async(input:any)=>({id:"domain-a",workspaceId:input.workspaceId,domain:input.rootDomain,rootDomain:input.rootDomain,delegatedSubdomain:input.delegatedSubdomain,provisioningMode:"branded_delegation",lifecycleState:"created",authenticationStatus:"pending",readinessStatus:"not_ready"}),
    updateProvisioningDomain:async({patch}:any)=>{updates.push(patch);return {id:"domain-a",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",provisioningMode:"branded_delegation",lifecycleState:patch.lifecycleState??"failed",authenticationStatus:"pending",readinessStatus:patch.readinessStatus??"not_ready"}},
    claimDomainProvisioning:async()=>true,
    releaseDomainProvisioning:async()=>undefined,
  };
  const service=new DomainProvisioningService(repo,undefined,undefined,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",vanityNameservers:[],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  await assert.rejects(()=>service.create("workspace-a","hollapic.com"),/DNS_PROVIDER_NOT_CONFIGURED/);
  assert.equal(updates.at(-1)?.lastErrorCode,"DNS_PROVIDER_NOT_CONFIGURED");
});

test("new V3 onboarding shows four NS records plus the ownership TXT record",async()=>{
  let row:any=null;const evidence:any[]=[];const identityDomains:string[]=[];const upserted:string[]=[];const audits:string[]=[];const scheduled:Date[]=[];
  const dkimRecords=["a","b","c"].map(token=>({type:"CNAME",name:`${token}._domainkey.hollapic.com`,values:[`${token}.dkim.cell.example`],ttl:300}));
  const repo:any={findProvisioningDomainOutsideWorkspace:async()=>null,findWorkspacePrimaryProvisioningDomain:async()=>null,findProvisioningDomainByRoot:async()=>row,createBrandedDomain:async(input:any)=>row={id:"domain-a",workspaceId:input.workspaceId,domain:input.rootDomain,rootDomain:input.rootDomain,delegatedSubdomain:input.delegatedSubdomain,provisioningMode:"branded_delegation",provisioningVersion:input.provisioningVersion,provisioningCallerReference:"sender-domain:domain-a",lifecycleState:"CREATED",authenticationStatus:"pending",readinessStatus:"not_ready"},updateProvisioningDomain:async({patch}:any)=>row={...row,...patch},retireCustomerDnsEvidence:async()=>{for(const item of evidence)item.customerActionRequired=false},upsertDnsEvidence:async(input:any)=>{for(const value of input.record.values){const key=`${input.purpose}|${input.record.type}|${input.record.name}|${value}`,next={purpose:input.purpose,ownership:input.ownership,recordType:input.record.type,name:input.record.name,expectedValue:value,verificationStatus:input.verificationStatus,customerActionRequired:input.customerActionRequired};const index=evidence.findIndex(item=>item.key===key);if(index>=0)evidence[index]={key,...next};else evidence.push({key,...next})}},listDnsEvidence:async(_w:string,_d:string,customerOnly:boolean)=>evidence.filter(item=>!customerOnly||item.customerActionRequired),scheduleDomainVerification:async(input:any)=>scheduled.push(input.dueAt),claimDomainProvisioning:async()=>true,releaseDomainProvisioning:async()=>undefined,recordAudit:async(input:any)=>audits.push(input.action)};
  const dns:any={provider:"route53",ensureZone:async(input:any)=>{assert.equal(input.domain,"send.hollapic.com");assert.equal(input.callerReference,"sender-domain:domain-a");return {reference:"ZONE",name:input.domain,providerNameservers:["a","b","c","d"]}},upsertRecord:async(input:any)=>{upserted.push(input.record.name)}};
  const email:any={provider:"ses",region:"us-east-1",ensureIdentity:async(input:any)=>{identityDomains.push(input.domain);assert.equal(input.verificationMode,undefined);return {reference:input.domain,identityVerified:false,verifiedForSending:false,verificationStatus:"PENDING",dkimStatus:"PENDING",mailFromStatus:"PENDING",dkimTokens:["a","b","c"],dkimSigningHostedZone:"dkim.cell.example",dkimRecords}}};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  const result:any=await service.create("workspace-a","hollapic.com");
  assert.deepEqual(identityDomains,["hollapic.com"]);
  assert.equal(result.sendingDomain,"hollapic.com");
  assert.equal(result.infraDomain,"send.hollapic.com");
  assert.equal(result.provisioningVersion,"V3_ROOT_SENDER_DELEGATED_EASY_DKIM");
  assert.equal(result.lifecycleState,"WAITING_FOR_DNS");
  assert.equal(result.customerRecords.length,5);
  assert.equal(result.customerRecords.filter((record:any)=>record.type==="NS").length,4);
  assert.equal(result.customerRecords.filter((record:any)=>record.type==="TXT").length,1);
  const ownership=result.customerRecords.find((record:any)=>record.type==="TXT");
  assert.equal(ownership?.name,"_velivoo.hollapic.com");
  assert.match(String(ownership?.value),/^velivoo-site-verification=/);
  assert.equal(result.customerRecords.some((record:any)=>record.name.includes("_domainkey")),false);
  assert.equal(result.customerRecords.some((record:any)=>String(record.name).includes("_amazonses")),false);
  assert.deepEqual(upserted,["a._domainkey.send.hollapic.com","b._domainkey.send.hollapic.com","c._domainkey.send.hollapic.com"]);
  assert.ok(scheduled[0] instanceof Date && scheduled[0].getTime()-Date.now()<=5_500);
  assert.ok(audits.includes("domain.created"));
});

test("re-onboarding a deleted V3 domain resets stale AWS references and caller reference",async()=>{
  let row:any=null;const evidence:any[]=[];let ensuredZone:any=null;let identityInput:any=null;
  const dkimRecords=["a","b","c"].map(token=>({type:"CNAME",name:`${token}._domainkey.hollapic.com`,values:[`${token}.dkim.cell.example`],ttl:300}));
  const repo:any={
    findProvisioningDomainOutsideWorkspace:async()=>null,
    findWorkspacePrimaryProvisioningDomain:async()=>null,
    findProvisioningDomainByRoot:async()=>null,
    createBrandedDomain:async(input:any)=>row={id:"domain-a",workspaceId:input.workspaceId,domain:input.rootDomain,rootDomain:input.rootDomain,delegatedSubdomain:input.delegatedSubdomain,provisioningMode:"branded_delegation",provisioningVersion:input.provisioningVersion,provisioningCallerReference:"sender-domain:domain-a",hostedZoneReference:"OLD_ZONE",providerReference:"hollapic.com",ownershipVerificationToken:"old-token",lifecycleState:"DELETED",authenticationStatus:"pending",readinessStatus:"not_ready"},
    updateProvisioningDomain:async({patch}:any)=>row={...row,...patch},
    retireCustomerDnsEvidence:async()=>{for(const item of evidence)item.customerActionRequired=false},
    upsertDnsEvidence:async(input:any)=>{for(const value of input.record.values)evidence.push({purpose:input.purpose,recordType:input.record.type,name:input.record.name,expectedValue:value,verificationStatus:input.verificationStatus,customerActionRequired:input.customerActionRequired})},
    listDnsEvidence:async(_w:string,_d:string,customerOnly:boolean)=>evidence.filter(item=>!customerOnly||item.customerActionRequired),
    scheduleDomainVerification:async()=>undefined,claimDomainProvisioning:async()=>true,releaseDomainProvisioning:async()=>undefined,recordAudit:async()=>undefined,
  };
  const dns:any={provider:"route53",ensureZone:async(input:any)=>{ensuredZone=input;return {reference:"NEW_ZONE",name:input.domain,providerNameservers:["a","b","c","d"]}},upsertRecord:async()=>undefined};
  const email:any={provider:"ses",region:"us-east-1",ensureIdentity:async(input:any)=>{identityInput=input;return {reference:input.domain,identityVerified:false,verifiedForSending:false,verificationStatus:"PENDING",dkimStatus:"PENDING",mailFromStatus:"PENDING",dkimTokens:["a","b","c"],dkimSigningHostedZone:"dkim.cell.example",dkimRecords}}};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  const result:any=await service.create("workspace-a","hollapic.com");
  assert.equal(ensuredZone.existingReference,null);
  assert.match(ensuredZone.callerReference,/^sender-domain:domain-a:[0-9a-f-]{36}$/);
  assert.notEqual(ensuredZone.callerReference,"sender-domain:domain-a");
  assert.equal(identityInput.existingReference,null);
  assert.equal(result.lifecycleState,"WAITING_FOR_DNS");
  assert.equal(result.customerRecords.length,5);
  assert.equal(result.customerRecords.find((record:any)=>record.type==="TXT")?.name,"_velivoo.hollapic.com");
  assert.match(String(result.customerRecords.find((record:any)=>record.type==="TXT")?.value),/^velivoo-site-verification=/);
});

test("an existing V2 domain keeps its seven-record Easy DKIM contract",async()=>{
  let row:any={id:"domain-v2",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",provisioningMode:"branded_delegation",provisioningVersion:"V2_ROOT_SENDER_DELEGATED_INFRA",provisioningCallerReference:"sender-domain:domain-v2",lifecycleState:"AWAITING_CUSTOMER_DNS",authenticationStatus:"pending",readinessStatus:"not_ready"};
  const evidence:any[]=[];
  const repo:any={findProvisioningDomainOutsideWorkspace:async()=>null,findWorkspacePrimaryProvisioningDomain:async()=>row,findProvisioningDomainByRoot:async()=>row,updateProvisioningDomain:async({patch}:any)=>row={...row,...patch},retireCustomerDnsEvidence:async()=>{for(const item of evidence)item.customerActionRequired=false},upsertDnsEvidence:async(input:any)=>{for(const value of input.record.values){const key=`${input.purpose}|${input.record.name}|${value}`,next={key,purpose:input.purpose,ownership:input.ownership,recordType:input.record.type,name:input.record.name,expectedValue:value,verificationStatus:input.verificationStatus,customerActionRequired:input.customerActionRequired};const index=evidence.findIndex(item=>item.key===key);if(index<0)evidence.push(next);else evidence[index]=next}},listDnsEvidence:async(_w:string,_d:string,customerOnly:boolean)=>evidence.filter(item=>!customerOnly||item.customerActionRequired),scheduleDomainVerification:async()=>undefined,claimDomainProvisioning:async()=>true,releaseDomainProvisioning:async()=>undefined};
  const dns:any={provider:"route53",ensureZone:async()=>({reference:"ZONE",name:"send.hollapic.com",providerNameservers:["a","b","c","d"]})};
  const email:any={provider:"ses",region:"us-east-1",ensureIdentity:async()=>({reference:"hollapic.com",identityVerified:false,verifiedForSending:false,verificationStatus:"PENDING",dkimStatus:"PENDING",mailFromStatus:"PENDING",dkimTokens:["a","b","c"],dkimSigningHostedZone:"dkim.cell.example",dkimRecords:["a","b","c"].map(token=>({type:"CNAME",name:`${token}._domainkey.hollapic.com`,values:[`${token}.dkim.cell.example`],ttl:300}))})};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  const result:any=await service.create("workspace-a","hollapic.com");
  assert.equal(result.provisioningVersion,"V2_ROOT_SENDER_DELEGATED_INFRA");
  assert.equal(result.customerRecords.length,7);
  assert.equal(result.customerRecords.filter((record:any)=>record.type==="CNAME").length,3);
});

test("V3 readiness requires NS, ownership TXT, SES identity, and Easy DKIM success",async()=>{
  const root="hollapic.com",infra=`send.${root}`,ownershipToken="velivoo-test-token";
  const dkimRecords=["a","b","c"].map(token=>({type:"CNAME",name:`${token}._domainkey.${root}`,values:[`${token}.dkim.cell.example`],ttl:300}));
  let row:any={id:"domain-a",workspaceId:"workspace-a",domain:root,rootDomain:root,delegatedSubdomain:infra,provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",provisioningCallerReference:"sender-domain:domain-a",hostedZoneReference:"ZONE",providerReference:root,ownershipVerificationToken:ownershipToken,lifecycleState:"WAITING_FOR_DNS",authenticationStatus:"pending",readinessStatus:"not_ready",delegationStatus:"pending",soaStatus:"pending",verificationStatus:"PENDING",dkimStatus:"PENDING",mailFromStatus:"PENDING"};
  const evidence:any[]=[];const audits:string[]=[];
  const repo:any={
    findProvisioningDomain:async()=>row,
    updateProvisioningDomain:async({patch}:any)=>row={...row,...patch},
    upsertDnsEvidence:async(input:any)=>{for(const value of input.record.values){const key=`${input.purpose}|${value}`,next={key,purpose:input.purpose,ownership:input.ownership,recordType:input.record.type,name:input.record.name,expectedValue:value,verificationStatus:input.verificationStatus,customerActionRequired:input.customerActionRequired};const index=evidence.findIndex(item=>item.key===key);if(index<0)evidence.push(next);else evidence[index]=next}},
    listDnsEvidence:async(_w:string,_d:string,customerOnly:boolean)=>evidence.filter(item=>!customerOnly||item.customerActionRequired),
    claimDomainProvisioning:async()=>true,releaseDomainProvisioning:async()=>undefined,
    upsertWorkspaceProviderConfig:async()=>({configurationSetName:"workspace-a"}),
    updateWorkspaceProviderConfigurationSet:async()=>undefined,
    upsertProviderQuotaSnapshot:async()=>undefined,
    workspaceOperationalReadiness:async()=>({businessReady:true,feedbackReady:true,unsubscribeReady:true,held:false}),
    upsertDeliveryRoute:async(input:any)=>({id:"route-a",status:input.status}),
    scheduleDomainVerification:async()=>undefined,
    recordAudit:async(input:any)=>audits.push(input.action),
  };
  const checkedAt=new Date();
  const dns:any={
    provider:"route53",
    getZone:async()=>({reference:"ZONE",name:infra,providerNameservers:["a","b","c","d"]}),
    checkDelegation:async()=>({status:"verified",expected:["ns1.velivoo.com"],observed:["ns1.velivoo.com"],checkedAt}),
    checkSoa:async()=>({status:"verified",expected:["ns1.velivoo.com"],observed:["ns1.velivoo.com"],checkedAt}),
    checkCname:async({name}:{name:string})=>({status:name.endsWith(`._domainkey.${infra}`)? "verified":"nxdomain",expected:[],observed:[name.replace(`._domainkey.${infra}`,".dkim.cell.example")],checkedAt}),
    resolveTxt:async(name:string)=>({status:"verified",expected:[],observed:name.startsWith("_velivoo.")?[velivooOwnershipValue(ownershipToken)]:["v=DMARC1; p=none"],checkedAt}),
    upsertRecord:async()=>undefined,
  };
  const verified={reference:root,identityVerified:true,verifiedForSending:true,verificationStatus:"SUCCESS",dkimStatus:"SUCCESS",mailFromStatus:"PENDING",dkimTokens:["a","b","c"],dkimSigningHostedZone:"dkim.cell.example",dkimRecords};
  const email:any={
    provider:"ses",region:"us-east-1",
    ensureIdentity:async()=>verified,
    configureMailFrom:async()=>[{type:"MX",name:`bounce.${infra}`,values:["10 feedback-smtp.us-east-1.amazonses.com"],ttl:300},{type:"TXT",name:`bounce.${infra}`,values:["\"v=spf1 include:amazonses.com ~all\""],ttl:300}],
    getIdentity:async()=>({...verified,mailFromStatus:"SUCCESS"}),
    ensureWorkspaceConfigurationSet:async()=>({name:"workspace-a",feedbackReady:true}),
    associateConfigurationSet:async()=>undefined,
    readQuota:async()=>({maxSendRate:10,max24Hour:1000}),
  };
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  const result:any=await service.recheck("workspace-a","domain-a");
  assert.equal(result.readinessStatus,"ready");
  assert.equal(result.lifecycleState,"READY");
  assert.equal(result.authenticationStatus,"verified");
  assert.equal(result.checks.dkim,"SUCCESS");
  assert.equal(result.checks.ownership,"verified");
  assert.equal(result.customerRecords.some((record:any)=>String(record.name).includes("_domainkey")),false);
  assert.ok(audits.includes("domain.dns.verified"));
  assert.ok(audits.includes("domain.ses.verified"));
  assert.ok(audits.includes("domain.dkim.verified"));
});

test("V3 recheck rebuilds customer records when the stored hosted zone is missing",async()=>{
  const root="hollapic.com",infra=`send.${root}`,checkedAt=new Date();
  const dkimRecords=["a","b","c"].map(token=>({type:"CNAME",name:`${token}._domainkey.${root}`,values:[`${token}.dkim.cell.example`],ttl:300}));
  let row:any={id:"domain-a",workspaceId:"workspace-a",domain:root,rootDomain:root,delegatedSubdomain:infra,provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",provisioningCallerReference:"sender-domain:domain-a",hostedZoneReference:"MISSING_ZONE",providerReference:root,ownershipVerificationToken:"velivoo-test-token",lifecycleState:"FAILED",authenticationStatus:"pending",readinessStatus:"not_ready"};
  const evidence:any[]=[];let ensuredZone:any=null;
  const repo:any={
    findProvisioningDomain:async()=>row,
    updateProvisioningDomain:async({patch}:any)=>row={...row,...patch},
    retireCustomerDnsEvidence:async()=>{for(const item of evidence)item.customerActionRequired=false},
    upsertDnsEvidence:async(input:any)=>{for(const value of input.record.values){const key=`${input.purpose}|${input.record.type}|${input.record.name}|${value}`,next={key,purpose:input.purpose,ownership:input.ownership,recordType:input.record.type,name:input.record.name,expectedValue:value,verificationStatus:input.verificationStatus,customerActionRequired:input.customerActionRequired};const index=evidence.findIndex(item=>item.key===key);if(index<0)evidence.push(next);else evidence[index]=next}},
    listDnsEvidence:async(_w:string,_d:string,customerOnly:boolean)=>evidence.filter(item=>!customerOnly||item.customerActionRequired),
    claimDomainProvisioning:async()=>true,releaseDomainProvisioning:async()=>undefined,
    upsertWorkspaceProviderConfig:async()=>({configurationSetName:"workspace-a"}),
    updateWorkspaceProviderConfigurationSet:async()=>undefined,
    upsertProviderQuotaSnapshot:async()=>undefined,
    workspaceOperationalReadiness:async()=>({businessReady:true,feedbackReady:false,unsubscribeReady:false,held:false}),
    upsertDeliveryRoute:async(input:any)=>({id:"route-a",status:input.status}),
    scheduleDomainVerification:async()=>undefined,
    recordAudit:async()=>undefined,
  };
  const dns:any={
    provider:"route53",
    getZone:async(reference:string)=>reference==="MISSING_ZONE"?null:{reference,name:infra,providerNameservers:["a","b","c","d"]},
    ensureZone:async(input:any)=>{ensuredZone=input;return {reference:"ZONE",name:infra,providerNameservers:["a","b","c","d"]}},
    upsertRecord:async()=>undefined,
    checkDelegation:async()=>({status:"pending",expected:["ns1.velivoo.com"],observed:[],checkedAt}),
    checkSoa:async()=>({status:"pending",expected:["ns1.velivoo.com"],observed:[],checkedAt}),
    checkCname:async()=>({status:"pending",expected:[],observed:[],checkedAt}),
    resolveTxt:async()=>({status:"pending",expected:[],observed:[],checkedAt}),
  };
  const identity={reference:root,identityVerified:false,verifiedForSending:false,verificationStatus:"PENDING",dkimStatus:"PENDING",mailFromStatus:"PENDING",dkimTokens:["a","b","c"],dkimSigningHostedZone:"dkim.cell.example",dkimRecords};
  const email:any={provider:"ses",region:"us-east-1",ensureIdentity:async()=>identity,ensureWorkspaceConfigurationSet:async()=>({name:"workspace-a",feedbackReady:false}),associateConfigurationSet:async()=>undefined,readQuota:async()=>({maxSendRate:10,max24Hour:1000})};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  const result:any=await service.recheck("workspace-a","domain-a");
  assert.equal(ensuredZone.existingReference,null);
  assert.match(ensuredZone.callerReference,/^sender-domain:domain-a:[0-9a-f-]{36}$/);
  assert.equal(row.hostedZoneReference,"ZONE");
  assert.equal(result.lifecycleState,"WAITING_FOR_DNS");
  assert.equal(result.customerRecords.length,5);
  assert.equal(result.customerRecords.find((record:any)=>record.type==="TXT")?.name,"_velivoo.hollapic.com");
  assert.match(String(result.customerRecords.find((record:any)=>record.type==="TXT")?.value),/^velivoo-site-verification=/);
});

test("V3 delivery routing keeps From and the SES identity on the root domain",async()=>{
  const repo:any={
    senderIdentity:async()=>({id:"sender-a",workspaceId:"workspace-a",domainId:"domain-a",fromName:"News",fromEmail:"news@hollapic.com",replyTo:"reply@hollapic.com",status:"active"}),
    senderDomain:async()=>({id:"domain-a",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",workspacePrimary:true,status:"verified",provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",authenticationStatus:"verified",readinessStatus:"ready"}),
    workspaceProviderConfig:async()=>({provider:"ses",region:"us-east-1",providerStatus:"active",configurationSetName:"workspace-a"}),
    deliveryRoute:async()=>({id:"route-a",workspaceId:"workspace-a",senderDomainId:"domain-a",provider:"ses",providerRegion:"us-east-1",providerIdentityReference:"hollapic.com",configurationSetName:"workspace-a",mailFromDomain:"bounce.send.hollapic.com",trackingMode:"platform",status:"active"}),
  };
  const route=await new EmailRoutingService(repo,"https://click.velivoo.test").resolve({workspaceId:"workspace-a",senderIdentityId:"sender-a",messagePurpose:"marketing"});
  assert.equal(route.ready,true);
  assert.equal(route.identity.fromEmail,"news@hollapic.com");
  assert.equal(route.route?.providerIdentityReference,"hollapic.com");
});

test("CloudFront SaaS tracking uses the real connection-group endpoint without inventing a challenge", async () => {
  const calls:unknown[]=[];
  const client={async send(command:unknown){calls.push(command);if(command instanceof GetDistributionCommand)return {Distribution:{Id:"distribution-a",DistributionConfig:{ConnectionMode:"tenant-only"}}};if(command instanceof GetDistributionTenantByDomainCommand){const error=new Error("missing");error.name="EntityNotFound";throw error}if(command instanceof CreateDistributionTenantCommand)return {DistributionTenant:{Id:"tenant-a",DistributionId:"distribution-a",ConnectionGroupId:"group-a",Status:"active",Enabled:true,Domains:[{Domain:"click.send.hollapic.com",Status:"active"}],ManagedCertificateRequest:{ValidationTokenHost:"cloudfront"}}};if(command instanceof ListConnectionGroupsCommand)return {ConnectionGroupList:{Items:[{Id:"group-a",RoutingEndpoint:"routing.example.cloudfront.net"}]}};throw new Error("unexpected")}};
  const provider=new CloudFrontSaasTrackingDomainProvisioner({distributionId:"distribution-a",connectionGroupId:"group-a"},client as any,async()=>new Response("ok",{status:200}));
  assert.deepEqual(await provider.checkInfrastructure(),{ready:true,reason:null});
  const state=await provider.ensure({workspaceId:"workspace-a",senderDomainId:"domain-a",hostname:"click.send.hollapic.com",zoneReference:"zone-a"});
  assert.equal(state.validationMethod,"cloudfront_managed_http");
  assert.deepEqual(state.validationRecords,[]);
  assert.deepEqual(state.dnsRecord,{type:"CNAME",name:"click.send.hollapic.com",values:["routing.example.cloudfront.net"],ttl:300});
  assert.equal(state.ready,true);
});

test("CloudFront persists an AWS-returned challenge rather than deriving one", async () => {
  const client={async send(command:unknown){if(command instanceof GetDistributionCommand)return {Distribution:{Id:"distribution-a",DistributionConfig:{ConnectionMode:"tenant-only"}}};if(command instanceof GetDistributionTenantByDomainCommand)return {DistributionTenant:{Id:"tenant-a",ConnectionGroupId:"group-a",Status:"active",Enabled:true,Domains:[{Domain:"click.send.hollapic.com",Status:"pending",ValidationRecords:[{Type:"TXT",Name:"_cf-challenge.click.send.hollapic.com",Value:"aws-returned-token"}]}]}};if(command instanceof ListConnectionGroupsCommand)return {ConnectionGroupList:{Items:[{Id:"group-a",RoutingEndpoint:"routing.example.cloudfront.net"}]}};throw new Error("unexpected")}};
  const provider=new CloudFrontSaasTrackingDomainProvisioner({distributionId:"distribution-a",connectionGroupId:"group-a"},client as any,async()=>new Response("pending",{status:404}));
  const state=await provider.check({hostname:"click.send.hollapic.com",current:{}});
  assert.equal(state.validationMethod,"cloudfront_dns_challenge");
  assert.equal(state.validationRecords[0]?.name,"_cf-challenge.click.send.hollapic.com");
  assert.equal(state.validationRecords[0]?.values[0],"aws-returned-token");
});

test("CloudFront disconnect disables and deletes only the domain tenant",async()=>{
  const calls:unknown[]=[];let gets=0;
  const client={async send(command:unknown){calls.push(command);if(command instanceof GetDistributionTenantByDomainCommand)return {DistributionTenant:{Id:"tenant-a",Enabled:true}};if(command instanceof GetDistributionTenantCommand)return {DistributionTenant:{Id:"tenant-a",Enabled:gets++>0?false:true},ETag:`etag-${gets}`};if(command instanceof UpdateDistributionTenantCommand)return {};if(command instanceof DeleteDistributionTenantCommand)return {};throw new Error("unexpected")}};
  const provider=new CloudFrontSaasTrackingDomainProvisioner({distributionId:"distribution-a"},client as any);
  await provider.remove({hostname:"click.send.hollapic.com"});
  assert.equal(calls.filter(call=>call instanceof UpdateDistributionTenantCommand).length,1);
  assert.equal(calls.filter(call=>call instanceof DeleteDistributionTenantCommand).length,1);
  assert.equal((calls.find(call=>call instanceof UpdateDistributionTenantCommand) as UpdateDistributionTenantCommand).input.Enabled,false);
});

test("SES reuses one workspace configuration set and repairs its feedback destination", async () => {
  const calls:unknown[]=[];
  const client={async send(command:unknown){calls.push(command);if(command instanceof GetConfigurationSetCommand)return {ConfigurationSetName:"workspace-a"};if(command instanceof CreateConfigurationSetEventDestinationCommand){const error=new Error("exists");error.name="AlreadyExistsException";throw error}if(command instanceof UpdateConfigurationSetEventDestinationCommand)return {};throw new Error("unexpected")}};
  const provider=new SesEmailDomainProvider("us-east-1",client as any);
  const result=await provider.ensureWorkspaceConfigurationSet({workspaceId:"a0000000-0000-0000-0000-000000000000",existingName:"workspace-a",snsTopicArn:"arn:aws:sns:us-east-1:123456789012:feedback"});
  assert.deepEqual(result,{name:"workspace-a",feedbackReady:true});
  assert.equal(calls.filter(call=>call instanceof UpdateConfigurationSetEventDestinationCommand).length,1);
});

test("SES Easy DKIM targets use the provider SigningHostedZone",async()=>{
  const client={async send(command:unknown){assert.ok(command instanceof GetEmailIdentityCommand);return {VerificationStatus:"SUCCESS",VerifiedForSendingStatus:true,DkimAttributes:{Status:"SUCCESS",Tokens:["one","two","three"],SigningHostedZone:"dkim.cell.example."},MailFromAttributes:{MailFromDomainStatus:"PENDING"}}}};
  const provider=new SesEmailDomainProvider("us-east-1",client as any),state=await provider.getIdentity({domain:"hollapic.com"});
  assert.equal(state.identityVerified,true);
  assert.equal(state.dkimSigningHostedZone,"dkim.cell.example");
  assert.deepEqual(state.dkimRecords.map(record=>record.values[0]),["one.dkim.cell.example","two.dkim.cell.example","three.dkim.cell.example"]);
});

test("SES Easy DKIM re-enable restores tokens on identities that had signing disabled",async()=>{
  const calls:unknown[]=[];
  const client={async send(command:unknown){
    calls.push(command);
    if(command instanceof GetEmailIdentityCommand){
      if(calls.some(item=>item instanceof PutEmailIdentityDkimSigningAttributesCommand))return {VerificationStatus:"PENDING",VerifiedForSendingStatus:false,DkimAttributes:{Status:"PENDING",Tokens:["one","two","three"],SigningHostedZone:"dkim.cell.example."},MailFromAttributes:{MailFromDomainStatus:"PENDING"}};
      return {VerificationStatus:"PENDING",VerifiedForSendingStatus:false,DkimAttributes:{Status:"NOT_STARTED",Tokens:[]},MailFromAttributes:{MailFromDomainStatus:"PENDING"}};
    }
    if(command instanceof PutEmailIdentityDkimSigningAttributesCommand){assert.equal(command.input.SigningAttributesOrigin,"AWS_SES");return {};}
    throw new Error("unexpected");
  }};
  const provider=new SesEmailDomainProvider("us-east-1",client as any);
  const state=await provider.ensureIdentity({domain:"hollapic.com"});
  assert.equal(state.dkimRecords.length,3);
  assert.equal(state.dkimRecords[0]?.name,"one._domainkey.hollapic.com");
  assert.equal(calls.filter(call=>call instanceof PutEmailIdentityDkimSigningAttributesCommand).length,1);
});

test("SES ownership TXT uses v1 verification attributes without disabling Easy DKIM",async()=>{
  const v1Calls:unknown[]=[];
  const v2={async send(command:unknown){
    if(command instanceof GetEmailIdentityCommand)return {VerificationStatus:"PENDING",VerifiedForSendingStatus:false,DkimAttributes:{Status:"PENDING",Tokens:["one","two","three"],SigningHostedZone:"dkim.cell.example."},MailFromAttributes:{MailFromDomainStatus:"PENDING"}};
    throw new Error("unexpected v2");
  }};
  const v1={async send(command:unknown){
    v1Calls.push(command);
    if(command instanceof GetIdentityVerificationAttributesCommand)return {VerificationAttributes:{"hollapic.com":{VerificationToken:"ownership-token",VerificationStatus:"Pending"}}};
    throw new Error("unexpected v1");
  }};
  const provider=new SesEmailDomainProvider("us-east-1",v2 as any,v1 as any);
  const state=await provider.ensureIdentity({domain:"hollapic.com"});
  assert.equal(state.ownershipVerificationToken,"ownership-token");
  assert.equal(state.ownershipVerificationRecord?.name,"_amazonses.hollapic.com");
  assert.equal(state.dkimRecords.length,3);
  assert.equal(v1Calls.some(call=>call instanceof VerifyDomainIdentityCommand),false);
  assert.equal(v1Calls.some(call=>call instanceof SetIdentityDkimEnabledCommand),false);
});

test("SES BYODKIM creates the identity when it does not exist yet", async () => {
  const calls: unknown[] = [];
  const client = {
    async send(command: unknown) {
      calls.push(command);
      if (command instanceof GetEmailIdentityCommand) {
        const error = new Error("Email identity hollapic.com does not exist.");
        error.name = "NotFoundException";
        throw error;
      }
      if (command instanceof CreateEmailIdentityCommand) {
        return {
          VerificationStatus: "PENDING",
          DkimAttributes: { Status: "PENDING", SigningAttributesOrigin: "EXTERNAL", SigningEnabled: true },
        };
      }
      if (command instanceof GetEmailIdentityCommand) {
        return {
          VerificationStatus: "PENDING",
          VerifiedForSendingStatus: false,
          DkimAttributes: { Status: "PENDING", SigningAttributesOrigin: "EXTERNAL", SigningEnabled: true },
          MailFromAttributes: { MailFromDomainStatus: "PENDING" },
        };
      }
      throw new Error("unexpected");
    },
  };
  const provider = new SesEmailDomainProvider("us-east-1", client as any);
  const state = await provider.ensureByodkimIdentity({
    domain: "hollapic.com",
    selector: "vm1",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    workspaceId: "workspace-a",
    senderDomainId: "domain-a",
  });
  assert.equal(state.reference, "hollapic.com");
  assert.equal(calls.filter(call => call instanceof CreateEmailIdentityCommand).length, 1);
  assert.equal(calls.filter(call => call instanceof PutEmailIdentityDkimSigningAttributesCommand).length, 0);
  const create = calls.find(call => call instanceof CreateEmailIdentityCommand) as CreateEmailIdentityCommand;
  assert.equal(create.input.EmailIdentity, "hollapic.com");
  assert.equal(create.input.DkimSigningAttributes?.DomainSigningAttributesOrigin, "EXTERNAL");
  assert.equal(create.input.DkimSigningAttributes?.DomainSigningSelector, "vm1");
});

test("V3 delete removes SES, tracking, and Route 53 resources then marks DELETED",async()=>{
  const removed:string[]=[];const patches:Record<string,unknown>[]=[];const audits:string[]=[];
  let row:any={id:"domain-a",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",hostedZoneReference:"ZONE",providerReference:"hollapic.com",trackingDomain:"click.send.hollapic.com",trackingTenantReference:"tenant-a",lifecycleState:"READY",authenticationStatus:"verified",readinessStatus:"ready"};
  const repo:any={
    findProvisioningDomain:async()=>row,
    holdDomainRoute:async()=>undefined,
    hasActiveDeliveryAttempts:async()=>false,
    updateProvisioningDomain:async({patch}:any)=>{patches.push(patch);row={...row,...patch};return row},
    listDnsEvidence:async()=>[{recordType:"CNAME",name:"a._domainkey.send.hollapic.com",expectedValue:"a.dkim.cell.example"}],
    archiveProvisioningDomain:async()=>{row={...row,lifecycleState:"DELETED"}},
    recordAudit:async(input:any)=>audits.push(input.action),
  };
  const dns:any={deleteZoneSafely:async(input:any)=>{removed.push(`zone:${input.zoneReference}`);return {deleted:true}}};
  const email:any={removeIdentity:async()=>{removed.push("ses")}};
  const tracking:any={remove:async()=>{removed.push("tracking")}};
  const service=new DomainProvisioningService(repo,dns,email,tracking,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  await service.archive("workspace-a","domain-a");
  assert.ok(patches.some(patch=>patch.lifecycleState==="DELETING"));
  assert.deepEqual(removed,["tracking","ses","zone:ZONE"]);
  assert.ok(audits.includes("domain.deleted"));
});

test("V3 delete treats missing Route 53 and SES resources as already cleaned up",async()=>{
  const patches:Record<string,unknown>[]=[];const audits:string[]=[];
  let row:any={id:"domain-a",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",hostedZoneReference:"Z0202079KK67MNEWXYCJ",providerReference:"hollapic.com",trackingDomain:"click.send.hollapic.com",lifecycleState:"READY",authenticationStatus:"verified",readinessStatus:"ready"};
  const repo:any={
    findProvisioningDomain:async()=>row,
    holdDomainRoute:async()=>undefined,
    hasActiveDeliveryAttempts:async()=>false,
    updateProvisioningDomain:async({patch}:any)=>{patches.push(patch);row={...row,...patch};return row},
    listDnsEvidence:async()=>[],
    archiveProvisioningDomain:async()=>{row={...row,lifecycleState:"DELETED"}},
    recordAudit:async(input:any)=>audits.push(input.action),
  };
  const dns:any={deleteZoneSafely:async()=>({deleted:true,alreadyMissing:true})};
  const email:any={removeIdentity:async()=>({alreadyMissing:true})};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  await service.archive("workspace-a","domain-a");
  assert.ok(patches.some(patch=>patch.lifecycleState==="DELETING"));
  assert.equal(row.lifecycleState,"DELETED");
  assert.deepEqual(audits,["domain.ses.already_deleted","domain.route53.already_deleted","domain.deleted"]);
  assert.equal(patches.some(patch=>patch.lifecycleState==="FAILED"),false);
});

test("V3 delete still archives the workspace domain when SES cleanup fails", async () => {
  const patches: Record<string, unknown>[] = [];
  const audits: string[] = [];
  let row: any = {
    id: "domain-a",
    workspaceId: "workspace-a",
    domain: "velivoo.com",
    rootDomain: "velivoo.com",
    delegatedSubdomain: "send.velivoo.com",
    provisioningMode: "branded_delegation",
    provisioningVersion: "V3_ROOT_SENDER_DELEGATED_EASY_DKIM",
    lifecycleState: "FAILED",
    disconnectStatus: "failed",
    providerReference: null,
  };
  const repo: any = {
    findProvisioningDomain: async () => row,
    holdDomainRoute: async () => undefined,
    hasActiveDeliveryAttempts: async () => false,
    updateProvisioningDomain: async ({ patch }: any) => {
      patches.push(patch);
      row = { ...row, ...patch };
      return row;
    },
    listDnsEvidence: async () => [],
    archiveProvisioningDomain: async () => {
      row = { ...row, lifecycleState: "DELETED" };
    },
    recordAudit: async (input: any) => audits.push(input.action),
  };
  const email: any = {
    removeIdentity: async () => {
      throw new Error("EMAIL_IDENTITY_DELETE_FAILED");
    },
  };
  const service = new DomainProvisioningService(
    repo,
    undefined,
    email,
    undefined,
    {
      sendingPrefix: "send",
      mailFromPrefix: "bounce",
      trackingPrefix: "click",
      sesRegion: "us-east-1",
      delegationSetReference: "delegation-a",
      brandedNameserverDomain: "velivoo.com",
      vanityNameservers: ["ns1.velivoo.com", "ns2.velivoo.com", "ns3.velivoo.com", "ns4.velivoo.com"],
      dmarcPolicy: "v=DMARC1; p=none",
      dmarcRequired: false,
    },
  );
  const result = await service.archive("workspace-a", "domain-a");
  assert.equal(result.archived, true);
  assert.equal(row.lifecycleState, "DELETED");
  assert.ok(audits.includes("domain.ses.delete_failed"));
  assert.ok(audits.includes("domain.deleted"));
  assert.equal(patches.some(patch => patch.lifecycleState === "FAILED"), false);
});

test("V3 delete falls back to the matching Route 53 zone and SES root when stored references are stale",async()=>{
  const deletedZones:string[]=[];const removedIdentities:any[]=[];const audits:string[]=[];
  let row:any={id:"domain-a",workspaceId:"workspace-a",domain:"hollapic.com",rootDomain:"hollapic.com",delegatedSubdomain:"send.hollapic.com",provisioningMode:"branded_delegation",provisioningVersion:"V3_ROOT_SENDER_DELEGATED_EASY_DKIM",provisioningCallerReference:"sender-domain:domain-a",hostedZoneReference:"STALE_ZONE",providerReference:null,trackingDomain:"click.send.hollapic.com",lifecycleState:"READY",authenticationStatus:"verified",readinessStatus:"ready"};
  const repo:any={
    findProvisioningDomain:async()=>row,
    holdDomainRoute:async()=>undefined,
    hasActiveDeliveryAttempts:async()=>false,
    updateProvisioningDomain:async({patch}:any)=>{row={...row,...patch};return row},
    listDnsEvidence:async()=>[],
    archiveProvisioningDomain:async()=>{row={...row,lifecycleState:"DELETED"}},
    recordAudit:async(input:any)=>audits.push(input.action),
  };
  const dns:any={
    findZoneByName:async(name:string,caller:string)=>{assert.equal(name,"send.hollapic.com");assert.equal(caller,"sender-domain:domain-a");return {reference:"ZONE",name,providerNameservers:["a","b","c","d"]}},
    deleteZoneSafely:async(input:any)=>{deletedZones.push(input.zoneReference);return input.zoneReference==="STALE_ZONE"?{deleted:true,alreadyMissing:true}:{deleted:true}},
  };
  const email:any={removeIdentity:async(input:any)=>{removedIdentities.push(input);return {}}};
  const service=new DomainProvisioningService(repo,dns,email,undefined,{sendingPrefix:"send",mailFromPrefix:"bounce",trackingPrefix:"click",sesRegion:"us-east-1",delegationSetReference:"delegation-a",brandedNameserverDomain:"velivoo.com",vanityNameservers:["ns1.velivoo.com","ns2.velivoo.com","ns3.velivoo.com","ns4.velivoo.com"],dmarcPolicy:"v=DMARC1; p=none",dmarcRequired:false});
  await service.archive("workspace-a","domain-a");
  assert.deepEqual(deletedZones,["STALE_ZONE","ZONE"]);
  assert.deepEqual(removedIdentities,[{domain:"hollapic.com",reference:undefined}]);
  assert.equal(row.lifecycleState,"DELETED");
  assert.ok(audits.includes("domain.deleted"));
  assert.equal(audits.includes("domain.route53.already_deleted"),false);
});

test("Route 53 enforces the reusable delegation mapping and writes vanity apex NS/SOA", async () => {
  const providerNames=["ns-a.awsdns.test","ns-b.awsdns.test","ns-c.awsdns.test","ns-d.awsdns.test"],vanity=["ns1.ourplatformmail.com","ns2.ourplatformmail.com","ns3.ourplatformmail.com","ns4.ourplatformmail.com"],changes:ChangeResourceRecordSetsCommand[]=[];
  const client={async send(command:unknown){if(command instanceof GetReusableDelegationSetCommand)return {DelegationSet:{NameServers:providerNames}};if(command instanceof GetHostedZoneCommand)return {HostedZone:{Id:"/hostedzone/ZONE",Name:"send.hollapic.com."},DelegationSet:{NameServers:providerNames}};if(command instanceof ListResourceRecordSetsCommand)return {IsTruncated:false,ResourceRecordSets:[{Type:"NS",Name:"send.hollapic.com.",TTL:172800,ResourceRecords:providerNames.map(Value=>({Value}))},{Type:"SOA",Name:"send.hollapic.com.",TTL:900,ResourceRecords:[{Value:"ns-a.awsdns.test. hostmaster.awsdns.com. 1 7200 900 1209600 86400"}]}]};if(command instanceof ChangeResourceRecordSetsCommand){changes.push(command);return {}}throw new Error("unexpected")}};
  const addressByName=new Map([...providerNames,...vanity].map((name,index)=>[name,[`192.0.2.${(index%4)+1}`]]));
  const resolver={resolve4:async(name:string)=>addressByName.get(name)??[],resolve6:async()=>[],resolveNs:async()=>vanity};
  const provider=new Route53DnsProvider(client as any,vanity.map((name,index)=>({vanity:name,provider:providerNames[index]!})),resolver,"ourplatformmail.com");
  assert.deepEqual(await provider.checkInfrastructure("delegation-a"),{ready:true,reason:null});
  const zone=await provider.ensureZone({domain:"send.hollapic.com",existingReference:"ZONE",delegationSetReference:"delegation-a",callerReference:"sender-domain:domain-a"});
  assert.deepEqual(zone.providerNameservers,providerNames);
  const records=changes.map(change=>change.input.ChangeBatch?.Changes?.[0]?.ResourceRecordSet);
  assert.deepEqual(records.find(record=>record?.Type==="NS")?.ResourceRecords?.map(item=>item.Value),vanity);
  assert.match(records.find(record=>record?.Type==="SOA")?.ResourceRecords?.[0]?.Value??"",/^ns1\.ourplatformmail\.com\./);
  assert.equal((await provider.checkDelegation({domain:"send.hollapic.com",expectedNameservers:vanity})).status,"verified");
});

test("public DNS checks classify NXDOMAIN timeout and SERVFAIL and expose two diagnostics",async()=>{
  const error=(code:string)=>Object.assign(new Error(code),{code});
  const resolver={resolve4:async()=>[],resolve6:async()=>[],resolveNs:async()=>{throw error("ETIMEOUT")},resolveSoa:async()=>{throw error("ESERVFAIL")},resolveCname:async()=>{throw error("ENOTFOUND")},resolveTxt:async()=>{throw error("ETIMEOUT")}};
  const diagnostics=[{name:"one",resolveNs:async()=>["ns1.velivoo.com"]},{name:"two",resolveNs:async()=>{throw error("ESERVFAIL")}}];
  const provider=new Route53DnsProvider({send:async()=>({})} as any,[],resolver,"velivoo.com",diagnostics);
  assert.equal((await provider.checkDelegation({domain:"send.hollapic.com",expectedNameservers:["ns1.velivoo.com"]})).status,"timeout");
  assert.equal((await provider.checkSoa({domain:"send.hollapic.com",expectedPrimary:"ns1.velivoo.com"})).status,"servfail");
  assert.equal((await provider.checkCname({name:"token._domainkey.hollapic.com",expectedTarget:"token.dkim.example"})).status,"nxdomain");
  assert.equal((await provider.resolveTxt("_dmarc.hollapic.com")).status,"timeout");
  assert.deepEqual((await provider.diagnoseDelegation({domain:"send.hollapic.com",expectedNameservers:["ns1.velivoo.com"]})).map(item=>item.status),["verified","servfail"]);
});

test("CreateHostedZone keeps DelegationSetId untransformed and preserves the AWS exception",async()=>{
  const calls:unknown[]=[];
  const client={async send(command:unknown){
    calls.push(command);
    if(command instanceof ListHostedZonesByNameCommand)return {HostedZones:[]};
    if(command instanceof CreateHostedZoneCommand){
      const error=Object.assign(new Error("The specified delegation set does not exist."),{name:"NoSuchDelegationSet",$metadata:{httpStatusCode:400,requestId:"req-a"}});
      throw error;
    }
    throw new Error("unexpected");
  }};
  const provider=new Route53DnsProvider(client as any,[],{resolve4:async()=>[],resolve6:async()=>[],resolveNs:async()=>[]});
  await assert.rejects(
    ()=>provider.ensureZone({domain:"send.hollapic.com",delegationSetReference:"N0491349170DVGRI737EX",callerReference:"sender-domain:domain-a"}),
    (error:unknown)=>{
      assert.ok(error instanceof Error);
      assert.match(error.message,/^DNS_HOSTED_ZONE_CREATE_FAILED: NoSuchDelegationSet: The specified delegation set does not exist/);
      return true;
    },
  );
  const created=calls.find(command=>command instanceof CreateHostedZoneCommand) as CreateHostedZoneCommand;
  assert.deepEqual(created.input,{
    Name:"send.hollapic.com",
    CallerReference:"sender-domain:domain-a",
    DelegationSetId:"N0491349170DVGRI737EX",
    HostedZoneConfig:{Comment:"Velivoo sender infrastructure for send.hollapic.com",PrivateZone:false},
  });
  assert.equal(created.input.DelegationSetId,"N0491349170DVGRI737EX");
});

test("CreateHostedZone duplicate caller reference reuses the matching existing zone",async()=>{
  const providerNames=["ns-a.awsdns.test","ns-b.awsdns.test","ns-c.awsdns.test","ns-d.awsdns.test"],vanity=["ns1.ourplatformmail.com","ns2.ourplatformmail.com","ns3.ourplatformmail.com","ns4.ourplatformmail.com"],calls:unknown[]=[];
  const client={async send(command:unknown){
    calls.push(command);
    if(command instanceof ListHostedZonesByNameCommand)return {HostedZones:[]};
    if(command instanceof CreateHostedZoneCommand)throw Object.assign(new Error("A hosted zone has already been created with the specified caller reference."),{name:"HostedZoneAlreadyExists",$metadata:{httpStatusCode:409,requestId:"req-b"}});
    if(command instanceof ListHostedZonesCommand)return {IsTruncated:false,HostedZones:[{Id:"/hostedzone/ZONE",Name:"send.hollapic.com.",CallerReference:"sender-domain:domain-a"}]};
    if(command instanceof GetHostedZoneCommand)return {HostedZone:{Id:"/hostedzone/ZONE",Name:"send.hollapic.com."},DelegationSet:{NameServers:providerNames}};
    if(command instanceof ListResourceRecordSetsCommand)return {IsTruncated:false,ResourceRecordSets:[{Type:"NS",Name:"send.hollapic.com.",TTL:172800,ResourceRecords:providerNames.map(Value=>({Value}))},{Type:"SOA",Name:"send.hollapic.com.",TTL:900,ResourceRecords:[{Value:"ns-a.awsdns.test. hostmaster.awsdns.com. 1 7200 900 1209600 86400"}]}]};
    if(command instanceof ChangeResourceRecordSetsCommand)return {};
    throw new Error("unexpected");
  }};
  const addressByName=new Map([...providerNames,...vanity].map((name,index)=>[name,[`192.0.2.${(index%4)+1}`]]));
  const resolver={resolve4:async(name:string)=>addressByName.get(name)??[],resolve6:async()=>[],resolveNs:async()=>vanity};
  const provider=new Route53DnsProvider(client as any,vanity.map((name,index)=>({vanity:name,provider:providerNames[index]!})),resolver,"ourplatformmail.com");
  const zone=await provider.ensureZone({domain:"send.hollapic.com",delegationSetReference:"delegation-a",callerReference:"sender-domain:domain-a"});
  assert.equal(zone.reference,"ZONE");
  assert.equal(calls.filter(command=>command instanceof CreateHostedZoneCommand).length,1);
  assert.ok(calls.some(command=>command instanceof ListHostedZonesCommand));
});

test("Route 53 teardown deletes the child zone without touching the shared delegation set",async()=>{
  const calls:unknown[]=[];
  const client={async send(command:unknown){calls.push(command);if(command instanceof ListResourceRecordSetsCommand)return {IsTruncated:false,ResourceRecordSets:[{Type:"NS",Name:"send.hollapic.com.",TTL:172800,ResourceRecords:[{Value:"ns1.velivoo.com."}]},{Type:"SOA",Name:"send.hollapic.com.",TTL:900,ResourceRecords:[{Value:"ns1.velivoo.com. hostmaster.example. 1 2 3 4 5"}]},{Type:"CNAME",Name:"click.send.hollapic.com.",TTL:300,ResourceRecords:[{Value:"routing.example"}]}]};if(command instanceof ChangeResourceRecordSetsCommand||command instanceof DeleteHostedZoneCommand)return {};throw new Error("unexpected")}};
  const provider=new Route53DnsProvider(client as any,[],{resolve4:async()=>[],resolve6:async()=>[],resolveNs:async()=>[]});
  assert.deepEqual(await provider.deleteZoneSafely({zoneReference:"ZONE",allowedRecords:[{type:"CNAME",name:"click.send.hollapic.com",values:["routing.example"],ttl:300}]}),{deleted:true});
  assert.equal(calls.filter(call=>call instanceof DeleteHostedZoneCommand).length,1);
  assert.equal(calls.some(call=>String((call as any)?.constructor?.name).includes("DelegationSet")&&String((call as any)?.constructor?.name).startsWith("Delete")),false);
});

test("Route 53 teardown treats a missing hosted zone as already deleted",async()=>{
  const missing=()=>Object.assign(new Error("No hosted zone found with ID: Z0202079KK67MNEWXYCJ"),{name:"NoSuchHostedZone",$metadata:{httpStatusCode:404}});
  const listMissing=new Route53DnsProvider({async send(command:unknown){if(command instanceof ListResourceRecordSetsCommand)throw missing();throw new Error("unexpected")}} as any,[],{resolve4:async()=>[],resolve6:async()=>[],resolveNs:async()=>[]});
  assert.deepEqual(await listMissing.deleteZoneSafely({zoneReference:"Z0202079KK67MNEWXYCJ",allowedRecords:[]}),{deleted:true,alreadyMissing:true});
  const deleteMissing=new Route53DnsProvider({async send(command:unknown){if(command instanceof ListResourceRecordSetsCommand)return {IsTruncated:false,ResourceRecordSets:[{Type:"NS",Name:"send.hollapic.com.",TTL:172800,ResourceRecords:[{Value:"ns1.velivoo.com."}]},{Type:"SOA",Name:"send.hollapic.com.",TTL:900,ResourceRecords:[{Value:"ns1.velivoo.com. hostmaster.example. 1 2 3 4 5"}]}]};if(command instanceof DeleteHostedZoneCommand)throw Object.assign(new Error("No hosted zone found with ID: Z0202079KK67MNEWXYCJ"),{name:"HostedZoneNotFound",$metadata:{httpStatusCode:404}});throw new Error("unexpected")}} as any,[],{resolve4:async()=>[],resolve6:async()=>[],resolveNs:async()=>[]});
  assert.deepEqual(await deleteMissing.deleteZoneSafely({zoneReference:"Z0202079KK67MNEWXYCJ",allowedRecords:[]}),{deleted:true,alreadyMissing:true});
});

test("SES DeleteEmailIdentity treats NotFoundException as already deleted",async()=>{
  const provider=new SesEmailDomainProvider("us-east-1",{async send(command:unknown){if(command instanceof DeleteEmailIdentityCommand)throw Object.assign(new Error("Email identity not found"),{name:"NotFoundException",$metadata:{httpStatusCode:404}});throw new Error("unexpected")}} as any,{async send(){throw new Error("unexpected")}} as any);
  assert.deepEqual(await provider.removeIdentity({domain:"hollapic.com",reference:"hollapic.com"}),{alreadyMissing:true});
});
