import type { EmailPlatformConfig } from "../../../packages/config/src/env.js";
import { CloudFrontSaasTrackingDomainProvisioner, PlatformTrackingDomainProvisioner } from "../../../packages/provider-email/src/cloudfront/cloudfront-saas-tracking-provider.js";
import { Route53DnsProvider } from "../../../packages/provider-email/src/route53/route53-dns-provider.js";
import { SesEmailDomainProvider } from "../../../packages/provider-email/src/ses/ses-email-domain-provider.js";

type PrismaLike=any;
export type InfrastructureCheck={key:string;label:string;state:"ready"|"attention"|"unavailable"|"not_applicable";detail:string;diagnostic?:string|null;checkedAt:string};

function publicHttps(url:string|undefined){
  try{const parsed=new URL(url??"");return parsed.protocol==="https:"&&!["localhost","127.0.0.1","::1"].includes(parsed.hostname.toLowerCase())?parsed:null}catch{return null}
}
function code(error:unknown,fallback:string){return error instanceof Error?error.message.split(":")[0]||fallback:fallback}
function check(key:string,label:string,ready:boolean,detail:string,diagnostic?:string|null):InfrastructureCheck{return {key,label,state:ready?"ready":"attention",detail,diagnostic:diagnostic??null,checkedAt:new Date().toISOString()}}

function fetchDiagnostic(error:unknown,fallback:string){
  if(!(error instanceof Error))return fallback;
  const cause=(error as Error&{cause?:{code?:unknown;message?:unknown}}).cause;
  const causeCode=typeof cause?.code==="string"?cause.code:null;
  const causeMessage=typeof cause?.message==="string"?cause.message:null;
  return causeCode??causeMessage??error.message??fallback;
}

type ProbeResult={passed:boolean;diagnostic:string};
type NgrokTunnel={public_url?:unknown;config?:{addr?:unknown}};

function ngrokHostname(hostname:string){return hostname.endsWith(".ngrok-free.dev")||hostname.endsWith(".ngrok.app")||hostname.endsWith(".ngrok.io")}

/**
 * Local development can run under an OS/sandbox policy that denies an outbound
 * connection back to its own ngrok URL. In that one case, verify the active
 * ngrok agent mapping and its loopback target instead. This fallback cannot be
 * used for arbitrary production hosts or non-loopback tunnel targets.
 */
async function probeActiveLocalNgrokTunnel(endpoint:URL,path:string):Promise<ProbeResult>{
  if(!ngrokHostname(endpoint.hostname.toLowerCase()))return {passed:false,diagnostic:"PUBLIC_ENDPOINT_PROBE_FAILED"};
  try{
    const tunnelsResponse=await fetch("http://127.0.0.1:4040/api/tunnels",{signal:AbortSignal.timeout(2000),headers:{accept:"application/json"}});
    if(!tunnelsResponse.ok)return {passed:false,diagnostic:`LOCAL_NGROK_API_HTTP_${tunnelsResponse.status}`};
    const payload=await tunnelsResponse.json() as {tunnels?:unknown};
    const tunnels=Array.isArray(payload.tunnels)?payload.tunnels as NgrokTunnel[]:[];
    const tunnel=tunnels.find(item=>typeof item.public_url==="string"&&new URL(item.public_url).origin===endpoint.origin);
    const address=typeof tunnel?.config?.addr==="string"?tunnel.config.addr:null;
    if(!address)return {passed:false,diagnostic:"LOCAL_NGROK_TUNNEL_NOT_FOUND"};
    const local=new URL(address);
    if(local.protocol!=="http:"||!["localhost","127.0.0.1","::1"].includes(local.hostname.toLowerCase()))return {passed:false,diagnostic:"LOCAL_NGROK_TARGET_NOT_LOOPBACK"};
    const response=await fetch(new URL(path,local),{signal:AbortSignal.timeout(3000),headers:{accept:"text/plain"}});
    return {passed:response.ok,diagnostic:response.ok?"PUBLIC_ENDPOINT_REACHABLE_VIA_ACTIVE_NGROK":`LOCAL_NGROK_TARGET_HTTP_${response.status}`};
  }catch(error){return {passed:false,diagnostic:fetchDiagnostic(error,"LOCAL_NGROK_PROBE_FAILED")}}
}

/**
 * Records only an availability result and a non-sensitive diagnostic. The
 * configured public URL is probed from the server; browser state is never used
 * as infrastructure evidence.
 */
