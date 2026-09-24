import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPhase1Repository } from "../../../packages/persistence/src/prisma/phase1-repository.js";
import { PrismaPhase2Repository } from "../../../packages/persistence/src/prisma/phase2-repository.js";
import { LocalObjectStore } from "../../../packages/object-store/src/local-object-store.js";
import { Phase2Service, type Phase2ServiceActor } from "../../../packages/application/src/phase2/phase2-service.js";
import { DevelopmentIdentityProvider } from "../../../packages/application/src/identity/development-provider.js";
import { OidcJwtIdentityProvider } from "../../../packages/application/src/identity/oidc-jwt-provider.js";
import type { IdentityProvider } from "../../../packages/application/src/ports/identity-provider.js";
import { DisabledEmailProvider } from "../../../packages/provider-email/src/disabled-email-provider.js";
import { SesEmailProvider } from "../../../packages/provider-email/src/ses/ses-provider.js";
import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";
import { Phase2JobQueue } from "../../../packages/queue/src/bullmq/phase2-job-queue.js";
import { confirmDeliveryWithoutFeedback, loadEmailPlatformConfig } from "../../../packages/config/src/env.js";
import { hasPermission, type Permission, type Role } from "../../../packages/domain/src/phase1/permissions.js";
import { localSessionActor } from "./local-session-auth.js";
import type { StructuredEmailDocument } from "../../../packages/domain/src/phase2/content.js";
import { MarketingBroadcastService, newCampaignId } from "../../../packages/application/src/marketing/marketing-broadcast-service.js";

