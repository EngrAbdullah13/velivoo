import { createHash } from 'node:crypto';
import type { FlowEdge3,FlowGraph3,FlowNode3 } from '../../../domain/src/phase3/flow.js';
import { flowEmailNodeMode } from '../../../domain/src/phase3/flow.js';
import { DEFAULT_MARKETING_ENTRY_FILTER, flowHasMarketingEmailNodes } from '../../../domain/src/phase3/flow.js';
import { nextLocalWallClockInstant } from '../../../domain/src/phase3/runtime-time.js';
import type { FlowRuleEvaluationPort,Phase2FlowMessagePort,Phase3RuntimeRepository,PauseResult3,RuntimeFlowRun3,RuntimeScheduledAction3 } from '../ports/phase3-runtime-repository.js';

function edgeMap(graph:FlowGraph3){const m=new Map<string,FlowEdge3[]>();for(const e of graph.edges)m.set(e.from,[...(m.get(e.from)??[]),e]);return m}
function nodeMap(graph:FlowGraph3){return new Map(graph.nodes.map(n=>[n.id,n] as const))}
function firstNode(graph:FlowGraph3){const edge=(edgeMap(graph).get('trigger')??[])[0];if(!edge)throw new Error('FLOW_TRIGGER_EDGE_MISSING');return edge.to}
function stable(...parts:Array<string|number|undefined|null>){return createHash('sha256').update(parts.map(x=>String(x??'')).join('|')).digest('hex')}

export class Phase3RuntimeService{
  constructor(private readonly repo:Phase3RuntimeRepository,private readonly messages:Phase2FlowMessagePort,private readonly rules:FlowRuleEvaluationPort){}

  private async versionForActiveFlow(workspaceId:string,flowId:string){
    const flow=await this.repo.flow(workspaceId,flowId);if(!flow)throw new Error('FLOW_NOT_FOUND');
    // A testing activation is a real, durable Flow activation.  It must be
    // allowed to create analytics-excluded test Message intents; the Email
    // node mode check in executeAction below prevents a testing Flow from
    // ever creating a live message.
    if(flow.status!=='active'&&flow.status!=='testing')throw new Error('FLOW_NOT_ACTIVE');if(flow.entryState!=='open')throw new Error('FLOW_ENTRIES_BLOCKED');
    if(!flow.activeVersionId)throw new Error('FLOW_ACTIVE_VERSION_MISSING');const version=await this.repo.flowVersion(workspaceId,flow.activeVersionId);if(!version)throw new Error('FLOW_VERSION_NOT_FOUND');return {flow,version};
  }

  async enter(input:{workspaceId:string;flowId:string;profileId:string;triggerEventId?:string;triggerKey:string;now?:Date}){
    const now=input.now??new Date(),{version}=await this.versionForActiveFlow(input.workspaceId,input.flowId),graph=version.graph;
    const entryFilters=graph.entryFilters?.length?graph.entryFilters:flowHasMarketingEmailNodes(graph)?[DEFAULT_MARKETING_ENTRY_FILTER]:[];
    for(const rule of entryFilters){const evaluation=await this.rules.evaluate({workspaceId:input.workspaceId,profileId:input.profileId,rule,at:now});if(!evaluation.result)return {entered:false,reason:'ENTRY_FILTER',evaluation};}
    let dedupe='';
    if(graph.entryPolicy.mode==='once')dedupe=stable(input.flowId,input.profileId,'once');
    else if(graph.entryPolicy.mode==='once_per_event')dedupe=stable(input.flowId,input.profileId,input.triggerEventId??input.triggerKey);
    else{
      const latest=await this.repo.latestRunForProfile(input.workspaceId,input.flowId,input.profileId),cooldown=(graph.entryPolicy.cooldownSeconds??0)*1000;
      if(latest&&now.getTime()-latest.enteredAt.getTime()<cooldown)return {entered:false,reason:'COOLDOWN',run:latest};
      dedupe=stable(input.flowId,input.profileId,input.triggerEventId??input.triggerKey,now.toISOString());
    }
    const first=firstNode(graph);
    return this.repo.transaction(async tx=>{
      const created=await tx.createRunIfAbsent({workspaceId:input.workspaceId,flowId:input.flowId,flowVersionId:version.id,profileId:input.profileId,triggerEventId:input.triggerEventId,deduplicationKey:dedupe,firstNodeId:first,enteredAt:now});
      if(created.duplicate)return {entered:false,reason:'DUPLICATE',run:created.run};
      await tx.scheduleAction({workspaceId:input.workspaceId,flowRunId:created.run.id,nodeId:first,deduplicationKey:stable(created.run.id,first),dueAt:now});
      await tx.addTrace(input.workspaceId,created.run.id,'flow.entered',{flowVersionId:version.id,deduplicationKey:dedupe,triggerEventId:input.triggerEventId??null},now);
      return {entered:true,run:created.run};
    });
  }

