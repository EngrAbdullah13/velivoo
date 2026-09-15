import { PrismaClient } from '@prisma/client';
import { PrismaPhase3Repository } from '../../../packages/persistence/src/prisma/phase3-repository.js';
import { PrismaFlowRuleEvaluationPort,PrismaPhase2FlowMessagePort } from '../../../packages/persistence/src/prisma/phase3-runtime-adapters.js';
import { Phase3RuntimeService } from '../../../packages/application/src/phase3/phase3-runtime-service.js';
import { SegmentProjectionService3 } from '../../../packages/application/src/phase3/segment-projection-service.js';
import { createPhase3Worker,type Phase3Job } from '../../../packages/queue/src/bullmq/phase3-job-queue.js';
const redisUrl=process.env.REDIS_URL;if(!redisUrl)throw new Error('REDIS_URL_REQUIRED');const db=new PrismaClient(),repo=new PrismaPhase3Repository(db),runtime=new Phase3RuntimeService(repo,new PrismaPhase2FlowMessagePort(db),new PrismaFlowRuleEvaluationPort(db)),projection=new SegmentProjectionService3(repo);
const rt=createPhase3Worker(redisUrl,async(job:Phase3Job)=>{
  if(job.type==='phase3.segment.refresh'){await projection.refresh(job.workspaceId,job.segmentId,new Date(),'scheduled');return}
  if(job.type==='phase3.event.route'){
    const e=await repo.eventById(job.workspaceId,job.eventId);if(!e||!e.profileId)return;const dependencies=await (db as any).flowTriggerDependency.findMany({where:{workspaceId:job.workspaceId,triggerType:'generic_event',eventName:e.name,schemaVersion:e.schemaVersion}});
    for(const dependency of dependencies){const f=await repo.flow(job.workspaceId,dependency.flowId),occurredAt=new Date(e.occurredAt);if(!f||!['active','testing'].includes(f.status)||f.activeVersionId!==dependency.flowVersionId||!f.activeVersionActivatedAt||new Date(f.activeVersionActivatedAt)>occurredAt)continue;await runtime.enter({workspaceId:job.workspaceId,flowId:f.id,profileId:e.profileId,triggerEventId:e.id,triggerKey:e.id,now:occurredAt}).catch(err=>{if(!String(err?.message??err).includes('FLOW_ENTRIES_BLOCKED'))throw err})}
    return;
  }
  if(job.type==='phase3.date.route'){
    const schedule=await (db as any).flowDateTriggerSchedule.findFirst({where:{workspaceId:job.workspaceId,id:job.scheduleId,state:'leased'}});if(!schedule)return;
    const flow=await repo.flow(job.workspaceId,schedule.flowId);
    if(!flow||!['active','testing'].includes(flow.status)||flow.activeVersionId!==schedule.flowVersionId||!flow.activeVersionActivatedAt||new Date(flow.activeVersionActivatedAt)>new Date(schedule.dueAt)){await (db as any).flowDateTriggerSchedule.update({where:{id:schedule.id},data:{state:'cancelled',leaseOwner:null,leaseExpiresAt:null}});return}
    try{await runtime.enter({workspaceId:job.workspaceId,flowId:flow.id,profileId:schedule.profileId,triggerEventId:schedule.id,triggerKey:`profile-date:${schedule.id}`,now:new Date(schedule.dueAt)});await (db as any).flowDateTriggerSchedule.update({where:{id:schedule.id},data:{state:'completed',dispatchedAt:new Date(),leaseOwner:null,leaseExpiresAt:null}})}catch(error){await (db as any).flowDateTriggerSchedule.update({where:{id:schedule.id},data:{state:'pending',leaseOwner:null,leaseExpiresAt:null}});throw error}
    return;
  }
  if(job.type==='phase3.audience.transition'){
    const transition=job.audienceType==='list'?await (db as any).listMembership.findFirst({where:{workspaceId:job.workspaceId,id:job.transitionId,state:'active'}}):await (db as any).segmentMembershipTransition.findFirst({where:{workspaceId:job.workspaceId,id:job.transitionId,transition:'entered'}});if(!transition)return;
    if(job.audienceType==='segment'){const run=await (db as any).segmentEvaluationRun.findFirst({where:{workspaceId:job.workspaceId,segmentId:transition.segmentId,segmentVersionId:transition.segmentVersionId},orderBy:{startedAt:'desc'}});if(run?.state!=='current'||!run.evaluatedAt||Date.now()-new Date(run.evaluatedAt).getTime()>15*60*1000)return}
    const referenceId=job.audienceType==='list'?transition.listId:transition.segmentId,triggerType=job.audienceType==='list'?'list_joined':'segment_entered',occurredAt=transition.occurredAt??transition.joinedAt,dependencies=await (db as any).flowTriggerDependency.findMany({where:{workspaceId:job.workspaceId,triggerType,referenceId}});
    for(const dependency of dependencies){const f=await repo.flow(job.workspaceId,dependency.flowId);if(!f||!['active','testing'].includes(f.status)||f.activeVersionId!==dependency.flowVersionId||!f.activeVersionActivatedAt||new Date(f.activeVersionActivatedAt)>new Date(occurredAt))continue;await runtime.enter({workspaceId:job.workspaceId,flowId:f.id,profileId:transition.profileId,triggerEventId:transition.id,triggerKey:`audience:${job.audienceType}:${transition.id}`,now:occurredAt}).catch(err=>{if(!String(err?.message??err).includes('FLOW_ENTRIES_BLOCKED'))throw err})}
    return;
  }
  const action=await repo.scheduledAction(job.workspaceId,job.actionId);if(!action)return;await runtime.executeAction(action,new Date());
});
rt.worker.on('completed',j=>console.log(JSON.stringify({event:'phase3.job.completed',id:j.id,name:j.name})));rt.worker.on('failed',(j,e)=>console.error(JSON.stringify({event:'phase3.job.failed',id:j?.id,name:j?.name,error:e.message})));
for(const sig of ['SIGINT','SIGTERM'] as const)process.on(sig,async()=>{await rt.worker.close();await rt.connection.quit();await db.$disconnect();process.exit(0)});console.log(JSON.stringify({worker:'phase3',status:'running'}));
