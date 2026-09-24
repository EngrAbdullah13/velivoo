import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlow3, type FlowGraph3 } from '../packages/domain/src/phase3/flow.js';
import { localCalendarDateInstant,nextLocalWallClockInstant } from '../packages/domain/src/phase3/runtime-time.js';
import { Phase3RuntimeService } from '../packages/application/src/phase3/phase3-runtime-service.js';
import { InMemoryPhase3RuntimeRepository } from '../packages/persistence/src/proof/in-memory-phase3-runtime-repository.js';
import { InMemoryFlowMessagePort,StaticRuleEvaluationPort } from '../packages/testkit/src/phase3-runtime-fakes.js';
import { compileSegmentRule,validateSegmentRule,type SegmentRule } from '../packages/domain/src/phase3/segment-rules.js';

const W='11111111-1111-1111-1111-111111111111',F='22222222-2222-2222-2222-222222222222',V='33333333-3333-3333-3333-333333333333',P='44444444-4444-4444-4444-444444444444';
const baseGraph:FlowGraph3={schemaVersion:1,trigger:{type:'generic_event',eventName:'custom.test',schemaVersion:1},nodes:[
{id:'delay',type:'delay',durationSeconds:10},{id:'cond',type:'conditional',rule:{type:'profile',field:'first_name',operator:'exists'}},{id:'email',type:'email',emailVersionId:'email-v1',mode:'live'},{id:'noend',type:'end'},{id:'end',type:'end'}],edges:[{from:'trigger',to:'delay'},{from:'delay',to:'cond'},{from:'cond',to:'email',outcome:'yes'},{from:'cond',to:'noend',outcome:'no'},{from:'email',to:'end'}],entryPolicy:{mode:'once_per_event'},entryFilters:[],exitRules:[]};
function setup(graph=baseGraph,rules=new StaticRuleEvaluationPort(true)){const repo=new InMemoryPhase3RuntimeRepository(),messages=new InMemoryFlowMessagePort();repo.seedFlow({id:F,workspaceId:W,status:'active',activeVersionId:V,entryState:'open',executionState:'running',pausedAt:null},{id:V,workspaceId:W,flowId:F,versionNumber:1,graph,graphHash:'h1'});repo.seedProfile({id:P,workspaceId:W,timezone:'UTC',workspaceTimezone:'UTC'});return {repo,messages,service:new Phase3RuntimeService(repo,messages,rules)}}
async function executeAll(s:Phase3RuntimeService,start:Date,max=10){let now=start;for(let i=0;i<max;i++){const actions=await s.dispatchDue({now,leaseOwner:'test'});if(!actions.length){now=new Date(now.getTime()+11000);continue}for(const a of actions)await s.executeAction(a,now);const report=await s.report(W,F);if(report.completed||report.exited||report.cancelled)return report;now=new Date(now.getTime()+11000)}throw new Error('FLOW_DID_NOT_FINISH')}

test('Phase3 exact-once flow entry deduplicates the same event',async()=>{const {repo,service}=setup(),now=new Date('2026-08-19T10:00:00Z');const a=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-1',triggerKey:'evt-1',now}),b=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-1',triggerKey:'evt-1',now});assert.equal(a.entered,true);assert.equal(b.entered,false);assert.equal(b.reason,'DUPLICATE');assert.equal((await repo.listRuns(W,F)).length,1)});

test('Phase3 once_per_event allows the same membership id after a new join time',async()=>{const {repo,service}=setup(),first=new Date('2026-08-19T10:00:00Z'),second=new Date('2026-08-19T11:00:00Z');const a=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'membership-1',triggerKey:'audience:list:membership-1',now:first}),b=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'membership-1',triggerKey:'audience:list:membership-1',now:second});assert.equal(a.entered,true);assert.equal(b.entered,true);assert.equal((await repo.listRuns(W,F)).length,2)});