  private async successor(graph:FlowGraph3,node:FlowNode3,result?:boolean){const edges=edgeMap(graph).get(node.id)??[];if(node.type==='conditional')return edges.find(e=>e.outcome===(result?'yes':'no'))?.to;return edges[0]?.to}

  async executeAction(action:RuntimeScheduledAction3,now=new Date()){
    const run=await this.repo.run(action.workspaceId,action.flowRunId);if(!run||['completed','exited','cancelled'].includes(run.state)){await this.repo.completeAction(action.workspaceId,action.id);return {status:'noop'} as const;}
    const flow=await this.repo.flow(action.workspaceId,run.flowId);if(!flow)throw new Error('FLOW_NOT_FOUND');
    if(flow.executionState==='paused'){return {status:'held'} as const;}
    const version=await this.repo.flowVersion(action.workspaceId,run.flowVersionId);if(!version)throw new Error('FLOW_VERSION_NOT_FOUND');
    const graph=version.graph,node=nodeMap(graph).get(action.nodeId);if(!node)throw new Error('FLOW_NODE_NOT_FOUND');

    for(const rule of graph.exitRules){const ev=await this.rules.evaluate({workspaceId:action.workspaceId,profileId:run.profileId,rule,at:now});if(ev.result){
      const result=await this.repo.transaction(tx=>tx.exitRunAndCancelPending({workspaceId:run.workspaceId,runId:run.id,actionId:action.id,now,reason:'EXIT_RULE',detail:{reason:'EXIT_RULE',evidence:ev.evidence}}));return {status:'exited',...result} as const;
    }}

    const begun=await this.repo.beginNodeExecution({workspaceId:run.workspaceId,flowRunId:run.id,nodeId:node.id,scheduledAt:action.dueAt,inputSnapshot:{flowVersionId:version.id}});
    if(begun.duplicate){await this.repo.completeAction(run.workspaceId,action.id);return {status:'duplicate'} as const;}
    try{
      let evaluation:Record<string,unknown>={},nextAt=now,next:string|undefined;
      if(node.type==='delay'){nextAt=new Date(now.getTime()+node.durationSeconds*1000);evaluation={durationSeconds:node.durationSeconds};next=await this.successor(graph,node)}
      else if(node.type==='wait_until'){
        const p=await this.repo.profileContext(run.workspaceId,run.profileId);if(!p)throw new Error('PROFILE_NOT_FOUND');const timeZone=p.timezone||p.workspaceTimezone;
        nextAt=nextLocalWallClockInstant({after:now,timeZone,hour:node.hour,minute:node.minute});evaluation={timeZone,timeZoneSource:p.timezone?'profile':'workspace',calculatedUtc:nextAt.toISOString()};next=await this.successor(graph,node)
      }
      else if(node.type==='conditional'){const ev=await this.rules.evaluate({workspaceId:run.workspaceId,profileId:run.profileId,rule:node.rule,at:now});evaluation={result:ev.result,evidence:ev.evidence};next=await this.successor(graph,node,ev.result)}
      else if(node.type==='email'){
        const emailMode=flowEmailNodeMode(node,flow.status,graph.trigger);
        if((flow.status==='testing'&&emailMode!=='test')||(flow.status==='active'&&emailMode!=='live'))throw new Error('EMAIL_NODE_MODE_FLOW_STATE_MISMATCH');
        const created=await this.messages.createFlowMessage({workspaceId:run.workspaceId,flowRunId:run.id,nodeId:node.id,profileId:run.profileId,emailVersionId:node.emailVersionId,sequence:1,mode:emailMode});evaluation={messageId:created.messageId,duplicate:created.duplicate,mode:emailMode};next=await this.successor(graph,node)
      }
      else{
        await this.repo.transaction(async tx=>{await tx.completeNodeExecution({workspaceId:run.workspaceId,executionId:begun.execution.id,evaluationResult:{end:true}});await tx.completeAction(run.workspaceId,action.id);await tx.updateRun({workspaceId:run.workspaceId,runId:run.id,state:'completed',currentNodeId:node.id,nextActionAt:null,endedAt:now,exitReason:'END'});await tx.addTrace(run.workspaceId,run.id,'flow.completed',{nodeId:node.id},now)});return {status:'completed'} as const;
      }
      if(!next)throw new Error('FLOW_SUCCESSOR_MISSING');
      const scheduleKey=stable(run.id,next);
      await this.repo.transaction(async tx=>{
        await tx.completeNodeExecution({workspaceId:run.workspaceId,executionId:begun.execution.id,evaluationResult:evaluation});await tx.completeAction(run.workspaceId,action.id);
        await tx.scheduleAction({workspaceId:run.workspaceId,flowRunId:run.id,nodeId:next!,deduplicationKey:scheduleKey,dueAt:nextAt});
        await tx.updateRun({workspaceId:run.workspaceId,runId:run.id,state:nextAt>now?'waiting':'active',currentNodeId:next!,nextActionAt:nextAt});
        await tx.addTrace(run.workspaceId,run.id,'node.completed',{nodeId:node.id,nodeType:node.type,nextNodeId:next,nextActionAt:nextAt.toISOString(),evaluation},now);
      });
      return {status:'advanced',nextNodeId:next,nextAt} as const;
    }catch(error){const detail={message:error instanceof Error?error.message:String(error)};await this.repo.failNodeExecution({workspaceId:run.workspaceId,executionId:begun.execution.id,error:detail});await this.repo.addTrace(run.workspaceId,run.id,'node.failed',{nodeId:node.id,error:detail.message},now);await this.repo.recordDeadLetter({workspaceId:run.workspaceId,resourceType:'scheduled_action',resourceId:action.id,jobType:'phase3.flow.execute',businessKey:action.deduplicationKey,error:detail});throw error}
  }