export async function refreshPublicEndpointEvidence(prisma:PrismaLike,key:"real.feedback.endpoint"|"real.tracking.endpoint",baseUrl:string|undefined,path:"/health"|"/health/tracking"){
  const endpoint=publicHttps(baseUrl);
  let passed=false,diagnostic="PUBLIC_HTTPS_URL_REQUIRED";
  if(endpoint){
    const target=new URL(path,endpoint);
    try{const response=await fetch(target,{signal:AbortSignal.timeout(5000),headers:{accept:"text/plain"}});passed=response.ok;diagnostic=passed?"PUBLIC_ENDPOINT_REACHABLE":`PUBLIC_ENDPOINT_HTTP_${response.status}`}catch(error){diagnostic=fetchDiagnostic(error,"PUBLIC_ENDPOINT_PROBE_FAILED");const fallback=await probeActiveLocalNgrokTunnel(endpoint,path);if(fallback.passed){passed=true;diagnostic=fallback.diagnostic}}
  }
  await prisma.phase0GateEvidence.upsert({where:{checkKey:key},create:{checkKey:key,status:passed?"passed":"blocked",evidenceJson:{hostname:endpoint?.hostname??null,protocol:endpoint?.protocol??null,diagnostic}},update:{status:passed?"passed":"blocked",evidenceJson:{hostname:endpoint?.hostname??null,protocol:endpoint?.protocol??null,diagnostic},checkedAt:new Date()}});
  return {passed,diagnostic};
}

export async function refreshPublicUnsubscribeEvidence(prisma:PrismaLike,baseUrl:string|undefined){
  const endpoint=publicHttps(baseUrl);
  let passed=false,diagnostic="PUBLIC_HTTPS_URL_REQUIRED";
  if(endpoint){
    const target=new URL("/health/unsubscribe",endpoint);
    try{const response=await fetch(target,{signal:AbortSignal.timeout(5000),headers:{accept:"text/plain"}});passed=response.ok;diagnostic=passed?"PUBLIC_UNSUBSCRIBE_REACHABLE":`PUBLIC_UNSUBSCRIBE_HTTP_${response.status}`}catch(error){diagnostic=fetchDiagnostic(error,"PUBLIC_UNSUBSCRIBE_PROBE_FAILED");const fallback=await probeActiveLocalNgrokTunnel(endpoint,"/health/unsubscribe");if(fallback.passed){passed=true;diagnostic="PUBLIC_UNSUBSCRIBE_REACHABLE_VIA_ACTIVE_NGROK"}}
  }
  await prisma.phase0GateEvidence.upsert({where:{checkKey:"real.unsubscribe.endpoint"},create:{checkKey:"real.unsubscribe.endpoint",status:passed?"passed":"blocked",evidenceJson:{hostname:endpoint?.hostname??null,protocol:endpoint?.protocol??null,diagnostic}},update:{status:passed?"passed":"blocked",evidenceJson:{hostname:endpoint?.hostname??null,protocol:endpoint?.protocol??null,diagnostic},checkedAt:new Date()}});
  return {passed,diagnostic};
}