const emailConfig=loadEmailPlatformConfig();
const prisma=new PrismaClient(),p1=new PrismaPhase1Repository(prisma),p2=new PrismaPhase2Repository(prisma),objects=new LocalObjectStore(process.env.EMAIL_PLATFORM_OBJECT_ROOT??".local/objects");
const mail:EmailDeliveryProvider=emailConfig.emailProvider==="ses"&&emailConfig.emailSendEnabled?new SesEmailProvider(emailConfig.awsSesRegion??"",emailConfig.runtimeMode==="production"?undefined:emailConfig.sesConfigurationSet,emailConfig.sesSupportedRegions):new DisabledEmailProvider();
const service=new Phase2Service(p2,objects,mail,{publicBaseUrl:process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL??"http://localhost:4001",unsubscribeSecret:process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET??"change-this-development-unsubscribe-secret-123456",trackingSecret:process.env.EMAIL_PLATFORM_TRACKING_SIGNING_SECRET??"change-this-development-tracking-secret-123456789",maxMessageBytes:Number(process.env.EMAIL_PLATFORM_MAX_MESSAGE_BYTES??500000),providerReady:mail.name!=="disabled",requireWorkspaceConfigurationSet:emailConfig.runtimeMode==="production",unsubscribePublicBaseOnly:emailConfig.runtimeMode!=="production",confirmDeliveryWithoutFeedback:confirmDeliveryWithoutFeedback(emailConfig),r2Media:process.env.EMAIL_PLATFORM_R2_ACCOUNT_ID&&process.env.EMAIL_PLATFORM_R2_BUCKET&&process.env.EMAIL_PLATFORM_R2_API_TOKEN&&process.env.EMAIL_PLATFORM_R2_PUBLIC_BASE_URL?{accountId:process.env.EMAIL_PLATFORM_R2_ACCOUNT_ID,bucket:process.env.EMAIL_PLATFORM_R2_BUCKET,apiToken:process.env.EMAIL_PLATFORM_R2_API_TOKEN,publicBaseUrl:process.env.EMAIL_PLATFORM_R2_PUBLIC_BASE_URL}:undefined});
// Local web/API development must remain usable without Redis. Workers and
// queue-backed delivery are explicitly enabled only when the matching flag is set.
const jobs=emailConfig.deliveryQueueEnabled&&process.env.REDIS_URL?new Phase2JobQueue(process.env.REDIS_URL):null;
const broadcastAudience={
  async listActiveProfileIds(workspaceId:string,listId:string){const rows=await prisma.listMembership.findMany({where:{workspaceId,listId,state:"active"},select:{profileId:true}});return rows.map(x=>x.profileId)},
  async segmentMemberProfileIds(workspaceId:string,segmentId:string){const rows=await prisma.segmentMembershipProjection.findMany({where:{workspaceId,segmentId,isMember:true},select:{profileId:true}});return rows.map(x=>x.profileId)},
  async marketingEligibility(workspaceId:string,profileId:string){const [profile,consent,suppressed]=await Promise.all([prisma.profile.findFirst({where:{workspaceId,id:profileId,deletedAt:null},select:{normalizedEmail:true}}),p2.subscriptionStatus(workspaceId,profileId),p2.activeProtectedSuppression(workspaceId,profileId)]);return {consent,protectedSuppression:suppressed,identifierValid:Boolean(profile?.normalizedEmail)}},
};
const broadcast=new MarketingBroadcastService(service,broadcastAudience,async(workspaceId,messageId)=>{if(jobs)await jobs.enqueue({type:"phase2.message.policy",workspaceId,messageId});else void dispatchProofMessage(workspaceId,messageId)});
// Proof mode remains usable on a developer machine without Redis.  The same
// persisted Message intent and canonical Phase2 pipeline are used; production
// never falls back to this in-process dispatcher and requires its worker.
async function dispatchProofMessage(workspaceId:string,messageId:string){
  try{
    const decision=await service.evaluatePolicy(workspaceId,messageId);
    if(decision.outcome!=="allow")return;
    await service.renderMessage(workspaceId,messageId);
    await service.submitMessage(workspaceId,messageId);
  }catch(error){
    const diagnostic=error instanceof Error?error.message.split(":")[0]:"UNKNOWN";
    console.error(JSON.stringify({service:"proof-delivery-dispatcher",workspaceId,messageId,diagnostic}));
  }
}
const identity:IdentityProvider=process.env.EMAIL_PLATFORM_OIDC_ISSUER&&process.env.EMAIL_PLATFORM_OIDC_AUDIENCE?new OidcJwtIdentityProvider({issuer:process.env.EMAIL_PLATFORM_OIDC_ISSUER,audience:process.env.EMAIL_PLATFORM_OIDC_AUDIENCE}):new DevelopmentIdentityProvider();
const port=Number(process.env.EMAIL_PLATFORM_API_PORT??4000),origin=process.env.EMAIL_PLATFORM_WEB_ORIGIN??"http://localhost:3000";
function headers(){return {"content-type":"application/json; charset=utf-8","access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type,x-dev-user,x-request-id","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS","cache-control":"no-store","x-content-type-options":"nosniff"}}
function send(res:ServerResponse,status:number,data:unknown){res.writeHead(status,headers());res.end(JSON.stringify(data,(_,v)=>typeof v==="bigint"?v.toString():v))}
function sendBinary(res:ServerResponse,status:number,contentType:string,body:Buffer){res.writeHead(status,{...headers(),"content-type":contentType,"cache-control":"public, max-age=86400"});res.end(body)}
async function json(req:IncomingMessage,limit=2_000_000){const chunks:Buffer[]=[];let size=0;for await(const c of req){const b=Buffer.from(c);size+=b.length;if(size>limit)throw new Error("REQUEST_TOO_LARGE");chunks.push(b)}return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{} }
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
function stringValue(value:unknown){return typeof value==="string"?value:""}
function categoryValue(body:Record<string,unknown>){if(!Object.hasOwn(body,"category"))return undefined;const value=body.category;if(value===null||typeof value==="string")return value;throw new Error("TEMPLATE_CATEGORY_INVALID")}
async function actor(req:IncomingMessage,workspaceId:string):Promise<Phase2ServiceActor>{const local=await localSessionActor(prisma,req);if(local)return {userId:local.userId,workspaceId};const id=await identity.authenticate({authorization:req.headers.authorization,devUser:String(req.headers["x-dev-user"]??"")});if(!id)throw new Error("AUTH_REQUIRED");const user=await p1.ensureUser({provider:identity instanceof DevelopmentIdentityProvider?"development":"oidc",subject:id.subject,email:id.email,displayName:id.displayName});return {userId:user.id,workspaceId}}
// `actor` only authenticates. Routes that read Prisma directly instead of going
// through Phase2Service must authorize workspace membership themselves.
async function requireMembership(a:Phase2ServiceActor,permission:Permission){const role=await p2.memberRole(a.workspaceId,a.userId) as Role|null;if(!role)throw new Error("WORKSPACE_ACCESS_DENIED");if(!hasPermission(role,permission))throw new Error(`FORBIDDEN:${permission}`);return role}
function code(e:unknown){const s=e instanceof Error?e.message:"ERROR";if(s.startsWith("AUTH_"))return 401;if(s.startsWith("FORBIDDEN")||s==="WORKSPACE_ACCESS_DENIED")return 403;if(s.includes("NOT_FOUND"))return 404;if(s.includes("CONFLICT")||s.includes("IN_USE")||s.includes("HAS_APPROVED"))return 409;return 400}
function normalizeApiError(e:unknown):{code:string;message:string}{
  if(!(e instanceof Error))return{code:"ERROR",message:"ERROR"};
  const raw=e.message;
  const token=raw.split(":")[0]??raw;
  if(/^[A-Z][A-Z0-9_]+$/.test(token)&&token.length<=64)return{code:token,message:token};
  if(/Prisma|P2022|column .* does not exist|template_type/i.test(raw))return{code:"SCHEMA_MIGRATION_REQUIRED",message:"SCHEMA_MIGRATION_REQUIRED"};
  return{code:"INTERNAL",message:"INTERNAL"};
}
function analyticsWindow(url:URL){const toRaw=url.searchParams.get("to"),fromRaw=url.searchParams.get("from"),days=Number(url.searchParams.get("days")??7),to=toRaw?new Date(toRaw):new Date(),from=fromRaw?new Date(fromRaw):new Date(to.getTime()-(Number.isInteger(days)&&[1,7,30].includes(days)?days:7)*86400_000);return {from,to}}

