import { createHash,randomUUID } from 'node:crypto';
import type { FlowRuleEvaluationPort,Phase2FlowMessagePort } from '../../application/src/ports/phase3-runtime-repository.js';

export class InMemoryFlowMessagePort implements Phase2FlowMessagePort{
  messages=new Map<string,{id:string;workspaceId:string;runId:string;nodeId:string;profileId:string;emailVersionId:string;mode:'test'|'live';cancelled:boolean}>();submissions=0;
  async createFlowMessage(i:{workspaceId:string;flowRunId:string;nodeId:string;profileId:string;emailVersionId:string;sequence:number;mode:'test'|'live'}){const key=createHash('sha256').update([i.workspaceId,i.mode,i.flowRunId,i.nodeId,i.profileId,i.emailVersionId,String(i.sequence)].join('|')).digest('hex'),old=this.messages.get(key);if(old)return {messageId:old.id,duplicate:true};const x={id:randomUUID(),workspaceId:i.workspaceId,runId:i.flowRunId,nodeId:i.nodeId,profileId:i.profileId,emailVersionId:i.emailVersionId,mode:i.mode,cancelled:false};this.messages.set(key,x);return {messageId:x.id,duplicate:false}}
  async cancelPendingForRuns(i:{workspaceId:string;runIds:string[]}){const ids=new Set(i.runIds);let n=0;for(const [k,m] of this.messages){if(m.workspaceId===i.workspaceId&&ids.has(m.runId)&&!m.cancelled){this.messages.set(k,{...m,cancelled:true});n++}}return n}
}

export class StaticRuleEvaluationPort implements FlowRuleEvaluationPort{
  constructor(private readonly value=true,private readonly byType:Record<string,boolean>={}){}
  async evaluate(i:{workspaceId:string;profileId:string;flowRunId?:string;rule:any;at:Date}){const type=String(i.rule?.type??'unknown'),result=this.byType[type]??(type==='eligibility'?true:this.value);return {result,evidence:{ruleType:type,evaluatedAt:i.at.toISOString(),profileId:i.profileId,flowRunId:i.flowRunId??null}}}
}