export async function infrastructureReadiness(input:{prisma:PrismaLike;config:EmailPlatformConfig;dns?:Route53DnsProvider;email?:SesEmailDomainProvider;tracking?:CloudFrontSaasTrackingDomainProvisioner|PlatformTrackingDomainProvisioner;publicBaseUrl?:string}){
  const {prisma,config,dns,email,tracking}=input;
  const base=input.publicBaseUrl;
  await Promise.all([
    refreshPublicEndpointEvidence(prisma,"real.feedback.endpoint",base,"/health"),
    refreshPublicEndpointEvidence(prisma,"real.tracking.endpoint",base,"/health/tracking"),
  ]).catch(()=>undefined);
  const [gates,inbox]=await Promise.all([
    prisma.phase0GateEvidence.findMany({where:{checkKey:{in:["real.sns.signature","real.sns.subscription","real.unsubscribe.endpoint","real.feedback.endpoint","real.tracking.endpoint"]}},select:{checkKey:true,status:true,checkedAt:true,evidenceJson:true}}),
    prisma.inboxMessage.groupBy({by:["status"],where:{source:"ses"},_count:{_all:true}}),
  ]);
  const gate=new Map<string,any>(gates.map((row:any)=>[row.checkKey,row]));
  const checkRows:InfrastructureCheck[]=[];
  if(!config.route53DnsEnabled||!dns||!config.route53DelegationSetId){
    checkRows.push(check("route53","Route 53 ready",false,"Branded DNS provisioning is not configured.","DNS_PROVIDER_NOT_CONFIGURED"));
  }else{
    const result=await dns.checkInfrastructure(config.route53DelegationSetId);
    checkRows.push(check("route53","Route 53 ready",result.ready,result.ready?"Reusable delegation set is reachable.":"Route 53 could not validate the reusable delegation set.",result.reason));
  }
  const vanityConfigured=Boolean(config.route53BrandedNsDomain&&config.route53VanityNsMapping.length===4&&config.route53VanityNsMapping.every(item=>item.vanity.endsWith(`.${config.route53BrandedNsDomain}`)));
  checkRows.push(check("vanity_ns","Vanity NS ready",vanityConfigured,vanityConfigured?"Four configured vanity nameservers are available for customer delegation.":"Vanity nameserver mapping is incomplete or invalid.",vanityConfigured?null:"VANITY_NAMESERVERS_NOT_CONFIGURED"));
  if(tracking instanceof CloudFrontSaasTrackingDomainProvisioner){
    const result=await tracking.checkInfrastructure();
    checkRows.push(check("cloudfront","CloudFront ready",result.ready,result.ready?"The shared multi-tenant distribution and connection group are reachable.":"CloudFront tracking infrastructure could not be validated.",result.reason));
  }else if(tracking instanceof PlatformTrackingDomainProvisioner){
    checkRows.push({key:"cloudfront",label:"CloudFront ready",state:"not_applicable",detail:"This environment is using the explicitly configured platform tracking mode.",diagnostic:null,checkedAt:new Date().toISOString()});
  }else checkRows.push(check("cloudfront","CloudFront ready",false,"Custom branded tracking is not configured.","TRACKING_PROVIDER_NOT_CONFIGURED"));
  if(!email||!config.emailSendEnabled){
    checkRows.push(check("ses","SES ready",false,"SES delivery is not available for this environment.","EMAIL_DOMAIN_PROVIDER_NOT_CONFIGURED"));
  }else{
    try{await email.readQuota();checkRows.push(check("ses","SES ready",true,"SES credentials and account quota are reachable."));}
    catch(error){checkRows.push(check("ses","SES ready",false,"SES could not be reached with the configured server credentials.",code(error,"SES_PROVIDER_UNAVAILABLE")));}
  }
  const snsReady=Boolean(process.env.EMAIL_PLATFORM_SNS_TOPIC_ARN?.trim()&&gate.get("real.sns.signature")?.status==="passed"&&gate.get("real.sns.subscription")?.status==="passed");
  checkRows.push(check("sns","SNS ready",snsReady,snsReady?"A signed SNS event and subscription confirmation have been recorded.":"SNS topic, signature evidence, or subscription confirmation is missing.",snsReady?null:"SNS_NOT_READY"));
  const feedbackGate=gate.get("real.feedback.endpoint"),feedbackReady=feedbackGate?.status==="passed";
  checkRows.push(check("feedback_endpoint","Feedback endpoint reachable",feedbackReady,feedbackReady?"The public feedback endpoint responded over HTTPS.":"The public feedback endpoint is not currently reachable over HTTPS.",feedbackGate?.evidenceJson?.diagnostic??"PUBLIC_FEEDBACK_ENDPOINT_NOT_READY"));
  const trackingGate=gate.get("real.tracking.endpoint"),trackingReady=trackingGate?.status==="passed";
  checkRows.push(check("tracking_endpoint","Tracking endpoint reachable",trackingReady,trackingReady?"The public tracking endpoint responded over HTTPS.":"The public tracking endpoint is not currently reachable over HTTPS.",trackingGate?.evidenceJson?.diagnostic??"PUBLIC_TRACKING_ENDPOINT_NOT_READY"));
  const received=Number(inbox.find((row:any)=>row.status==="received")?._count?._all??0),processed=Number(inbox.find((row:any)=>row.status==="processed")?._count?._all??0);
  const feedbackPipeline=[
    {key:"ses",label:"SES event publishing",state:checkRows.find(row=>row.key==="ses")?.state??"attention"},
    {key:"sns",label:"SNS signature and subscription",state:checkRows.find(row=>row.key==="sns")?.state??"attention"},
    {key:"endpoint",label:"Public feedback endpoint",state:checkRows.find(row=>row.key==="feedback_endpoint")?.state??"attention"},
    {key:"inbox",label:"Durable InboxMessage",state:processed||received?"ready":"attention",detail:processed||received?`${received} awaiting processing · ${processed} processed` : "No real feedback has been received yet."},
    {key:"worker",label:"Feedback worker",state:processed?"ready":"attention",detail:processed?"At least one durable feedback item has been processed.":"Awaiting the first successfully processed provider event."},
  ];
  return {checkedAt:new Date().toISOString(),checks:checkRows,feedbackPipeline,overallReady:checkRows.every(row=>row.state==="ready"||row.state==="not_applicable")};
}

