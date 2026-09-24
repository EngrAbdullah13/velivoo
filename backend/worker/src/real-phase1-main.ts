import { PrismaClient } from "@prisma/client";
import { PrismaPhase1Repository } from "../../../packages/persistence/src/prisma/phase1-repository.js";
import { LocalObjectStore } from "../../../packages/object-store/src/local-object-store.js";
import { Phase1Service } from "../../../packages/application/src/phase1/phase1-service.js";
import { createPhase1Worker } from "../../../packages/queue/src/bullmq/phase1-job-queue.js";
import { loadEmailPlatformConfig } from "../../../packages/config/src/env.js";

const databaseUrl=process.env.DATABASE_URL;if(!databaseUrl)throw new Error("DATABASE_URL_REQUIRED");
const redisUrl=process.env.REDIS_URL;if(!redisUrl)throw new Error("REDIS_URL_REQUIRED");
const emailConfig=loadEmailPlatformConfig();
const prisma=new PrismaClient();const repo=new PrismaPhase1Repository(prisma);const objects=new LocalObjectStore(process.env.EMAIL_PLATFORM_OBJECT_ROOT??".local/objects");const service=new Phase1Service(repo,objects);
const worker=createPhase1Worker(redisUrl,async job=>{
  if(job.type==="phase1.import.commit")await service.commitImport(job.workspaceId,{userId:job.actorId,email:"worker@local"},job.importId);
  else await service.generateExport(job.workspaceId,job.exportId);
});
worker.on("completed",job=>console.log(JSON.stringify({event:"phase1.job.completed",id:job.id,name:job.name})));
worker.on("failed",(job,error)=>console.error(JSON.stringify({event:"phase1.job.failed",id:job?.id,name:job?.name,error:error.message})));
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,async()=>{await worker.close();await prisma.$disconnect();process.exit(0)});
console.log(JSON.stringify({worker:"phase1",status:"running",emailProvider:emailConfig.emailProvider,runtimeMode:emailConfig.runtimeMode,sesDomainSetupEnabled:emailConfig.sesDomainSetupEnabled,awsSesRegion:emailConfig.awsSesRegion??null,credentialSource:emailConfig.credentialSource}));