test('Phase3 testing activation accepts entries but can create only test messages',async()=>{const graph=structuredClone(baseGraph);(graph.nodes.find(node=>node.type==='email') as any).mode='test';const {repo,messages,service}=setup(graph),now=new Date('2026-08-19T10:00:00Z');repo.flows.set(F,{...repo.flows.get(F)!,status:'testing'});const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'test-entry',triggerKey:'test-entry',now});assert.equal(entered.entered,true);await executeAll(service,now);const message=[...messages.messages.values()][0];assert(message);assert.equal(message.mode,'test');});

test('Phase3 leased due action is recoverable after worker/Redis-style loss',async()=>{const {service}=setup(),now=new Date('2026-08-19T10:00:00Z');await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-1',triggerKey:'evt-1',now});const first=await service.dispatchDue({now,leaseOwner:'dead-worker',leaseMs:1000});assert.equal(first.length,1);const recovered=await service.dispatchDue({now:new Date(now.getTime()+2000),leaseOwner:'recovery',leaseMs:1000});assert.equal(recovered.length,1);assert.equal(recovered[0]!.id,first[0]!.id);assert.equal(recovered[0]!.attemptCount,2)});

test('Phase3 run stays pinned to entry Flow and Email versions after active version changes',async()=>{const {repo,messages,service}=setup(),now=new Date('2026-08-19T10:00:00Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-pin',triggerKey:'evt-pin',now});const v2=structuredClone(baseGraph);(v2.nodes.find(n=>n.type==='email') as any).emailVersionId='email-v2';repo.versions.set('v2',{id:'v2',workspaceId:W,flowId:F,versionNumber:2,graph:v2,graphHash:'h2'});repo.flows.set(F,{...repo.flows.get(F)!,activeVersionId:'v2'});await executeAll(service,now);assert.equal(entered.run!.flowVersionId,V);const only=[...messages.messages.values()][0];assert(only);assert.equal(only.emailVersionId,'email-v1');const trace=await service.runTrace(W,entered.run!.id);assert(trace.events.some(e=>e.kind==='node.completed'&&e.detail.nodeType==='email'))});

test('Phase3 duplicate node execution creates no more than one business message',async()=>{const {repo,messages,service}=setup(),now=new Date('2026-08-19T10:00:00Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-dup-node',triggerKey:'evt-dup-node',now});let actions=await service.dispatchDue({now,leaseOwner:'w'});await service.executeAction(actions[0]!,now);actions=await service.dispatchDue({now:new Date(now.getTime()+11000),leaseOwner:'w'});await service.executeAction(actions[0]!,new Date(now.getTime()+11000));actions=await service.dispatchDue({now:new Date(now.getTime()+11000),leaseOwner:'w2'});assert.equal(actions.length,1);const cond=actions[0]!;await service.executeAction(cond,new Date(now.getTime()+11000));actions=await service.dispatchDue({now:new Date(now.getTime()+11000),leaseOwner:'w3'});const email=actions[0]!;await service.executeAction(email,new Date(now.getTime()+11000));await service.executeAction(email,new Date(now.getTime()+11000));assert.equal(messages.messages.size,1);const trace=await service.runTrace(W,entered.run!.id);assert.equal(trace.events.filter(e=>e.kind==='node.completed'&&e.detail.nodeType==='email').length,1)});

test('Phase3 branches and exits are deterministic and explainable',async()=>{const rules=new StaticRuleEvaluationPort(false,{profile:false}),{messages,service}=setup(baseGraph,rules),now=new Date('2026-08-19T10:00:00Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-no',triggerKey:'evt-no',now});await executeAll(service,now);assert.equal(messages.messages.size,0);const trace=await service.runTrace(W,entered.run!.id);const conditional=trace.events.find(e=>e.kind==='node.completed'&&e.detail.nodeType==='conditional');assert.equal((conditional?.detail.evaluation as any).result,false);assert.equal(trace.run.state,'completed')});

