import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

export type Phase2Job =
  | {type:"phase2.message.policy";workspaceId:string;messageId:string}
  | {type:"phase2.message.render";workspaceId:string;messageId:string}
  | {type:"phase2.message.submit";workspaceId:string;messageId:string}
  | {type:"phase2.message.reconcile";workspaceId:string;messageId:string};

export const PHASE2_QUEUE_NAME="phase2.messages";
export class Phase2JobQueue {
  readonly connection:Redis; readonly queue:Queue<Phase2Job>;
  constructor(redisUrl:string){this.connection=new Redis(redisUrl,{maxRetriesPerRequest:null});this.queue=new Queue<Phase2Job>(PHASE2_QUEUE_NAME,{connection:this.connection})}
  async enqueue(job:Phase2Job,delay=0){const id=`${job.type}:${job.workspaceId}:${job.messageId}`;await this.queue.add(job.type,job,{jobId:id,delay,attempts:job.type==="phase2.message.submit"?1:5,backoff:{type:"exponential",delay:1000},removeOnComplete:1000,removeOnFail:1000})}
  async close(){await this.queue.close();await this.connection.quit()}
}
export function createPhase2Worker(redisUrl:string,handler:(job:Phase2Job,queue:Queue<Phase2Job>)=>Promise<void>){const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});const queue=new Queue<Phase2Job>(PHASE2_QUEUE_NAME,{connection});const worker=new Worker<Phase2Job>(PHASE2_QUEUE_NAME,async(job:Job<Phase2Job>)=>handler(job.data,queue),{connection,concurrency:Number(process.env.EMAIL_PLATFORM_PHASE2_WORKER_CONCURRENCY??4)});return {worker,queue,connection}}
