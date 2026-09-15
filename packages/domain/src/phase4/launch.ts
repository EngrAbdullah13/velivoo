export type SecuritySeverity4='S0'|'S1'|'S2'|'S3'|'S4';
export type EvidenceArea4='product'|'data_integrity'|'security'|'deliverability'|'compliance_privacy'|'reliability'|'operations'|'ux';
export type PilotStage4=0|1|2|3|4;
export type PilotStopCode4='complaint_threshold'|'hard_bounce_threshold'|'feedback_unhealthy'|'duplicate_send_suspected'|'unsubscribe_failure'|'domain_regression'|'unknown_outcome_backlog'|'queue_database_backlog'|'content_or_audience_mismatch'|'unexplained_send_decision';
export interface SecurityFinding4{id:string;workspaceId?:string;title:string;severity:SecuritySeverity4;status:'open'|'closed'|'accepted';owner?:string;reviewAt?:Date;createdAt:Date;closedAt?:Date|null}
export interface LaunchEvidence4{id:string;area:EvidenceArea4;status:'pending'|'passed'|'blocked';summary:string;approver?:string;recordedAt:Date}
export interface PilotStopSignal4{id:string;code:PilotStopCode4;detail:string;active:boolean;observedAt:Date;clearedAt?:Date|null}
export interface PilotState4{stage:PilotStage4;state:'locked'|'ready'|'running'|'held'|'completed';startedAt?:Date|null;completedAt?:Date|null;holdReason?:string|null}
export interface ReleaseState4{status:'locked'|'approved';approvedAt?:Date|null;approvedBy?:string|null;notes?:string|null}

export const launchAreas4:EvidenceArea4[]=['product','data_integrity','security','deliverability','compliance_privacy','reliability','operations','ux'];
export function blockingSecurityFinding4(f:SecurityFinding4){return f.status==='open'&&(f.severity==='S0'||f.severity==='S1')}

// Hardening/pilot entry intentionally does not require final launch-review sign-off.
export function canEnterPilot4(input:{phase2ExternalPassed:boolean;phase3RealPassed:boolean;hardeningPassed:boolean;findings:SecurityFinding4[];signals:PilotStopSignal4[]}){
  const reasons:string[]=[];
  if(!input.phase2ExternalPassed)reasons.push('PHASE2_EXTERNAL_GATE');
  if(!input.phase3RealPassed)reasons.push('PHASE3_REAL_GATE');
  if(!input.hardeningPassed)reasons.push('PHASE4_HARDENING_GATE');
  if(input.findings.some(blockingSecurityFinding4))reasons.push('SEVERE_SECURITY_FINDING');
  if(input.signals.some(x=>x.active))reasons.push('ACTIVE_PILOT_STOP_SIGNAL');
  return {allowed:reasons.length===0,reasons};
}

export function canApproveRelease4(input:{pilot:PilotState4;findings:SecurityFinding4[];evidence:LaunchEvidence4[];signals:PilotStopSignal4[];hardeningPassed:boolean}){
  const reasons:string[]=[];
  if(!input.hardeningPassed)reasons.push('PHASE4_HARDENING_GATE');
  if(input.pilot.state!=='completed'||input.pilot.stage!==4)reasons.push('CONTROLLED_PILOT_INCOMPLETE');
  if(input.findings.some(blockingSecurityFinding4))reasons.push('SEVERE_SECURITY_FINDING');
  if(input.signals.some(x=>x.active))reasons.push('ACTIVE_PILOT_STOP_SIGNAL');
  for(const area of launchAreas4)if(!input.evidence.some(e=>e.area===area&&e.status==='passed'&&e.approver))reasons.push(`EVIDENCE_${area.toUpperCase()}`);
  return {allowed:reasons.length===0,reasons};
}

// Backward-compatible alias retained for existing callers/tests; this is the final release-review gate.
export function canStartPilot4(input:{phase2ExternalPassed:boolean;phase3RealPassed:boolean;findings:SecurityFinding4[];evidence:LaunchEvidence4[];signals:PilotStopSignal4[]}){
  const preliminary={phase2ExternalPassed:input.phase2ExternalPassed,phase3RealPassed:input.phase3RealPassed,hardeningPassed:true,findings:input.findings,signals:input.signals};
  const gate=canEnterPilot4(preliminary);
  if(!gate.allowed)return gate;
  return {allowed:true,reasons:[]};
}
export function nextPilotStage4(stage:PilotStage4):PilotStage4{if(stage>=4)return 4;return (stage+1) as PilotStage4}
