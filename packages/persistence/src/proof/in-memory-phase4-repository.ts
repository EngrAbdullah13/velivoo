import type {Phase4Repository} from '../../../application/src/ports/phase4-repository.js';
import type {CapacityEvidence4} from '../../../domain/src/phase4/capacity.js';
import type {HardeningEvidence4} from '../../../domain/src/phase4/hardening.js';
import type {LaunchEvidence4,PilotState4,PilotStopSignal4,ReleaseState4,SecurityFinding4} from '../../../domain/src/phase4/launch.js';
import type {MigrationRehearsal4} from '../../../domain/src/phase4/migration.js';
import type {SloObservation4} from '../../../domain/src/phase4/operations.js';
import type {PilotObservation4} from '../../../domain/src/phase4/pilot.js';
import type {DeletionState4,PrivacyDeletionJob4} from '../../../domain/src/phase4/privacy.js';
import type {RecoveryExercise4} from '../../../domain/src/phase4/recovery.js';
export class InMemoryPhase4Repository implements Phase4Repository{
 findings=new Map<string,SecurityFinding4>();hardening=new Map<string,HardeningEvidence4>();evidence=new Map<string,LaunchEvidence4>();signals=new Map<string,PilotStopSignal4>();capacity=new Map<string,CapacityEvidence4>();recovery=new Map<string,RecoveryExercise4>();slo=new Map<string,SloObservation4>();migration=new Map<string,MigrationRehearsal4>();observations=new Map<string,PilotObservation4>();deletions=new Map<string,PrivacyDeletionJob4>();holds=new Set<string>();cancelled=0;
 pilotState:PilotState4={stage:0,state:'locked'};release:ReleaseState4={status:'locked'};constructor(public p2=false,public p3=false){}
 securityFindings=async()=>[...this.findings.values()];saveSecurityFinding=async(x:SecurityFinding4)=>{this.findings.set(x.id,x)};
 hardeningEvidence=async()=>[...this.hardening.values()];saveHardeningEvidence=async(x:HardeningEvidence4)=>{for(const [id,e] of this.hardening)if(e.checkKey===x.checkKey)this.hardening.delete(id);this.hardening.set(x.id,x)};
 launchEvidence=async()=>[...this.evidence.values()];saveLaunchEvidence=async(x:LaunchEvidence4)=>{for(const [id,e] of this.evidence)if(e.area===x.area)this.evidence.delete(id);this.evidence.set(x.id,x)};
 stopSignals=async()=>[...this.signals.values()];saveStopSignal=async(x:PilotStopSignal4)=>{this.signals.set(x.id,x)};
 pilot=async()=>this.pilotState;savePilot=async(x:PilotState4)=>{this.pilotState=x};
 pilotObservations=async()=>[...this.observations.values()];savePilotObservation=async(x:PilotObservation4)=>{for(const [id,o] of this.observations)if(o.stage===x.stage)this.observations.delete(id);this.observations.set(x.id,x)};
 releaseState=async()=>this.release;saveReleaseState=async(x:ReleaseState4)=>{this.release=x};
 capacityEvidence=async()=>[...this.capacity.values()];saveCapacityEvidence=async(x:CapacityEvidence4)=>{this.capacity.set(x.id,x)};
 recoveryExercises=async()=>[...this.recovery.values()];saveRecoveryExercise=async(x:RecoveryExercise4)=>{this.recovery.set(x.id,x)};
 sloObservations=async()=>[...this.slo.values()];saveSloObservation=async(x:SloObservation4)=>{this.slo.set(x.id,x)};
 migrationRehearsals=async()=>[...this.migration.values()];saveMigrationRehearsal=async(x:MigrationRehearsal4)=>{this.migration.set(x.id,x)};
 deletionJob=async(w:string,p:string)=>this.deletions.get(`${w}:${p}`)??null;saveDeletionJob=async(x:PrivacyDeletionJob4)=>{this.deletions.set(`${x.workspaceId}:${x.profileId}`,x)};
 placeProfileDeletionHold=async(w:string,p:string)=>{this.holds.add(`${w}:${p}`)};cancelPendingMarketing=async()=>++this.cancelled;
 performDeletionStep=async(job:PrivacyDeletionJob4,to:DeletionState4)=>{const x={...job,state:to,updatedAt:new Date()};this.deletions.set(`${job.workspaceId}:${job.profileId}`,x);return x};
 phase2ExternalPassed=async()=>this.p2;phase3RealPassed=async()=>this.p3;
}
