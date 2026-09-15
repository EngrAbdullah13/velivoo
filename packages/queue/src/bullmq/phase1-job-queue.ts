import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

export type Phase1Job =
  | { type:"phase1.import.commit"; workspaceId:string; importId:string; actorId:string }
  | { type:"phase1.export.generate"; workspaceId:string; exportId:string; actorId:string };

export class Phase1JobQueue {
  readonly connection: Redis;
  readonly queue: Queue<Phase1Job>;
  constructor(redisUrl:string){this.connection=new Redis(redisUrl,{maxRetriesPerRequest:null});this.queue=new Queue<Phase1Job>("phase1.background",{connection:this.connection});}
  async enqueue(job:Phase1Job):Promise<string>{const stable=`${job.type}:${job.workspaceId}:${job.type==="phase1.import.commit"?job.importId:job.exportId}`;const q=await this.queue.add(job.type,job,{jobId:stable,attempts:5,backoff:{type:"exponential",delay:1000},removeOnComplete:100,removeOnFail:500});return String(q.id)}
  async close(){await this.queue.close();await this.connection.quit()}
}

export function createPhase1Worker(redisUrl:string,handler:(job:Phase1Job)=>Promise<void>):Worker<Phase1Job>{
  const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});
  return new Worker<Phase1Job>("phase1.background",async(job:Job<Phase1Job>)=>handler(job.data),{connection,concurrency:Number(process.env.EMAIL_PLATFORM_PHASE1_WORKER_CONCURRENCY??2)});
}
