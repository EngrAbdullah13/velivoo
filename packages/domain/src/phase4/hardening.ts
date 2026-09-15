export type HardeningStatus4='pending'|'passed'|'failed'|'waived';
export type HardeningCheckKey4=
  |'security.threat_model'
  |'security.tenant_isolation'
  |'security.dependency_scan'
  |'security.container_scan'
  |'security.secret_scan'
  |'security.static_analysis'
  |'security.iac_scan'
  |'security.penetration_test'
  |'security.secret_rotation'
  |'security.least_privilege'
  |'resilience.backpressure_fairness'
  |'privacy.deletion_all_stores'
  |'privacy.artifact_expiry'
  |'privacy.audit_access_review'
  |'privacy.support_access_expiry'
  |'operations.dashboards'
  |'operations.alerts'
  |'operations.runbooks'
  |'operations.on_call'
  |'operations.kill_switch_drill'
  |'operations.hold_drill'
  |'operations.safe_replay_drill'
  |'operations.reconciliation_drill'
  |'operations.slo_baseline'
  |'migration.rehearsal';

export interface HardeningEvidence4{
  id:string;
  checkKey:HardeningCheckKey4;
  status:HardeningStatus4;
  summary:string;
  owner?:string;
  evidence:Record<string,unknown>;
  recordedAt:Date;
  reviewAt?:Date|null;
}

export const requiredHardeningChecks4:HardeningCheckKey4[]=[
  'security.threat_model','security.tenant_isolation','security.dependency_scan','security.container_scan','security.secret_scan','security.static_analysis','security.iac_scan','security.penetration_test','security.secret_rotation','security.least_privilege',
  'resilience.backpressure_fairness',
  'privacy.deletion_all_stores','privacy.artifact_expiry','privacy.audit_access_review','privacy.support_access_expiry',
  'operations.dashboards','operations.alerts','operations.runbooks','operations.on_call','operations.kill_switch_drill','operations.hold_drill','operations.safe_replay_drill','operations.reconciliation_drill','operations.slo_baseline',
  'migration.rehearsal'
];

export function validateHardeningEvidence4(e:HardeningEvidence4){
  if(!e.summary.trim())throw new Error('HARDENING_SUMMARY_REQUIRED');
  if((e.status==='passed'||e.status==='waived')&&!e.owner?.trim())throw new Error('HARDENING_OWNER_REQUIRED');
  if(e.status==='waived'&&!e.reviewAt)throw new Error('HARDENING_WAIVER_REVIEW_REQUIRED');
  return e;
}

export function hardeningEvidenceGate4(items:HardeningEvidence4[]){
  const current=new Map<HardeningCheckKey4,HardeningEvidence4>();
  for(const item of [...items].sort((a,b)=>a.recordedAt.getTime()-b.recordedAt.getTime()))current.set(item.checkKey,item);
  const missing=requiredHardeningChecks4.filter(k=>{const x=current.get(k);return !x||!['passed','waived'].includes(x.status)});
  return {passed:missing.length===0,missing,current};
}
