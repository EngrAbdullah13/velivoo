import { PrismaClient } from "@prisma/client";
import { PrismaPhase2Repository } from "../../../packages/persistence/src/prisma/phase2-repository.js";
import { LocalObjectStore } from "../../../packages/object-store/src/local-object-store.js";
import { Phase2Service } from "../../../packages/application/src/phase2/phase2-service.js";
import { DisabledEmailProvider } from "../../../packages/provider-email/src/disabled-email-provider.js";
import { SesEmailProvider } from "../../../packages/provider-email/src/ses/ses-provider.js";
import type { EmailDeliveryProvider } from "../../../packages/application/src/ports/email-delivery-provider.js";
import { createPhase2Worker, type Phase2Job } from "../../../packages/queue/src/bullmq/phase2-job-queue.js";
import { loadEmailPlatformConfig } from "../../../packages/config/src/env.js";

const redisUrl=process.env.REDIS_URL;if(!redisUrl)throw new Error("REDIS_URL_REQUIRED");
const emailConfig=loadEmailPlatformConfig();
const prisma=new PrismaClient(),repo=new PrismaPhase2Repository(prisma),objects=new LocalObjectStore(process.env.EMAIL_PLATFORM_OBJECT_ROOT??".local/objects");
const provider:EmailDeliveryProvider=emailConfig.emailProvider==="ses"&&emailConfig.emailSendEnabled?new SesEmailProvider(emailConfig.awsSesRegion??"",emailConfig.runtimeMode==="production"?undefined:emailConfig.sesConfigurationSet,emailConfig.sesSupportedRegions):new DisabledEmailProvider();
const service=new Phase2Service(repo,objects,provider,{publicBaseUrl:process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL??"http://localhost:4001",unsubscribeSecret:process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET??"change-this-development-unsubscribe-secret-123456",trackingSecret:process.env.EMAIL_PLATFORM_TRACKING_SIGNING_SECRET??"change-this-development-tracking-secret-123456789",maxMessageBytes:Number(process.env.EMAIL_PLATFORM_MAX_MESSAGE_BYTES??500000),providerReady:provider.name!=="disabled",requireWorkspaceConfigurationSet:emailConfig.runtimeMode==="production",unsubscribePublicBaseOnly:emailConfig.runtimeMode!=="production"});
const runtime=createPhase2Worker(redisUrl,async(job:Phase2Job,queue)=>{
  if(job.type==="phase2.message.policy"){const d=await service.evaluatePolicy(job.workspaceId,job.messageId);if(d.outcome==="allow")await queue.add("phase2.message.render",{type:"phase2.message.render",workspaceId:job.workspaceId,messageId:job.messageId},{jobId:`phase2.message.render:${job.workspaceId}:${job.messageId}`,attempts:5,removeOnComplete:1000});}
  else if(job.type==="phase2.message.render"){await service.renderMessage(job.workspaceId,job.messageId);await queue.add("phase2.message.submit",{type:"phase2.message.submit",workspaceId:job.workspaceId,messageId:job.messageId},{jobId:`phase2.message.submit:${job.workspaceId}:${job.messageId}`,attempts:1,removeOnComplete:1000});}
  else if(job.type==="phase2.message.submit"){const m=await service.submitMessage(job.workspaceId,job.messageId);if(m?.state==="unknown")await queue.add("phase2.message.reconcile",{type:"phase2.message.reconcile",workspaceId:job.workspaceId,messageId:job.messageId},{jobId:`phase2.message.reconcile:${job.workspaceId}:${job.messageId}`,delay:30000,attempts:10,backoff:{type:"exponential",delay:5000},removeOnComplete:1000});}
  else await service.reconcileUnknown(job.workspaceId,job.messageId);
});
runtime.worker.on("completed",j=>console.log(JSON.stringify({event:"phase2.job.completed",id:j.id,name:j.name})));runtime.worker.on("failed",(j,e)=>console.error(JSON.stringify({event:"phase2.job.failed",id:j?.id,name:j?.name,error:e.message})));
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,async()=>{await runtime.worker.close();await runtime.queue.close();await runtime.connection.quit();await prisma.$disconnect();process.exit(0)});
console.log(JSON.stringify({worker:"phase2",provider:provider.name,status:"running",runtimeMode:emailConfig.runtimeMode,awsSesRegion:emailConfig.awsSesRegion??null,credentialSource:emailConfig.credentialSource}));
