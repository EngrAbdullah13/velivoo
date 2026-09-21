import { createHash } from 'node:crypto';
import { validateSegmentRule, type SegmentRule } from './segment-rules.js';
export type ListEnrollmentMode='future_only'|'existing_and_future';
export type FlowTrigger=
 |{type:'unconfigured'}|{type:'list_joined';listId:string;enrollmentMode?:ListEnrollmentMode}|{type:'segment_entered';segmentId:string}|{type:'profile_date';field:string;hour:number;minute:number;timezonePolicy:'profile_then_workspace'}|{type:'generic_event';eventName:string;schemaVersion:number}|{type:'manual_test'};
export type FlowNode3=
 |{id:string;type:'delay';durationSeconds:number}
 |{id:string;type:'wait_until';hour:number;minute:number;timezonePolicy:'profile_then_workspace'}
 |{id:string;type:'conditional';rule:SegmentRule}
 |{id:string;type:'email';emailVersionId:string;mode:'test'|'live'}
 |{id:string;type:'end'};
export interface FlowEdge3 { from:'trigger'|string;to:string;outcome?:'yes'|'no' }
export interface FlowGraph3 { schemaVersion:1;trigger:FlowTrigger;nodes:FlowNode3[];edges:FlowEdge3[];entryPolicy:{mode:'once'|'once_per_event'|'cooldown';cooldownSeconds?:number};entryFilters:SegmentRule[];exitRules:SegmentRule[];layout?:Record<string,{x:number;y:number}> }

/** Default entry gate: subscribed marketing email, valid identifier, no active suppression. */
export const DEFAULT_MARKETING_ENTRY_FILTER: SegmentRule = { type: 'eligibility', operator: 'is', value: 'eligible' };

export function flowEmailNodeMode(node: Extract<FlowNode3, { type: 'email' }>, flowStatus?: string | null, trigger?: FlowTrigger) {
  if (node.mode === 'test' || node.mode === 'live') return node.mode;
  if (flowStatus === 'testing' || trigger?.type === 'manual_test') return 'test';
  return 'live';
}

export function flowHasMarketingEmailNodes(g: FlowGraph3): boolean {
  return (g.nodes ?? []).some(n => n.type === 'email' && flowEmailNodeMode(n, null, g.trigger) === 'live');
}

/** Older published list flows replayed the active membership at activation. Preserve that behavior unless a newer version explicitly opts into future-only entry. */
export function listTriggerIncludesExisting(trigger: FlowTrigger): boolean {
  return trigger.type === 'list_joined' && (trigger.enrollmentMode ?? 'existing_and_future') === 'existing_and_future';
}

