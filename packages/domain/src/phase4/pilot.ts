import type {PilotStage4} from './launch.js';
export interface PilotObservation4{
  id:string;
  stage:PilotStage4;
  audience:string;
  startedAt:Date;
  finishedAt:Date;
  healthPassed:boolean;
  unresolvedAlerts:number;
  expectedEventsReceived?:boolean;
  enoughFeedback?:boolean;
  withinWarmingCeiling?:boolean;
  completeFlowCycle?:boolean;
  approvedBy:string;
  evidence:Record<string,unknown>;
  recordedAt:Date;
}
export function validatePilotObservation4(x:PilotObservation4){
  if(x.finishedAt.getTime()<x.startedAt.getTime())throw new Error('PILOT_OBSERVATION_TIME_INVALID');
  if(!x.approvedBy.trim())throw new Error('PILOT_OBSERVATION_APPROVER_REQUIRED');
  if(!x.healthPassed||x.unresolvedAlerts>0)throw new Error('PILOT_HEALTH_NOT_CLEAN');
  const hours=(x.finishedAt.getTime()-x.startedAt.getTime())/3_600_000;
  if(x.stage===0&&!x.expectedEventsReceived)throw new Error('PILOT_STAGE0_EVENTS_REQUIRED');
  if(x.stage===1&&hours<48&&!x.enoughFeedback)throw new Error('PILOT_STAGE1_OBSERVATION_INSUFFICIENT');
  if(x.stage===2&&!x.withinWarmingCeiling)throw new Error('PILOT_STAGE2_WARMING_REQUIRED');
  if(x.stage===3&&!x.completeFlowCycle)throw new Error('PILOT_STAGE3_FLOW_CYCLE_REQUIRED');
  return x;
}