  async dispatchDue(input:{now?:Date;leaseOwner:string;leaseMs?:number;limit?:number}){const now=input.now??new Date();await this.repo.releaseExpiredLeases(now);return this.repo.claimDueActions({now,leaseOwner:input.leaseOwner,leaseMs:input.leaseMs??30000,limit:input.limit??100})}

  async pause(input:{workspaceId:string;flowId:string;mode:'stop_new_entries'|'pause_future_actions'|'cancel_pending_runs';now?:Date}):Promise<PauseResult3>{
    const now=input.now??new Date();
    if(input.mode==='stop_new_entries'){await this.repo.setFlowExecutionState({workspaceId:input.workspaceId,flowId:input.flowId,entryState:'blocked',executionState:'running',status:'paused'});return {newEntriesBlocked:1,heldActions:0,cancelledRuns:0,cancelledActions:0,cancelledMessages:0}}
    if(input.mode==='pause_future_actions'){await this.repo.setFlowExecutionState({workspaceId:input.workspaceId,flowId:input.flowId,entryState:'blocked',executionState:'paused',pausedAt:now,status:'paused'});const held=await this.repo.holdPendingActions(input.workspaceId,input.flowId);return {newEntriesBlocked:1,heldActions:held,cancelledRuns:0,cancelledActions:0,cancelledMessages:0}}
    const cancelled=await this.repo.cancelPendingRunsAndActions(input.workspaceId,input.flowId,now),messages=await this.messages.cancelPendingForRuns({workspaceId:input.workspaceId,runIds:cancelled.runIds});
    await this.repo.setFlowExecutionState({workspaceId:input.workspaceId,flowId:input.flowId,entryState:'blocked',executionState:'paused',pausedAt:now,status:'paused'});
    return {newEntriesBlocked:1,heldActions:0,cancelledRuns:cancelled.runs,cancelledActions:cancelled.actions,cancelledMessages:messages};
  }

  async resume(input:{workspaceId:string;flowId:string;overduePolicy:'immediate'|'shift_by_pause_duration';now?:Date}){const now=input.now??new Date(),flow=await this.repo.flow(input.workspaceId,input.flowId);if(!flow)throw new Error('FLOW_NOT_FOUND');const resumed=await this.repo.resumeHeldActions({workspaceId:input.workspaceId,flowId:input.flowId,now,pausedAt:flow.pausedAt,overduePolicy:input.overduePolicy});await this.repo.setFlowExecutionState({workspaceId:input.workspaceId,flowId:input.flowId,entryState:'open',executionState:'running',pausedAt:null,status:'active'});return {resumedActions:resumed,overduePolicy:input.overduePolicy};}

  async runTrace(workspaceId:string,runId:string){const run=await this.repo.run(workspaceId,runId);if(!run)throw new Error('FLOW_RUN_NOT_FOUND');const events=await this.repo.trace(workspaceId,runId);return {run,events}}
  report(workspaceId:string,flowId:string){return this.repo.runCounts(workspaceId,flowId)}
  deadLetters(workspaceId:string,flowId?:string){return this.repo.listDeadLetters(workspaceId,flowId)}
  replay(workspaceId:string,id:string,at=new Date()){return this.repo.replayDeadLetter(workspaceId,id,at)}
}
