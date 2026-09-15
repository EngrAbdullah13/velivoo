import { Queue,Worker,type Job } from 'bullmq';
import { Redis } from 'ioredis';
export type Phase3Job=
 |{type:'phase3.flow.execute';workspaceId:string;actionId:string}
 |{type:'phase3.segment.refresh';workspaceId:string;segmentId:string}
 |{type:'phase3.event.route';workspaceId:string;eventId:string}
 |{type:'phase3.date.route';workspaceId:string;scheduleId:string}
 |{type:'phase3.audience.transition';workspaceId:string;transitionId:string;audienceType:'list'|'segment'};
export const PHASE3_QUEUE_NAME='phase3.automation';
export class Phase3JobQueue{
 readonly connection:Redis;readonly queue:Queue<Phase3Job>;
 constructor(redisUrl:string){this.connection=new Redis(redisUrl,{maxRetriesPerRequest:null});this.queue=new Queue<Phase3Job>(PHASE3_QUEUE_NAME,{connection:this.connection})}
 async enqueue(job:Phase3Job){const id=job.type==='phase3.flow.execute'?`${job.type}:${job.workspaceId}:${job.actionId}`:job.type==='phase3.segment.refresh'?`${job.type}:${job.workspaceId}:${job.segmentId}`:job.type==='phase3.event.route'?`${job.type}:${job.workspaceId}:${job.eventId}`:job.type==='phase3.date.route'?`${job.type}:${job.workspaceId}:${job.scheduleId}`:`${job.type}:${job.workspaceId}:${job.audienceType}:${job.transitionId}`;await this.queue.add(job.type,job,{jobId:id,attempts:5,backoff:{type:'exponential',delay:1000},removeOnComplete:1000,removeOnFail:1000})}
 async close(){await this.queue.close();await this.connection.quit()}
}
export function createPhase3Worker(redisUrl:string,handler:(job:Phase3Job)=>Promise<void>){const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});const worker=new Worker<Phase3Job>(PHASE3_QUEUE_NAME,async(job:Job<Phase3Job>)=>handler(job.data),{connection,concurrency:Number(process.env.EMAIL_PLATFORM_PHASE3_WORKER_CONCURRENCY??4)});return {worker,connection}}
