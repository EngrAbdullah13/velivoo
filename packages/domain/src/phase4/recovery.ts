export type RecoveryScenario4='backup_restore'|'redis_loss'|'worker_crash'|'scheduler_duplication'|'provider_throttle'|'feedback_delay'|'database_failover'|'object_store_failure'|'deletion_tombstone_replay';
export const requiredRecoveryScenarios4:RecoveryScenario4[]=['backup_restore','redis_loss','worker_crash','scheduler_duplication','provider_throttle','feedback_delay','database_failover','object_store_failure','deletion_tombstone_replay'];
export interface RecoveryExercise4{id:string;scenario:RecoveryScenario4;status:'planned'|'passed'|'failed';startedAt?:Date|null;finishedAt?:Date|null;rpoMinutes?:number|null;rtoMinutes?:number|null;evidence:Record<string,unknown>}
export function recoveryBlocksLaunch4(x:RecoveryExercise4){return x.status!=='passed'}