/** Persist the marketing eligibility gate when a flow sends live email but has no entry filters. */
export function normalizeFlowGraph3(g: FlowGraph3): FlowGraph3 {
  if (!g.entryFilters?.length && flowHasMarketingEmailNodes(g)) {
    return { ...g, entryFilters: [structuredClone(DEFAULT_MARKETING_ENTRY_FILTER)] };
  }
  return g;
}
export interface FlowIssue3 { code:string;severity:'blocking'|'warning';path:string;nodeId?:string;field?:string;message:string;suggestedAction?:string }
function issue(code:string,path:string,message:string,nodeId?:string,field?:string):FlowIssue3{return {code,severity:'blocking',path,nodeId,field,message}}
function ruleIssues(kind:'ENTRY_FILTER'|'EXIT_RULE'|'CONDITIONAL_RULE',rule:SegmentRule,path:string,nodeId?:string):FlowIssue3[]{return validateSegmentRule(rule).map(x=>issue(`${kind}_${x.code}`,`${path}${x.path==='$'?'':x.path.slice(1)}`,x.message,nodeId,'rule'))}
export function validateFlow3(g:FlowGraph3):FlowIssue3[]{
 const issues:FlowIssue3[]=[];
 if(!g||g.schemaVersion!==1){issues.push(issue('GRAPH_SCHEMA_INVALID','$','This Flow uses an unsupported graph schema.'));return issues}
 if(!g.trigger||g.trigger.type==='unconfigured'||!['list_joined','segment_entered','profile_date','generic_event','manual_test'].includes(g.trigger.type))issues.push(issue('TRIGGER_REQUIRED','trigger','Select a trigger before publishing this Flow.'));
 else if(g.trigger.type==='list_joined'&&!g.trigger.listId)issues.push(issue('TRIGGER_REFERENCE_REQUIRED','trigger','Select the List that starts this Flow.'));
 else if(g.trigger.type==='list_joined'&&g.trigger.enrollmentMode!==undefined&&!['future_only','existing_and_future'].includes(g.trigger.enrollmentMode))issues.push(issue('LIST_ENROLLMENT_MODE_INVALID','trigger.enrollmentMode','Choose whether existing List members should enter when this Flow is activated.'));
 else if(g.trigger.type==='segment_entered'&&!g.trigger.segmentId)issues.push(issue('TRIGGER_REFERENCE_REQUIRED','trigger','Select the Segment that starts this Flow.'));
 else if(g.trigger.type==='generic_event'&&(!g.trigger.eventName?.trim()||!Number.isInteger(g.trigger.schemaVersion)||g.trigger.schemaVersion<1))issues.push(issue('EVENT_TRIGGER_INVALID','trigger','Select a valid event schema.'));
 else if(g.trigger.type==='profile_date'&&(!g.trigger.field?.trim()||!Number.isInteger(g.trigger.hour)||g.trigger.hour<0||g.trigger.hour>23||!Number.isInteger(g.trigger.minute)||g.trigger.minute<0||g.trigger.minute>59||g.trigger.timezonePolicy!=='profile_then_workspace'))issues.push(issue('DATE_TRIGGER_INVALID','trigger','Select a typed date field, delivery time, and timezone policy.'));
 if(!Array.isArray(g.nodes)||g.nodes.length<1||g.nodes.length>100)issues.push(issue('NODE_LIMIT','nodes','Flow must contain 1-100 nodes.'));
 const ids=new Set<string>();for(const n of g.nodes??[]){if(!n?.id?.trim())issues.push(issue('NODE_ID_REQUIRED','nodes','Every node needs an ID.'));else if(ids.has(n.id))issues.push(issue('DUPLICATE_NODE',`nodes.${n.id}`,'Node IDs must be unique.',n.id));ids.add(n.id);if(n.type==='delay'&&(!Number.isInteger(n.durationSeconds)||n.durationSeconds<0||n.durationSeconds>31536000))issues.push(issue('DELAY_INVALID',`nodes.${n.id}`,'Delay is out of bounds.',n.id,'durationSeconds'));if(n.type==='wait_until'&&(n.hour<0||n.hour>23||n.minute<0||n.minute>59||n.timezonePolicy!=='profile_then_workspace'))issues.push(issue('WAIT_TIME_INVALID',`nodes.${n.id}`,'Wait-until configuration is invalid.',n.id));if(n.type==='conditional')issues.push(...ruleIssues('CONDITIONAL_RULE',n.rule,`nodes.${n.id}.rule`,n.id));if(n.type==='email'&&(!n.emailVersionId||(n.mode&&!['test','live'].includes(n.mode))))issues.push(issue('EMAIL_VERSION_REQUIRED',`nodes.${n.id}`,'Email nodes require a published version and mode.',n.id,'emailVersionId'));if(!['delay','wait_until','conditional','email','end'].includes((n as any).type))issues.push(issue('NODE_TYPE_UNSUPPORTED',`nodes.${n.id}`,'This node type is not supported in Release 1.',n.id))}
 const out=new Map<string,FlowEdge3[]>();for(const e of g.edges??[]){if(e.from!=='trigger'&&!ids.has(e.from))issues.push(issue('DANGLING_EDGE','edges',`Unknown source ${e.from}.`));if(!ids.has(e.to))issues.push(issue('DANGLING_EDGE','edges',`Unknown target ${e.to}.`));out.set(e.from,[...(out.get(e.from)??[]),e])}
 if((out.get('trigger')??[]).length!==1)issues.push(issue('TRIGGER_OUTGOING','edges','Trigger must have exactly one outgoing edge.'));for(const n of g.nodes??[]){const es=out.get(n.id)??[];if(n.type==='end'&&es.length)issues.push(issue('END_OUTGOING',`nodes.${n.id}`,'End node cannot have outgoing edges.',n.id));else if(n.type==='conditional'){const labels=new Set(es.map(e=>e.outcome));if(es.length!==2||!labels.has('yes')||!labels.has('no'))issues.push(issue('CONDITIONAL_BRANCHES',`nodes.${n.id}`,'Conditional node requires exactly Yes and No branches.',n.id));else if(es[0]?.to===es[1]?.to)issues.push(issue('CONDITIONAL_BRANCH_TARGETS',`nodes.${n.id}`,'Yes and No must start on distinct branch nodes.',n.id))}else if(n.type!=='end'&&es.length!==1)issues.push(issue('OUTGOING_COUNT',`nodes.${n.id}`,'Node requires exactly one outgoing edge.',n.id))}
 const adj=(id:string)=>(out.get(id)??[]).map(e=>e.to),seen=new Set<string>(),active=new Set<string>();const visit=(id:string)=>{if(active.has(id)){issues.push(issue('CYCLE',`nodes.${id}`,'Cycles are not supported in Release 1.',id));return}if(seen.has(id))return;seen.add(id);active.add(id);for(const n of adj(id))visit(n);active.delete(id)};visit('trigger');for(const id of ids)if(!seen.has(id))issues.push(issue('UNREACHABLE',`nodes.${id}`,'Node is unreachable from trigger.',id));if(![...ids].some(id=>(g.nodes??[]).find(n=>n.id===id)?.type==='end'))issues.push(issue('TERMINAL_REQUIRED','nodes','Flow requires an End node.'));for(const rule of g.entryFilters??[])issues.push(...ruleIssues('ENTRY_FILTER',rule,'entryFilters'));for(const rule of g.exitRules??[])issues.push(...ruleIssues('EXIT_RULE',rule,'exitRules'));if(g.entryPolicy?.mode==='cooldown'&&(!g.entryPolicy.cooldownSeconds||g.entryPolicy.cooldownSeconds<60||g.entryPolicy.cooldownSeconds>31536000))issues.push(issue('COOLDOWN_INVALID','entryPolicy','Cooldown requires a duration between one minute and one year.'));if(!g.entryPolicy||!['once','once_per_event','cooldown'].includes(g.entryPolicy.mode))issues.push(issue('ENTRY_POLICY_INVALID','entryPolicy','Select a supported re-entry policy.'));return issues}
export function flowGraphHash(g:FlowGraph3){return createHash('sha256').update(JSON.stringify(g)).digest('hex')}
