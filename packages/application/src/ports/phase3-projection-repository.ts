import type { SegmentRule } from '../../../domain/src/phase3/segment-rules.js';
export interface ProjectionSegmentVersion3 {id:string;workspaceId:string;segmentId:string;rule:SegmentRule;versionNumber:number}
export interface SegmentProjectionRefresh3 {segmentId:string;segmentVersionId:string;members:number;entered:number;left:number;evaluatedAt:Date;transitionKeys:string[]}
export interface Phase3ProjectionRepository{
  latestSegmentVersion(workspaceId:string,segmentId:string):Promise<ProjectionSegmentVersion3|null>;
  matchingProfileIds(workspaceId:string,rule:SegmentRule):Promise<string[]>;
  refreshSegmentProjection(input:{workspaceId:string;segmentId:string;segmentVersionId:string;memberProfileIds:string[];evaluatedAt:Date}):Promise<SegmentProjectionRefresh3>;
  startSegmentEvaluation?(input:{workspaceId:string;segmentId:string;segmentVersionId:string;trigger:string;startedAt:Date}):Promise<{id:string}>;
  completeSegmentEvaluation?(input:{id:string;memberCount:number;evaluatedAt:Date;completedAt:Date}):Promise<void>;
  failSegmentEvaluation?(input:{id:string;errorCode:string;completedAt:Date}):Promise<void>;
}
