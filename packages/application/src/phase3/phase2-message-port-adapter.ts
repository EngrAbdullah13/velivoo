import { createHash } from 'node:crypto';
import type { Phase2Repository } from '../ports/phase2-repository.js';
import type { Phase2FlowMessagePort } from '../ports/phase3-runtime-repository.js';

/** Uses the same stable identity semantics as Phase 2, while preserving flow-run/node linkage. */
export class Phase2RepositoryMessagePort implements Phase2FlowMessagePort{
  constructor(private readonly repo:Phase2Repository){}
  async createFlowMessage(i:{workspaceId:string;flowRunId:string;nodeId:string;profileId:string;emailVersionId:string;sequence:number;mode:'test'|'live'}){
    const key=createHash('sha256').update([i.workspaceId,'flow',i.mode,i.flowRunId,i.nodeId,i.profileId,i.emailVersionId,String(i.sequence)].join('|')).digest('hex');
    const existing=await this.repo.messageByIdempotency(i.workspaceId,key);if(existing)return {messageId:existing.id,duplicate:true};
    const m=await this.repo.createMessage({workspaceId:i.workspaceId,sourceType:i.mode==='test'?'test':'flow',sourceId:i.flowRunId,flowRunId:i.flowRunId,nodeId:i.nodeId,profileId:i.profileId,emailVersionId:i.emailVersionId,idempotencyKey:key,scheduledFor:new Date()});return {messageId:m.id,duplicate:false};
  }
  async cancelPendingForRuns(i:{workspaceId:string;runIds:string[]}){
    // Phase 2 repository intentionally exposes message-by-id rather than broad mutation queries.
    // The Prisma runtime overrides this through its repository adapter; proof adapters implement exact counts.
    // Returning zero is safe for repositories that cannot enumerate messages: final policy still rechecks run cancellation.
    void i;return 0;
  }
}
