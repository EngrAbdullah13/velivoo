import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { DELIVERY_QUEUE_MAX_ATTEMPTS, DELIVERY_QUEUE_RETRY_DELAY_MS } from "../../../domain/src/phase2/delivery-pacing.js";

export type Phase2Job =
  | {type:"phase2.message.policy";workspaceId:string;messageId:string}
  | {type:"phase2.message.render";workspaceId:string;messageId:string}
  | {type:"phase2.message.submit";workspaceId:string;messageId:string}
  | {type:"phase2.message.reconcile";workspaceId:string;messageId:string};

export const PHASE2_QUEUE_NAME="phase2.messages";
export class Phase2JobQueue {
  readonly connection:Redis; readonly queue:Queue<Phase2Job>;
  constructor(redisUrl:string){this.connection=new Redis(redisUrl,{maxRetriesPerRequest:null});this.queue=new Queue<Phase2Job>(PHASE2_QUEUE_NAME,{connection:this.connection})}
  async enqueue(job:Phase2Job,delay=0){const id=[job.type,job.workspaceId,job.messageId].join("/");const submit=job.type==="phase2.message.submit";await this.queue.add(job.type,job,{jobId:id,delay,attempts:submit?DELIVERY_QUEUE_MAX_ATTEMPTS:5,backoff:{type:submit?"fixed":"exponential",delay:submit?DELIVERY_QUEUE_RETRY_DELAY_MS:1000},removeOnComplete:1000,removeOnFail:1000})}
  async close(){await this.queue.close();await this.connection.quit()}
}
export function createPhase2Worker(redisUrl:string,handler:(job:Phase2Job,queue:Queue<Phase2Job>)=>Promise<void>){const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});const queue=new Queue<Phase2Job>(PHASE2_QUEUE_NAME,{connection});const worker=new Worker<Phase2Job>(PHASE2_QUEUE_NAME,async(job:Job<Phase2Job>)=>handler(job.data,queue),{connection,concurrency:Number(process.env.EMAIL_PLATFORM_PHASE2_WORKER_CONCURRENCY??4)});return {worker,queue,connection}}