test('Phase3 exit rule exits active run before an action and records evidence',async()=>{const graph=structuredClone(baseGraph);graph.exitRules=[{type:'event',name:'custom.cancel',operator:'at_least',count:1,withinDays:30}];const rules=new StaticRuleEvaluationPort(false,{event:true}),{service}=setup(graph,rules),now=new Date('2026-08-19T10:00:00Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-exit',triggerKey:'evt-exit',now});const action=(await service.dispatchDue({now,leaseOwner:'w'}))[0]!;assert.equal((await service.executeAction(action,now)).status,'exited');const trace=await service.runTrace(W,entered.run!.id);assert.equal(trace.run.state,'exited');assert(trace.events.some(e=>e.kind==='flow.exited'))});

test('Phase3 pause future actions holds exact actions and resume has explicit overdue policy',async()=>{const {repo,service}=setup(),now=new Date('2026-08-19T10:00:00Z');await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-pause',triggerKey:'evt-pause',now});const pause=await service.pause({workspaceId:W,flowId:F,mode:'pause_future_actions',now:new Date(now.getTime()+1000)});assert.equal(pause.heldActions,1);await assert.rejects(()=>service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-2',triggerKey:'evt-2',now:new Date(now.getTime()+2000)}),/FLOW_NOT_ACTIVE|FLOW_ENTRIES_BLOCKED/);const resumed=await service.resume({workspaceId:W,flowId:F,overduePolicy:'immediate',now:new Date(now.getTime()+60000)});assert.equal(resumed.resumedActions,1);const due=await service.dispatchDue({now:new Date(now.getTime()+60000),leaseOwner:'w'});assert.equal(due.length,1);assert.equal(repo.flows.get(F)!.entryState,'open')});

test('Phase3 cancel pending runs reports exact counts and cancels pending flow messages',async()=>{const graph:FlowGraph3={schemaVersion:1,trigger:{type:'manual_test'},nodes:[{id:'email',type:'email',emailVersionId:'e',mode:'live'},{id:'delay',type:'delay',durationSeconds:3600},{id:'end',type:'end'}],edges:[{from:'trigger',to:'email'},{from:'email',to:'delay'},{from:'delay',to:'end'}],entryPolicy:{mode:'once'},entryFilters:[],exitRules:[]};const {messages,service}=setup(graph),now=new Date('2026-08-19T10:00:00Z');await service.enter({workspaceId:W,flowId:F,profileId:P,triggerKey:'manual',now});const email=(await service.dispatchDue({now,leaseOwner:'w'}))[0]!;await service.executeAction(email,now);assert.equal(messages.messages.size,1);const result=await service.pause({workspaceId:W,flowId:F,mode:'cancel_pending_runs',now:new Date(now.getTime()+1000)});assert.equal(result.cancelledRuns,1);assert.equal(result.cancelledActions,1);assert.equal(result.cancelledMessages,1);const report=await service.report(W,F);assert.equal(report.cancelled,1)});