export async function realDomainVerificationChecklist(input:{prisma:PrismaLike;workspaceId:string;domainId:string}){
  const domain=await input.prisma.senderDomain.findFirst({where:{id:input.domainId,workspaceId:input.workspaceId,archivedAt:null}});
  if(!domain)throw new Error("DOMAIN_NOT_FOUND");
  const [evidence,route,identities]=await Promise.all([
    input.prisma.senderDomainDnsEvidence.findMany({where:{workspaceId:input.workspaceId,senderDomainId:domain.id},select:{purpose:true,verificationStatus:true}}),
    input.prisma.emailDeliveryRoute.findFirst({where:{workspaceId:input.workspaceId,senderDomainId:domain.id,archivedAt:null},select:{status:true,updatedAt:true}}),
    input.prisma.senderIdentity.findMany({where:{workspaceId:input.workspaceId,domainId:domain.id,status:"active"},select:{id:true}}),
  ]);
  const all=(purpose:string)=>{const rows=evidence.filter((row:any)=>row.purpose===purpose);return rows.length>0&&rows.every((row:any)=>row.verificationStatus==="verified")};
  const identityIds=identities.map((identity:any)=>identity.id),versions=identityIds.length?await input.prisma.emailVersion.findMany({where:{workspaceId:input.workspaceId,senderIdentityId:{in:identityIds}},select:{id:true}}):[],versionIds=versions.map((version:any)=>version.id);
  const messages=versionIds.length?await input.prisma.message.findMany({where:{workspaceId:input.workspaceId,emailVersionId:{in:versionIds}},select:{id:true,sourceType:true}}):[],messageIds=messages.map((message:any)=>message.id);
  const [events,unsubscribes,clicks]=await Promise.all([
    messageIds.length?input.prisma.deliveryEvent.findMany({where:{workspaceId:input.workspaceId,messageId:{in:messageIds}},select:{eventType:true}}):[],
    input.prisma.suppression.count({where:{workspaceId:input.workspaceId,reason:"global_unsubscribe"}}),
    messageIds.length?input.prisma.traceEvent.count({where:{workspaceId:input.workspaceId,aggregateType:"message",aggregateId:{in:messageIds},kind:"engagement.click"}}):0,
  ]);
  const event=(type:string)=>events.some((row:any)=>row.eventType===type);
  return {domain:{id:domain.id,rootDomain:domain.rootDomain??domain.domain,sendingDomain:domain.delegatedSubdomain??domain.domain,lifecycleState:domain.lifecycleState,readinessStatus:domain.readinessStatus,lastCheckedAt:domain.lastCheckedAt},steps:[
    {key:"dns",label:"DNS delegation",passed:all("delegation"),detail:all("delegation")?"Nameserver delegation is verified.":"Waiting for nameserver delegation."},
    {key:"ses",label:"SES authentication",passed:domain.authenticationStatus==="verified",detail:domain.authenticationStatus==="verified"?"Identity, DKIM, and MAIL FROM are verified.":"Email authentication is still verifying."},
    {key:"sender",label:"Sender identity",passed:identities.length>0,detail:identities.length?`${identities.length} active sender identity configured.`:"Create a sender after the domain is ready."},
    {key:"test_email",label:"Test email",passed:messages.some((message:any)=>message.sourceType==="test"),detail:messages.some((message:any)=>message.sourceType==="test")?"A controlled test message exists.":"Send a controlled test message."},
    {key:"delivery",label:"Delivery event",passed:event("delivery")||event("delivered"),detail:event("delivery")||event("delivered")?"A delivery event was received.":"Awaiting a real delivery event."},
    {key:"bounce",label:"Bounce feedback",passed:event("bounce")||event("hard_bounce")||event("soft_bounce"),detail:event("bounce")||event("hard_bounce")||event("soft_bounce")?"A bounce event was received.":"Use a controlled inbox/provider scenario in staging."},
    {key:"complaint",label:"Complaint feedback",passed:event("complaint")||event("complained"),detail:event("complaint")||event("complained")?"A complaint event was received.":"Use a controlled provider complaint test in staging."},
    {key:"unsubscribe",label:"Unsubscribe",passed:unsubscribes>0,detail:unsubscribes?"An unsubscribe suppression has been recorded.":"Use a controlled test recipient to confirm one-click unsubscribe."},
    {key:"tracking",label:"Click tracking",passed:clicks>0&&all("tracking"),detail:clicks>0&&all("tracking")?"Tracking DNS/HTTPS and a click event are verified.":"Confirm HTTPS tracking, then click a test link."},
  ],route:{status:route?.status??"missing",lastChanged:route?.updatedAt??null}};
}
