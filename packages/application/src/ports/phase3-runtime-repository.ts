import type { FlowGraph3 } from '../../../domain/src/phase3/flow.js';

export type FlowRunState3='active'|'waiting'|'held'|'completed'|'exited'|'cancelled'|'failed';
export type ScheduledActionState3='pending'|'leased'|'held'|'completed'|'cancelled';

export interface RuntimeFlow3 {
  id:string; workspaceId:string; status:'draft'|'testing'|'active'|'paused'|'archived';
  activeVersionId?:string; activeVersionActivatedAt?:Date|null; entryState:'open'|'blocked'; executionState:'running'|'paused'; pausedAt?:Date|null;
}
export interface RuntimeFlowVersion3 {id:string;workspaceId:string;flowId:string;versionNumber:number;graph:FlowGraph3;graphHash:string}
export interface RuntimeFlowRun3 {
  id:string;workspaceId:string;flowId:string;flowVersionId:string;profileId:string;triggerEventId?:string|null;deduplicationKey:string;
  state:FlowRunState3;currentNodeId:string;enteredAt:Date;nextActionAt?:Date|null;endedAt?:Date|null;exitReason?:string|null;rowVersion:number;
}
export interface RuntimeNodeExecution3 {
  id:string;workspaceId:string;flowRunId:string;nodeId:string;attemptSequence:number;state:'started'|'completed'|'failed';
  scheduledAt?:Date|null;startedAt?:Date|null;completedAt?:Date|null;inputSnapshot?:unknown;evaluationResult?:unknown;error?:unknown;
}
export interface RuntimeScheduledAction3 {
  id:string;workspaceId:string;flowRunId:string;nodeId:string;deduplicationKey:string;dueAt:Date;state:ScheduledActionState3;
  leaseOwner?:string|null;leaseExpiresAt?:Date|null;attemptCount:number;createdAt:Date;completedAt?:Date|null;
}
export interface RuntimeTrace3 {kind:string;occurredAt:Date;detail:Record<string,unknown>}
export interface RuntimeProfileContext3 {id:string;workspaceId:string;timezone?:string|null;workspaceTimezone:string}
export interface PauseResult3 {newEntriesBlocked:number;heldActions:number;cancelledRuns:number;cancelledActions:number;cancelledMessages:number}
export interface DeadLetter3 {id:string;workspaceId:string;resourceType:string;resourceId:string;jobType:string;businessKey:string;error:unknown;state:'open'|'replayed';createdAt:Date;replayedAt?:Date|null}

export interface Phase3RuntimeRepository {
  transaction<T>(fn:(tx:Phase3RuntimeRepository)=>Promise<T>):Promise<T>;
  flow(workspaceId:string,flowId:string):Promise<RuntimeFlow3|null>;
  flowVersion(workspaceId:string,versionId:string):Promise<RuntimeFlowVersion3|null>;
  profileContext(workspaceId:string,profileId:string):Promise<RuntimeProfileContext3|null>;
  latestRunForProfile(workspaceId:string,flowId:string,profileId:string):Promise<RuntimeFlowRun3|null>;
  createRunIfAbsent(input:{workspaceId:string;flowId:string;flowVersionId:string;profileId:string;triggerEventId?:string;deduplicationKey:string;firstNodeId:string;enteredAt:Date}):Promise<{run:RuntimeFlowRun3;duplicate:boolean}>;
  run(workspaceId:string,runId:string):Promise<RuntimeFlowRun3|null>;
  listRuns(workspaceId:string,flowId:string):Promise<RuntimeFlowRun3[]>;
  updateRun(input:{workspaceId:string;runId:string;state?:FlowRunState3;currentNodeId?:string;nextActionAt?:Date|null;endedAt?:Date|null;exitReason?:string|null}):Promise<RuntimeFlowRun3>;
  beginNodeExecution(input:{workspaceId:string;flowRunId:string;nodeId:string;scheduledAt?:Date;inputSnapshot?:unknown}):Promise<{execution:RuntimeNodeExecution3;duplicate:boolean}>;
  completeNodeExecution(input:{workspaceId:string;executionId:string;evaluationResult?:unknown}):Promise<void>;
  failNodeExecution(input:{workspaceId:string;executionId:string;error:unknown}):Promise<void>;
  scheduleAction(input:{workspaceId:string;flowRunId:string;nodeId:string;deduplicationKey:string;dueAt:Date}):Promise<RuntimeScheduledAction3>;
  claimDueActions(input:{now:Date;leaseOwner:string;leaseMs:number;limit:number}):Promise<RuntimeScheduledAction3[]>;
  scheduledAction(workspaceId:string,actionId:string):Promise<RuntimeScheduledAction3|null>;
  completeAction(workspaceId:string,actionId:string):Promise<void>;
  releaseExpiredLeases(now:Date):Promise<number>;
  addTrace(workspaceId:string,runId:string,kind:string,detail:Record<string,unknown>,occurredAt?:Date):Promise<void>;
  trace(workspaceId:string,runId:string):Promise<RuntimeTrace3[]>;
  setFlowExecutionState(input:{workspaceId:string;flowId:string;entryState:'open'|'blocked';executionState:'running'|'paused';pausedAt?:Date|null;status?:RuntimeFlow3['status']}):Promise<void>;
  holdPendingActions(workspaceId:string,flowId:string):Promise<number>;
  resumeHeldActions(input:{workspaceId:string;flowId:string;now:Date;pausedAt?:Date|null;overduePolicy:'immediate'|'shift_by_pause_duration'}):Promise<number>;
  cancelPendingRunsAndActions(workspaceId:string,flowId:string,now:Date):Promise<{runs:number;actions:number;runIds:string[]}>;
  exitRunAndCancelPending(input:{workspaceId:string;runId:string;actionId:string;now:Date;reason:string;detail:Record<string,unknown>}):Promise<{cancelledActions:number;cancelledMessages:number}>;
  runCounts(workspaceId:string,flowId:string):Promise<Record<string,number>>;
  recordDeadLetter(input:{workspaceId:string;resourceType:string;resourceId:string;jobType:string;businessKey:string;error:unknown}):Promise<DeadLetter3>;
  listDeadLetters(workspaceId:string,flowId?:string):Promise<DeadLetter3[]>;
  replayDeadLetter(workspaceId:string,id:string,at:Date):Promise<RuntimeScheduledAction3>;
}

export interface Phase2FlowMessagePort {
  createFlowMessage(input:{workspaceId:string;flowRunId:string;nodeId:string;profileId:string;emailVersionId:string;sequence:number;mode:'test'|'live'}):Promise<{messageId:string;duplicate:boolean}>;
  cancelPendingForRuns(input:{workspaceId:string;runIds:string[]}):Promise<number>;
}

export interface FlowRuleEvaluationPort {
  evaluate(input:{workspaceId:string;profileId:string;rule:unknown;at:Date}):Promise<{result:boolean;evidence:Record<string,unknown>}>;
}
