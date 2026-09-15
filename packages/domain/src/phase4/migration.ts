export interface MigrationRehearsal4{
  id:string;
  sourceLabel:string;
  sourceRows:number;
  acceptedRows:number;
  rejectedRows:number;
  duplicateRows:number;
  invalidRows:number;
  missingConsentRows:number;
  suppressedRows:number;
  acceptedProfiles:number;
  listMemberships:number;
  consentGranted:number;
  exclusions:number;
  reconciled:boolean;
  sourceOfTruthPlan:string;
  evidence:Record<string,unknown>;
  startedAt:Date;
  finishedAt:Date;
  owner:string;
}
export function validateMigrationRehearsal4(x:MigrationRehearsal4){
  const nums=[x.sourceRows,x.acceptedRows,x.rejectedRows,x.duplicateRows,x.invalidRows,x.missingConsentRows,x.suppressedRows,x.acceptedProfiles,x.listMemberships,x.consentGranted,x.exclusions];
  if(nums.some(n=>!Number.isInteger(n)||n<0))throw new Error('MIGRATION_COUNT_INVALID');
  if(x.acceptedRows+x.rejectedRows!==x.sourceRows)throw new Error('MIGRATION_ROW_RECONCILIATION_FAILED');
  if(x.finishedAt.getTime()<x.startedAt.getTime())throw new Error('MIGRATION_TIME_INVALID');
  if(!x.owner.trim())throw new Error('MIGRATION_OWNER_REQUIRED');
  if(!x.sourceOfTruthPlan.trim())throw new Error('MIGRATION_SOURCE_OF_TRUTH_PLAN_REQUIRED');
  if(!x.reconciled)throw new Error('MIGRATION_NOT_RECONCILED');
  return x;
}
