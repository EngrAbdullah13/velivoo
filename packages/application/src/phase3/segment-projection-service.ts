import type { Phase3ProjectionRepository } from '../ports/phase3-projection-repository.js';
export class SegmentProjectionService3{
  constructor(private readonly repo:Phase3ProjectionRepository){}
  async refresh(workspaceId:string,segmentId:string,at=new Date(),trigger='manual'){
    const v=await this.repo.latestSegmentVersion(workspaceId,segmentId);if(!v)throw new Error('SEGMENT_PUBLISHED_VERSION_REQUIRED');const run=await this.repo.startSegmentEvaluation?.({workspaceId,segmentId,segmentVersionId:v.id,trigger,startedAt:at});
    try{const members=await this.repo.matchingProfileIds(workspaceId,v.rule),result=await this.repo.refreshSegmentProjection({workspaceId,segmentId,segmentVersionId:v.id,memberProfileIds:members,evaluatedAt:at});await this.repo.completeSegmentEvaluation?.({id:run?.id??'',memberCount:result.members,evaluatedAt:at,completedAt:new Date()});return result}
    catch(error){await this.repo.failSegmentEvaluation?.({id:run?.id??'',errorCode:error instanceof Error?error.message.slice(0,120):'SEGMENT_EVALUATION_FAILED',completedAt:new Date()});throw error}
  }
}