test('Phase3 run trace alone explains entry, branch/message progression and completion',async()=>{const {service}=setup(),now=new Date('2026-08-19T10:00:00Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerEventId:'evt-trace',triggerKey:'evt-trace',now});await executeAll(service,now);const trace=await service.runTrace(W,entered.run!.id);assert.equal(trace.run.state,'completed');assert(trace.events.some(e=>e.kind==='flow.entered'));assert(trace.events.some(e=>e.kind==='node.completed'&&e.detail.nodeType==='conditional'));assert(trace.events.some(e=>e.kind==='node.completed'&&e.detail.nodeType==='email'));assert(trace.events.some(e=>e.kind==='flow.completed'))});

test('Phase3 wait-until timezone calculation handles DST gaps deterministically',()=>{const after=new Date('2026-03-08T06:59:00Z');const next=nextLocalWallClockInstant({after,timeZone:'America/New_York',hour:2,minute:30});assert.equal(next.toISOString(),'2026-03-09T06:30:00.000Z')});

test('Phase3 profile-date trigger resolves its calendar date at the recipient local time',()=>{const due=localCalendarDateInstant({date:new Date('2026-11-01T00:00:00.000Z'),timeZone:'America/New_York',hour:9,minute:0});assert.equal(due.toISOString(),'2026-11-01T14:00:00.000Z')});

test('Phase3 dead-letter replay preserves business identity and retries failed node as a new execution attempt',async()=>{const graph:FlowGraph3={schemaVersion:1,trigger:{type:'manual_test'},nodes:[{id:'c',type:'conditional',rule:{type:'profile',field:'first_name',operator:'exists'}},{id:'yes',type:'end'},{id:'no',type:'end'}],edges:[{from:'trigger',to:'c'},{from:'c',to:'yes',outcome:'yes'},{from:'c',to:'no',outcome:'no'}],entryPolicy:{mode:'once'},entryFilters:[],exitRules:[]};let calls=0;const rules={async evaluate(i:any){calls++;if(calls===1)throw new Error('TRANSIENT_RULE_STORE');return {result:true,evidence:{calls}}}};const {repo,service}=setup(graph,rules as any),now=new Date('2026-08-19T10:00:00Z');await service.enter({workspaceId:W,flowId:F,profileId:P,triggerKey:'manual',now});const action=(await service.dispatchDue({now,leaseOwner:'w'}))[0]!;await assert.rejects(()=>service.executeAction(action,now),/TRANSIENT_RULE_STORE/);const letters=await service.deadLetters(W,F);assert.equal(letters.length,1);const replayed=await service.replay(W,letters[0]!.id,new Date(now.getTime()+1000));assert.equal(replayed.deduplicationKey,action.deduplicationKey);const again=(await service.dispatchDue({now:new Date(now.getTime()+1000),leaseOwner:'w2'}))[0]!;assert.equal(again.id,action.id);await service.executeAction(again,new Date(now.getTime()+1000));const executions=[...repo.executions.values()].filter(x=>x.nodeId==='c');assert.equal(executions.length,2);assert.equal(executions[0]!.state,'failed');assert.equal(executions[1]!.state,'completed')});

test('shared typed rule compiler covers version-pinned engagement, audience, events, counts and bounded groups',()=>{const rule:any={type:'group',operator:'and',children:[{type:'profile',field:'country_code',valueType:'text',operator:'eq',value:'GB'},{type:'list',listId:'11111111-1111-4111-8111-111111111111',operator:'is_member'},{type:'segment',segmentId:'22222222-2222-4222-8222-222222222222',operator:'is_member'},{type:'email_activity',event:'clicked',emailVersionId:'33333333-3333-4333-8333-333333333333',operator:'at_least',count:2,withinDays:3},{type:'event',name:'consultation_booked',schemaVersion:1,operator:'exactly',count:1,withinDays:14,property:{key:'location',valueType:'text',operator:'eq',value:'London'}}]};assert.deepEqual(validateSegmentRule(rule),[]);const plan=compileSegmentRule(rule,{at:new Date('2026-08-24T12:00:00.000Z')});assert.match(plan.sql,/list_membership/);assert.match(plan.sql,/segment_membership_projection/);assert.match(plan.sql,/email_version_id/);assert.match(plan.sql,/trace_event/);assert.match(plan.sql,/properties_json/);assert.equal(plan.complexity,6)});

test('profile rules expose complete native fields and safe text, range, and absence operators',()=>{const rule:any={type:'group',operator:'and',children:[{type:'profile',field:'last_name',operator:'does_not_contain',value:'test'},{type:'profile',field:'source',operator:'ends_with',value:'form'},{type:'profile',field:'updated_at',operator:'within_last',withinDays:30},{type:'profile',field:'property:company',operator:'not_exists',valueType:'text'}]};assert.deepEqual(validateSegmentRule(rule),[]);const plan=compileSegmentRule(rule,{at:new Date('2026-09-21T12:00:00.000Z')});assert.match(plan.sql,/p\.last_name/);assert.match(plan.sql,/p\.source/);assert.match(plan.sql,/p\.updated_at/);assert.match(plan.sql,/NOT EXISTS/);assert.ok(plan.params.includes('test'));assert.ok(plan.params.includes('form'))});

test('engagement rules support rolling hour, week, and month windows without interpolating user values',()=>{
 const cases: Array<{unit:'hours'|'weeks'|'months';interval:string}>=[
  {unit:'hours',interval:'1 hour'},
  {unit:'weeks',interval:'1 week'},
  {unit:'months',interval:'1 month'},
 ];
 for(const item of cases){
  const rule:SegmentRule={type:'email_activity',event:'opened',operator:'at_least',count:1,window:{mode:'within',amount:2,unit:item.unit}};
  assert.deepEqual(validateSegmentRule(rule),[]);
  const plan=compileSegmentRule(rule,{at:new Date('2026-09-21T12:00:00.000Z')});
  assert.match(plan.sql,new RegExp(`INTERVAL '${item.interval}'`));
  assert.ok(plan.params.includes(2));
 }
});

test('behavior rules support all-time and custom date ranges with validated parameterized bounds',()=>{
 const allTime:SegmentRule={type:'event',name:'checkout.started',schemaVersion:1,operator:'at_least',count:1,window:{mode:'all_time'}};
 assert.deepEqual(validateSegmentRule(allTime),[]);
 const allTimePlan=compileSegmentRule(allTime,{at:new Date('2026-09-21T12:00:00.000Z')});
 assert.doesNotMatch(allTimePlan.sql,/INTERVAL|occurred_at>=/);

 const between:SegmentRule={type:'email_activity',event:'clicked',operator:'exactly',count:2,window:{mode:'between',from:'2026-09-01T00:00:00.000Z',to:'2026-09-15T00:00:00.000Z'}};
 assert.deepEqual(validateSegmentRule(between),[]);
 const betweenPlan=compileSegmentRule(between);
 assert.match(betweenPlan.sql,/te\.occurred_at>=\$\d+::timestamptz/);
 assert.match(betweenPlan.sql,/te\.occurred_at<=\$\d+::timestamptz/);
 assert.ok(betweenPlan.params.some(value=>value instanceof Date&&value.toISOString()==='2026-09-01T00:00:00.000Z'));
 assert.ok(betweenPlan.params.some(value=>value instanceof Date&&value.toISOString()==='2026-09-15T00:00:00.000Z'));

 const invalid:SegmentRule={...between,window:{mode:'between',from:'2026-09-15T00:00:00.000Z',to:'2026-09-01T00:00:00.000Z'}};
 assert.equal(validateSegmentRule(invalid)[0]?.code,'DATE_RANGE_INVALID');
});

test('flow engagement SQL is isolated to one profile, one current run, and human activity',()=>{
 const flowRunId='55555555-5555-4555-8555-555555555555';
 const rule:SegmentRule={type:'email_activity',event:'opened',emailVersionId:'33333333-3333-4333-8333-333333333333',operator:'at_least',count:1,withinDays:30};
 const plan=compileSegmentRule(rule,{at:new Date('2026-09-22T12:00:00.000Z'),flowRunId});
 assert.match(plan.sql,/m\.profile_id=p\.id/);
 assert.match(plan.sql,/m\.flow_run_id=\$\d+::uuid/);
 assert.match(plan.sql,/isBotEvent/);
 assert.match(plan.sql,/openIsBotEvent/);
 assert.ok(plan.params.includes(flowRunId));
});

test('runtime evaluates the same engagement split separately for each recipient and run',async()=>{
 const secondProfile='66666666-6666-4666-8666-666666666666';
 const graph:FlowGraph3={schemaVersion:1,trigger:{type:'manual_test'},nodes:[
  {id:'wait',type:'delay',durationSeconds:60},
  {id:'split',type:'conditional',rule:{type:'email_activity',event:'opened',operator:'at_least',count:1,withinDays:30}},
  {id:'yes',type:'end'},{id:'no',type:'end'}
 ],edges:[{from:'trigger',to:'wait'},{from:'wait',to:'split'},{from:'split',to:'yes',outcome:'yes'},{from:'split',to:'no',outcome:'no'}],entryPolicy:{mode:'once'},entryFilters:[],exitRules:[]};
 const evaluations:Array<{profileId:string;flowRunId?:string}>=[];
 const rules={async evaluate(input:{profileId:string;flowRunId?:string}){evaluations.push({profileId:input.profileId,flowRunId:input.flowRunId});return {result:input.profileId===P,evidence:{profileId:input.profileId,flowRunId:input.flowRunId}}}};
 const {repo,service}=setup(graph,rules as any);
 repo.seedProfile({id:secondProfile,workspaceId:W,timezone:'UTC',workspaceTimezone:'UTC'});
 const now=new Date('2026-09-22T12:00:00.000Z');
 const first=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerKey:'first',now});
 const second=await service.enter({workspaceId:W,flowId:F,profileId:secondProfile,triggerKey:'second',now});
 for(const action of await service.dispatchDue({now,leaseOwner:'recipient-scope'}))await service.executeAction(action,now);
 const afterWait=new Date(now.getTime()+60000);
 for(const action of await service.dispatchDue({now:afterWait,leaseOwner:'recipient-scope'}))await service.executeAction(action,afterWait);
 assert.deepEqual(new Set(evaluations.map(item=>item.profileId)),new Set([P,secondProfile]));
 assert.equal(new Set(evaluations.map(item=>item.flowRunId)).size,2);
 assert.ok(evaluations.every(item=>Boolean(item.flowRunId)));
 assert.notEqual(first.run!.id,second.run!.id);
});

test('flow validation requires a wait before open or click splits',()=>{
 const graph:FlowGraph3={schemaVersion:1,trigger:{type:'manual_test'},nodes:[
  {id:'email',type:'email',emailVersionId:'email-v1',mode:'live'},
  {id:'split',type:'conditional',rule:{type:'email_activity',event:'opened',operator:'at_most',count:0,withinDays:30}},
  {id:'yes',type:'end'},{id:'no',type:'end'}
 ],edges:[{from:'trigger',to:'email'},{from:'email',to:'split'},{from:'split',to:'yes',outcome:'yes'},{from:'split',to:'no',outcome:'no'}],entryPolicy:{mode:'once'},entryFilters:[],exitRules:[]};
 assert.ok(validateFlow3(graph).some(issue=>issue.code==='ENGAGEMENT_WAIT_REQUIRED'));
 graph.nodes.splice(1,0,{id:'wait',type:'delay',durationSeconds:3600});
 graph.edges=graph.edges.map(edge=>edge.from==='email'&&edge.to==='split'?{from:'email',to:'wait'}:edge);
 graph.edges.push({from:'wait',to:'split'});
 assert.ok(!validateFlow3(graph).some(issue=>issue.code==='ENGAGEMENT_WAIT_REQUIRED'));
});

test('conditional split evaluates the immutable Flow Version rule once, records evidence, and follows only the selected branch',async()=>{const graph:FlowGraph3={schemaVersion:1,trigger:{type:'manual_test'},nodes:[{id:'split',type:'conditional',rule:{type:'group',operator:'and',children:[{type:'eligibility',operator:'is',value:'eligible'},{type:'profile',field:'country_code',valueType:'text',operator:'eq',value:'GB'}]}},{id:'yes',type:'end'},{id:'no',type:'end'}],edges:[{from:'trigger',to:'split'},{from:'split',to:'yes',outcome:'yes'},{from:'split',to:'no',outcome:'no'}],entryPolicy:{mode:'once'},entryFilters:[],exitRules:[]};const rules={async evaluate(input:any){return {result:false,evidence:{ruleHash:'published-rule-hash',evaluatedAt:input.at.toISOString(),type:'group',operator:'and',children:[{result:true},{result:false}]}}}}, {service}=setup(graph,rules as any),now=new Date('2026-08-24T12:00:00.000Z');const entered=await service.enter({workspaceId:W,flowId:F,profileId:P,triggerKey:'conditional',now});const action=(await service.dispatchDue({now,leaseOwner:'conditional-worker'}))[0]!;await service.executeAction(action,now);const trace=await service.runTrace(W,entered.run!.id),decision=trace.events.find(event=>event.kind==='node.completed'&&event.detail.nodeId==='split');assert.equal((decision?.detail.evaluation as any).result,false);assert.equal((decision?.detail.nextNodeId as string),'no');assert.equal((decision?.detail.evaluation as any).evidence.children[1].result,false)});