const server=createServer(async(req,res)=>{try{if(req.method==="OPTIONS"){res.writeHead(204,headers());return res.end()}const url=new URL(req.url??"/",`http://${req.headers.host??"localhost"}`),path=url.pathname;if(path==="/health"&&req.method==="GET")return send(res,200,{ok:true,phase:2,mode:"postgres",provider:mail.name});
  const publicAsset=path.match(/^\/api\/v1\/public\/content-assets\/([^/]+)\/([^/]+)$/);if(publicAsset&&req.method==="GET"){const served=await service.serveContentAsset(publicAsset[1]!,publicAsset[2]!);return sendBinary(res,200,served.mimeType,served.bytes)}
  const m=path.match(/^\/api\/v1\/workspaces\/([^/]+)(\/.*)?$/);if(!m)return send(res,404,{error:{code:"NOT_FOUND"}});const workspaceId=m[1]!,suffix=m[2]??"",a=await actor(req,workspaceId);
  if(suffix==="/emails"&&req.method==="GET")return send(res,200,await service.emailLibrary(a,{cursor:url.searchParams.get("cursor")??undefined,limit:Number(url.searchParams.get("limit")??25),query:url.searchParams.get("q")??undefined,sort:url.searchParams.get("sort")==="name"?"name":"updated",archived:url.searchParams.get("archived")==="true"}));if(suffix==="/emails"&&req.method==="POST")return send(res,201,await service.createEmail(a,await json(req)));
  if(suffix==="/content/profiles"&&req.method==="GET")return send(res,200,{items:await service.profileSearch(a,url.searchParams.get("q")??"")});
  if(suffix==="/content/variables"&&req.method==="GET")return send(res,200,{items:await service.variables(a)});
  if(suffix==="/content/variables"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.createCustomVariable(a,{key:stringValue(body.key),label:stringValue(body.label),defaultValue:stringValue(body.defaultValue),type:body.type==="url"?"url":"text"}))}
  if(suffix==="/content/universal-blocks"&&req.method==="GET")return send(res,200,{items:await service.universalBlocks(a,url.searchParams.get("archived")==="true")});
  if(suffix==="/content/universal-blocks"&&req.method==="POST"){const body=await json(req);if(!isRecord(body)||!Array.isArray(body.blocks))throw new Error("REQUEST_INVALID");const blocks=(body.blocks as StructuredEmailDocument["blocks"]).filter(block=>block.type!=="compliance_footer");return send(res,201,await service.createUniversalBlock(a,{name:stringValue(body.name),category:typeof body.category==="string"?body.category:undefined,blocks}))}
  if(suffix==="/content/media"&&req.method==="GET")return send(res,200,{items:await service.media(a,url.searchParams.get("archived")==="true")});
  if(suffix==="/content/media"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.createMedia(a,{name:stringValue(body.name),url:stringValue(body.url),altText:stringValue(body.altText),mimeType:typeof body.mimeType==="string"?body.mimeType:undefined}))}
  if(suffix==="/content/media/logo-upload"&&req.method==="POST"){const body=await json(req,3_000_000);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.uploadMediaLogo(a,{name:stringValue(body.name),contentBase64:stringValue(body.contentBase64),mimeType:stringValue(body.mimeType)}))}
  if(suffix==="/content/brand-kit"&&req.method==="GET")return send(res,200,await service.brand(a));
  if(suffix==="/content/brand-kit"&&req.method==="PATCH"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.saveBrand(a,{logoUrl:body.logoUrl===null?null:stringValue(body.logoUrl)||null,primaryColor:stringValue(body.primaryColor),secondaryColor:stringValue(body.secondaryColor),fontFamily:stringValue(body.fontFamily)}))}
  if(suffix==="/content/templates/import/paste"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.importTemplatePaste(a,stringValue(body.html)))}
  if(suffix==="/content/templates/import/upload"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.importTemplateUpload(a,{filename:stringValue(body.filename),contentBase64:stringValue(body.contentBase64),kind:body.kind==="zip"?"zip":"html"}))}
  if(suffix==="/content/templates/import/process"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.importTemplateProcess(a,{sessionId:stringValue(body.sessionId),selectedHtmlFile:typeof body.selectedHtmlFile==="string"?body.selectedHtmlFile:undefined}))}
  if(suffix==="/content/templates/import/save"&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.saveImportedTemplate(a,{sessionId:stringValue(body.sessionId),name:stringValue(body.name),category:typeof body.category==="string"?body.category:undefined,saveMode:body.saveMode==="blocks"?"blocks":"html",subject:typeof body.subject==="string"?body.subject:undefined,preheader:typeof body.preheader==="string"?body.preheader:undefined,plainText:typeof body.plainText==="string"?body.plainText:undefined}))}
  const importReport=suffix.match(/^\/content\/templates\/([^/]+)\/import-report$/);if(importReport&&req.method==="GET")return send(res,200,await service.templateImportReport(a,importReport[1]!));
  const convertBlocks=suffix.match(/^\/content\/templates\/([^/]+)\/convert-to-blocks$/);if(convertBlocks&&req.method==="POST")return send(res,200,await service.convertTemplateToBlocks(a,convertBlocks[1]!));
  const exportHtml=suffix.match(/^\/content\/templates\/([^/]+)\/export-html$/);if(exportHtml&&req.method==="POST"){const exported=await service.exportTemplateHtml(a,exportHtml[1]!);return send(res,200,exported)}
  if(suffix==="/content/templates"&&req.method==="GET")return send(res,200,await service.templates(a,{cursor:url.searchParams.get("cursor")??undefined,limit:Number(url.searchParams.get("limit")??25),query:url.searchParams.get("q")??undefined,archived:url.searchParams.get("archived")==="true"}));
  if(suffix==="/content/templates"&&req.method==="POST"){
    const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");
    const category=categoryValue(body);if(category===null)throw new Error("TEMPLATE_CATEGORY_INVALID");
    const editorType=body.editorType===undefined?undefined:body.editorType==="visual"||body.editorType==="text"?body.editorType:null;
    if(editorType===null)throw new Error("TEMPLATE_EDITOR_TYPE_INVALID");
    return send(res,201,await service.createTemplate(a,{name:stringValue(body.name),category,editorType}));
  }
  const useSystemTemplate=suffix.match(/^\/content\/system-templates\/([^/]+)\/use$/);if(useSystemTemplate&&req.method==="POST"){const body=await json(req);return send(res,201,await service.useSystemTemplate(a,useSystemTemplate[1]!,isRecord(body)&&typeof body.name==="string"?{name:body.name}:{}))}
  const email=suffix.match(/^\/emails\/([^/]+)$/);if(email&&req.method==="GET")return send(res,200,await service.getEmail(a,email[1]!));if(email&&req.method==="PATCH"){const b=await json(req);return send(res,200,await service.updateEmail(a,email[1]!,b))}
  const pf=suffix.match(/^\/emails\/([^/]+)\/preflight$/);if(pf&&req.method==="POST")return send(res,200,await service.preflight(a,pf[1]!));
  const preview=suffix.match(/^\/emails\/([^/]+)\/preview$/);if(preview&&req.method==="POST"){const b=await json(req);return send(res,200,await service.preview(a,preview[1]!,String(b.profileId??""),b.eventId?String(b.eventId):undefined))}
  const versionPreview=suffix.match(/^\/email-versions\/([^/]+)\/preview$/);if(versionPreview&&req.method==="POST"){const b=await json(req);return send(res,200,await service.previewPublishedVersion(a,versionPreview[1]!,String(b.profileId??"")))}
  const publish=suffix.match(/^\/emails\/([^/]+)\/publish$/);if(publish&&req.method==="POST")return send(res,201,await service.publish(a,publish[1]!,await json(req)));
  const restore=suffix.match(/^\/emails\/([^/]+)\/restore$/);if(restore&&req.method==="POST"){const b=await json(req);return send(res,200,await service.restore(a,restore[1]!,String(b.versionId??"")))}
  const testSend=suffix.match(/^\/emails\/([^/]+)\/test-sends$/);if(testSend&&req.method==="POST"){if(!jobs&&emailConfig.runtimeMode==="production")return send(res,503,{error:{code:"TEST_DELIVERY_UNAVAILABLE",message:"A delivery worker is required for test sends."}});const b=await json(req);const result=await service.testSend(a,testSend[1]!,{profileId:String(b.profileId??""),expectedRowVersion:b.expectedRowVersion===undefined?undefined:Number(b.expectedRowVersion)});if(jobs)await jobs.enqueue({type:"phase2.message.policy",workspaceId,messageId:result.messageId});else void dispatchProofMessage(workspaceId,result.messageId);return send(res,202,{...result,deliveryMode:jobs?"queued_worker":"local_proof_dispatcher"})}
  const versions=suffix.match(/^\/emails\/([^/]+)\/versions$/);if(versions&&req.method==="GET")return send(res,200,{items:await service.versions(a,versions[1]!)});
  const compare=suffix.match(/^\/emails\/([^/]+)\/versions\/compare$/);if(compare&&req.method==="GET")return send(res,200,await service.compareVersions(a,compare[1]!,String(url.searchParams.get("base")??""),String(url.searchParams.get("target")??"")));
  const dependencies=suffix.match(/^\/emails\/([^/]+)\/flow-dependencies$/);if(dependencies&&req.method==="GET")return send(res,200,{items:await service.dependencies(a,dependencies[1]!)});
  const duplicate=suffix.match(/^\/emails\/([^/]+)\/duplicate$/);if(duplicate&&req.method==="POST"){const b=await json(req);return send(res,201,await service.duplicate(a,duplicate[1]!,{internalName:String(b.internalName??"")}))}
  const archive=suffix.match(/^\/emails\/([^/]+)\/archive$/);if(archive&&req.method==="POST"){const b=await json(req);return send(res,200,await service.archive(a,archive[1]!,b.archived!==false))}
  const saveTemplate=suffix.match(/^\/emails\/([^/]+)\/save-as-template$/);if(saveTemplate&&req.method==="POST"){const b=await json(req);return send(res,201,await service.saveAsTemplate(a,saveTemplate[1]!,{name:String(b.name??""),category:b.category?String(b.category):undefined}))}
  const duplicateTemplate=suffix.match(/^\/content\/templates\/([^/]+)\/duplicate$/);if(duplicateTemplate&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.duplicateTemplate(a,duplicateTemplate[1]!,{name:stringValue(body.name)}))}
  const favoriteTemplate=suffix.match(/^\/content\/templates\/([^/]+)\/favorite$/);if(favoriteTemplate&&req.method==="POST"){const body=await json(req);if(!isRecord(body)||typeof body.favorite!=="boolean")throw new Error("REQUEST_INVALID");return send(res,200,await service.setTemplateFavorite(a,favoriteTemplate[1]!,body.favorite))}
  const archiveTemplate=suffix.match(/^\/content\/templates\/([^/]+)\/archive$/);if(archiveTemplate&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.archiveTemplate(a,archiveTemplate[1]!,body.archived!==false))}
  const deleteTemplate=suffix.match(/^\/content\/templates\/([^/]+)$/);if(deleteTemplate&&req.method==="DELETE")return send(res,200,await service.deleteTemplate(a,deleteTemplate[1]!));
  const templatePreflight=suffix.match(/^\/content\/templates\/([^/]+)\/preflight$/);if(templatePreflight&&req.method==="POST")return send(res,200,await service.templatePreflight(a,templatePreflight[1]!));
  const templateApprove=suffix.match(/^\/content\/templates\/([^/]+)\/approve$/);if(templateApprove&&req.method==="POST")return send(res,201,await service.approveTemplate(a,templateApprove[1]!));
  const templateVersions=suffix.match(/^\/content\/templates\/([^/]+)\/versions$/);if(templateVersions&&req.method==="GET")return send(res,200,{items:await service.templateVersions(a,templateVersions[1]!)});
  const templateUsage=suffix.match(/^\/content\/templates\/([^/]+)\/usage$/);if(templateUsage&&req.method==="GET")return send(res,200,{items:await service.templateUsage(a,templateUsage[1]!)});
  const campaignFromTemplate=suffix.match(/^\/content\/templates\/([^/]+)\/create-campaign$/);if(campaignFromTemplate&&req.method==="POST"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,201,await service.createCampaignFromApprovedTemplate(a,campaignFromTemplate[1]!,{internalName:stringValue(body.internalName)}))}
  const templateContent=suffix.match(/^\/content\/templates\/([^/]+)\/content$/);if(templateContent&&req.method==="PATCH"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.updateTemplateContent(a,templateContent[1]!,{document:body.document as StructuredEmailDocument,subject:stringValue(body.subject),preheader:stringValue(body.preheader),plainText:stringValue(body.plainText),settings:isRecord(body.settings)?body.settings:null,importedHtml:typeof body.importedHtml==="string"?body.importedHtml:undefined}))}
  const universalArchive=suffix.match(/^\/content\/universal-blocks\/([^/]+)\/archive$/);if(universalArchive&&req.method==="POST"){const body=await json(req);return send(res,200,await service.archiveUniversalBlock(a,universalArchive[1]!,!isRecord(body)||body.archived!==false))}
  const mediaArchive=suffix.match(/^\/content\/media\/([^/]+)\/archive$/);if(mediaArchive&&req.method==="POST"){const body=await json(req);return send(res,200,await service.archiveMedia(a,mediaArchive[1]!,!isRecord(body)||body.archived!==false))}
  const variableArchive=suffix.match(/^\/content\/variables\/([^/]+)\/archive$/);if(variableArchive&&req.method==="POST"){const body=await json(req);return send(res,200,await service.archiveCustomVariable(a,variableArchive[1]!,!isRecord(body)||body.archived!==false))}
  const template=suffix.match(/^\/content\/templates\/([^/]+)$/);if(template&&req.method==="GET")return send(res,200,await service.template(a,template[1]!));
  const updateTemplate=suffix.match(/^\/content\/templates\/([^/]+)$/);if(updateTemplate&&req.method==="PATCH"){const body=await json(req);if(!isRecord(body))throw new Error("REQUEST_INVALID");return send(res,200,await service.updateTemplate(a,updateTemplate[1]!,{name:stringValue(body.name),category:categoryValue(body)}))}
  if(suffix==="/campaigns/send"&&req.method==="POST"){const b=await json(req);if(!isRecord(b))throw new Error("REQUEST_INVALID");const audienceType=b.audienceType==="segment"?"segment":"list";const audienceId=stringValue(b.audienceId);const emailVersionId=stringValue(b.emailVersionId);if(!audienceId||!emailVersionId)throw new Error("CAMPAIGN_SEND_INVALID");const campaignId=typeof b.campaignId==="string"&&b.campaignId?b.campaignId:newCampaignId();return send(res,202,await broadcast.sendCampaign(a,{campaignId,emailVersionId,audienceType,audienceId}))}
  if(suffix==="/messages"&&req.method==="POST"){const b=await json(req);const message=await service.createMessageIntent(a,{sourceType:b.sourceType==="test"?"test":b.sourceType==="campaign"?"campaign":"manual",sourceId:String(b.sourceId??randomUUID()),profileId:String(b.profileId??""),emailVersionId:String(b.emailVersionId??"")});if(jobs)await jobs.enqueue({type:"phase2.message.policy",workspaceId,messageId:message.id});else void dispatchProofMessage(workspaceId,message.id);return send(res,202,{...message,queued:Boolean(jobs)})}
  const trace=suffix.match(/^\/messages\/([^/]+)\/trace$/);if(trace&&req.method==="GET")return send(res,200,await service.messageTrace(a,trace[1]!));
  if(suffix==="/send-policy"&&req.method==="POST")return send(res,200,await service.setSendPolicy(a,await json(req)));
  if(suffix==="/holds"&&req.method==="POST")return send(res,201,await service.createHold(a,await json(req)));
  const release=suffix.match(/^\/holds\/([^/]+)\/release$/);if(release&&req.method==="POST"){const b=await json(req);await service.releaseHold(a,release[1]!,String(b.reason??"operator release"));return send(res,200,{ok:true})}
  const delivery=suffix.match(/^\/deliverability\/(overview|bounces|complaints)$/);if(delivery&&req.method==="GET"){await requireMembership(a,"analytics.read");const kind=delivery[1]!;if(kind==="overview"){const [analytics,domains,holds]=await Promise.all([service.analytics(a,Number(url.searchParams.get("days")??7)),p1.listDomains(workspaceId),p2.activeHolds(workspaceId)]);return send(res,200,{analytics,domains,holds})}const events=await (prisma as any).deliveryEvent.findMany({where:{workspaceId,eventType:kind==="bounces"?{in:["bounce","soft_bounce","hard_bounce"]}:"complaint"},orderBy:{occurredAt:"desc"},take:200});return send(res,200,{items:events})}
  if(suffix==="/analytics"&&req.method==="GET")return send(res,200,await service.analyticsPeriod(a,analyticsWindow(url)));
  return send(res,404,{error:{code:"NOT_FOUND"}})
}catch(e){const normalized=normalizeApiError(e);return send(res,code(e),{error:{code:normalized.code,message:normalized.message}})}});
server.listen(port,"127.0.0.1",()=>console.log(`Phase 2 real API: http://localhost:${port}`));
for(const sig of ["SIGINT","SIGTERM"] as const)process.on(sig,async()=>{server.close();await jobs?.close();await prisma.$disconnect();process.exit(0)});
