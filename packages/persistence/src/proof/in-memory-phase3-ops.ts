import { createHash,randomUUID } from 'node:crypto';
import type { Phase3ProjectionRepository,SegmentProjectionRefresh3 } from '../../../application/src/ports/phase3-projection-repository.js';
import type { ApiCredential3,Phase3ApiKeyRepository } from '../../../application/src/ports/phase3-api-key-repository.js';
import type { SegmentRule } from '../../../domain/src/phase3/segment-rules.js';
import type { InMemoryPhase3Repository } from './in-memory-phase3-repository.js';

export class InMemoryPhase3ProjectionRepository implements Phase3ProjectionRepository{
  projections=new Map<string,Set<string>>();transitions=new Set<string>();
  constructor(private readonly base:InMemoryPhase3Repository){}
  async latestSegmentVersion(w:string,s:string){const v=(this.base.versions.get(s)??[]).filter(x=>x.workspaceId===w).at(-1);return v?{id:v.id,workspaceId:w,segmentId:s,rule:v.rule,versionNumber:v.versionNumber}:null}
  private eval(r:SegmentRule,p:any):boolean{if(r.type==='group')return r.operator==='and'?r.children.every(c=>this.eval(c,p)):r.children.some(c=>this.eval(c,p));if(r.type==='profile'){const v=r.field==='country_code'?p.country:r.field==='first_name'?p.firstName:r.field==='timezone'?p.timezone:undefined;return r.operator==='exists'?v!=null:r.operator==='eq'?v===r.value:v!==r.value}if(r.type==='consent')return r.value==='granted'?Boolean(p.eligible):!p.eligible;return false}
  async matchingProfileIds(w:string,r:SegmentRule){return this.base.profileUniverse.filter(p=>p.workspaceId===w&&this.eval(r,p)).map(p=>p.id)}
  async refreshSegmentProjection(i:{workspaceId:string;segmentId:string;segmentVersionId:string;memberProfileIds:string[];evaluatedAt:Date}):Promise<SegmentProjectionRefresh3>{const key=`${i.workspaceId}|${i.segmentVersionId}`,old=this.projections.get(key)??new Set<string>(),next=new Set(i.memberProfileIds),entered=[...next].filter(x=>!old.has(x)),left=[...old].filter(x=>!next.has(x)),transitionKeys:string[]=[];for(const [kind,ids] of [['entered',entered],['left',left]] as const)for(const id of ids){const t=createHash('sha256').update(`${i.segmentVersionId}|${id}|${kind}`).digest('hex');if(!this.transitions.has(t)){this.transitions.add(t);transitionKeys.push(t)}}this.projections.set(key,next);return {segmentId:i.segmentId,segmentVersionId:i.segmentVersionId,members:next.size,entered:entered.length,left:left.length,evaluatedAt:i.evaluatedAt,transitionKeys}}
}

export class InMemoryPhase3ApiKeyRepository implements Phase3ApiKeyRepository{
  items=new Map<string,ApiCredential3>();
  async createCredential(i:{workspaceId:string;name:string;prefix:string;secretHash:string;scopes:string[];expiresAt?:Date}){const x:ApiCredential3={id:randomUUID(),workspaceId:i.workspaceId,name:i.name,prefix:i.prefix,secretHash:i.secretHash,scopes:i.scopes,createdAt:new Date(),expiresAt:i.expiresAt};this.items.set(x.id,x);return structuredClone(x)}
  async credentialByPrefix(p:string){return structuredClone([...this.items.values()].find(x=>x.prefix===p)??null)}
  async revokeCredential(w:string,id:string,at:Date){const x=this.items.get(id);if(!x||x.workspaceId!==w)throw new Error('API_KEY_NOT_FOUND');this.items.set(id,{...x,revokedAt:at})}
  async touchCredential(w:string,id:string,at:Date){const x=this.items.get(id);if(!x||x.workspaceId!==w)throw new Error('API_KEY_NOT_FOUND');this.items.set(id,{...x,lastUsedAt:at})}
  async listCredentials(w:string){return [...this.items.values()].filter(x=>x.workspaceId===w).map(x=>structuredClone(x))}
}
