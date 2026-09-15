import type {CapacityEvidence4} from '../../../domain/src/phase4/capacity.js';
import type {HardeningEvidence4} from '../../../domain/src/phase4/hardening.js';
import type {LaunchEvidence4,PilotState4,PilotStopSignal4,ReleaseState4,SecurityFinding4} from '../../../domain/src/phase4/launch.js';
import type {MigrationRehearsal4} from '../../../domain/src/phase4/migration.js';
import type {PilotObservation4} from '../../../domain/src/phase4/pilot.js';
import type {PrivacyDeletionJob4,DeletionState4} from '../../../domain/src/phase4/privacy.js';
import type {RecoveryExercise4} from '../../../domain/src/phase4/recovery.js';
import type {SloObservation4} from '../../../domain/src/phase4/operations.js';
export interface Phase4Repository{
  securityFindings():Promise<SecurityFinding4[]>;saveSecurityFinding(x:SecurityFinding4):Promise<void>;
  hardeningEvidence():Promise<HardeningEvidence4[]>;saveHardeningEvidence(x:HardeningEvidence4):Promise<void>;
  launchEvidence():Promise<LaunchEvidence4[]>;saveLaunchEvidence(x:LaunchEvidence4):Promise<void>;
  stopSignals():Promise<PilotStopSignal4[]>;saveStopSignal(x:PilotStopSignal4):Promise<void>;
  pilot():Promise<PilotState4>;savePilot(x:PilotState4):Promise<void>;
  pilotObservations():Promise<PilotObservation4[]>;savePilotObservation(x:PilotObservation4):Promise<void>;
  releaseState():Promise<ReleaseState4>;saveReleaseState(x:ReleaseState4):Promise<void>;
  capacityEvidence():Promise<CapacityEvidence4[]>;saveCapacityEvidence(x:CapacityEvidence4):Promise<void>;
  recoveryExercises():Promise<RecoveryExercise4[]>;saveRecoveryExercise(x:RecoveryExercise4):Promise<void>;
  sloObservations():Promise<SloObservation4[]>;saveSloObservation(x:SloObservation4):Promise<void>;
  migrationRehearsals():Promise<MigrationRehearsal4[]>;saveMigrationRehearsal(x:MigrationRehearsal4):Promise<void>;
  deletionJob(workspaceId:string,profileId:string):Promise<PrivacyDeletionJob4|null>;saveDeletionJob(x:PrivacyDeletionJob4):Promise<void>;
  placeProfileDeletionHold(workspaceId:string,profileId:string):Promise<void>;cancelPendingMarketing(workspaceId:string,profileId:string):Promise<number>;
  performDeletionStep(job:PrivacyDeletionJob4,to:DeletionState4):Promise<PrivacyDeletionJob4>;
  phase2ExternalPassed():Promise<boolean>;phase3RealPassed():Promise<boolean>;
}
