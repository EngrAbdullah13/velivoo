export type RuleValueType='text'|'number'|'boolean'|'datetime';
export type ProfileOperator='eq'|'neq'|'contains'|'does_not_contain'|'starts_with'|'ends_with'|'exists'|'not_exists'|'gt'|'gte'|'lt'|'lte'|'between'|'before'|'after'|'within_last';
export type CountOperator='at_least'|'at_most'|'exactly';
export type EventPropertyFilter={key:string;valueType:RuleValueType;operator:ProfileOperator;value?:string|number|boolean;valueTo?:string|number;withinDays?:number};
export type SegmentRule=
 |{type:'group';operator:'and'|'or';children:SegmentRule[]}
 |{type:'profile';field:'email'|'first_name'|'last_name'|'locale'|'timezone'|'country_code'|'region'|'city'|'source'|'first_seen_at'|'created_at'|'updated_at'|'last_seen_at'|`property:${string}`;valueType?:RuleValueType;operator:ProfileOperator;value?:string|number|boolean;valueTo?:string|number;withinDays?:number}
 |{type:'list';listId:string;operator:'is_member'|'is_not_member'}
 |{type:'segment';segmentId:string;operator:'is_member'|'is_not_member'}
 |{type:'consent';channel:'email';purpose:'marketing';operator:'is';value:'granted'|'withdrawn'|'unknown'}
 |{type:'eligibility';operator:'is';value:'eligible'|'not_eligible'}
 |{type:'suppression';operator:'is_suppressed'|'is_not_suppressed';reason?:'complaint'|'global_unsubscribe'|'hard_bounce'|'category_unsubscribe'|'manual'|'administrative'|'legal'}
 |{type:'email_activity';event:'sent'|'delivered'|'bounced'|'complained'|'clicked'|'opened'|'unsubscribed';emailVersionId?:string;operator:CountOperator;count:number;withinDays:number}
 |{type:'event';name:string;schemaVersion?:number;operator:CountOperator;count:number;withinDays:number;property?:EventPropertyFilter};

export interface SegmentRuleLimits {maxDepth:number;maxLeaves:number;maxLookbackDays:number}
export const DEFAULT_SEGMENT_LIMITS:SegmentRuleLimits={maxDepth:4,maxLeaves:20,maxLookbackDays:365};
export interface SegmentRuleIssue {code:string;path:string;message:string}
export interface SegmentCompiledPlan {sql:string;params:unknown[];complexity:number}
const nativeFields=new Set(['email','first_name','last_name','locale','timezone','country_code','region','city','source','first_seen_at','created_at','updated_at','last_seen_at']);
const propertyKey=/^[a-z][a-z0-9_]{0,99}$/;
const uuid=/^[0-9a-f-]{8,}$/i;
const suppressionReasons=new Set(['complaint','global_unsubscribe','hard_bounce','category_unsubscribe','manual','administrative','legal']);
const valueOperators=new Set<ProfileOperator>(['eq','neq','contains','does_not_contain','starts_with','ends_with','exists','not_exists','gt','gte','lt','lte','between','before','after','within_last']);
const countOperators=new Set<CountOperator>(['at_least','at_most','exactly']);
const dateFields=new Set(['first_seen_at','created_at','updated_at','last_seen_at']);
const comparison=(operator:CountOperator)=>operator==='at_least'?'>=':operator==='at_most'?'<=':'=';

function profileIssue(r:{field:string;operator:ProfileOperator;value?:unknown;valueTo?:unknown;withinDays?:number;valueType?:RuleValueType},path:string,issues:SegmentRuleIssue[],limits:SegmentRuleLimits){
 if(!nativeFields.has(r.field)&&!(r.field.startsWith('property:')&&propertyKey.test(r.field.slice(9))))issues.push({code:'PROFILE_FIELD_UNSUPPORTED',path,message:'Profile field is not allowlisted.'});
 if(!valueOperators.has(r.operator))issues.push({code:'PROFILE_OPERATOR_UNSUPPORTED',path,message:'Profile operator is not supported.'});
 if(r.operator!=='exists'&&r.operator!=='not_exists'&&r.operator!=='within_last'&&(r.value===undefined||String(r.value).length>255))issues.push({code:'PROFILE_VALUE_INVALID',path,message:'Profile comparison requires a bounded value.'});
 if(r.operator==='between'&&(r.valueTo===undefined||String(r.valueTo).length>255))issues.push({code:'PROFILE_RANGE_INVALID',path,message:'Between requires two bounded values.'});
 if(r.operator==='within_last'&&(!Number.isInteger(r.withinDays)||r.withinDays!<1||r.withinDays!>limits.maxLookbackDays))issues.push({code:'LOOKBACK_INVALID',path,message:`Lookback must be 1-${limits.maxLookbackDays} days.`});
}

export function validateSegmentRule(rule:SegmentRule,limits=DEFAULT_SEGMENT_LIMITS):SegmentRuleIssue[]{
 const issues:SegmentRuleIssue[]=[];let leaves=0;const visit=(r:SegmentRule,depth:number,path:string)=>{
  if(depth>limits.maxDepth)issues.push({code:'RULE_TOO_DEEP',path,message:`Maximum depth is ${limits.maxDepth}.`});
  if(r.type==='group'){if(r.children.length<1||r.children.length>10)issues.push({code:'GROUP_CHILD_COUNT',path,message:'A group must contain 1-10 rules.'});r.children.forEach((c,i)=>visit(c,depth+1,`${path}.children[${i}]`));return}
  leaves++;
  if(r.type==='profile')profileIssue(r,path,issues,limits);
  if((r.type==='list'||r.type==='segment')&&!uuid.test(r.type==='list'?r.listId:r.segmentId))issues.push({code:r.type==='list'?'LIST_ID_INVALID':'SEGMENT_ID_INVALID',path,message:`${r.type==='list'?'List':'Segment'} ID is invalid.`});
  if(r.type==='suppression'&&r.reason&&!suppressionReasons.has(r.reason))issues.push({code:'SUPPRESSION_REASON_INVALID',path,message:'Suppression reason is unsupported.'});
  if((r.type==='email_activity'||r.type==='event')&&(!countOperators.has(r.operator)||!Number.isInteger(r.count)||r.count<0||r.count>1000))issues.push({code:'COUNT_INVALID',path,message:'Count must be 0-1000 with a supported comparison.'});
  if((r.type==='email_activity'||r.type==='event')&&(!Number.isInteger(r.withinDays)||r.withinDays<1||r.withinDays>limits.maxLookbackDays))issues.push({code:'LOOKBACK_INVALID',path,message:`Lookback must be 1-${limits.maxLookbackDays} days.`});
  if(r.type==='email_activity'&&r.emailVersionId&&!uuid.test(r.emailVersionId))issues.push({code:'EMAIL_VERSION_ID_INVALID',path,message:'Email version ID is invalid.'});
  if(r.type==='email_activity'&&r.event==='unsubscribed'&&r.emailVersionId)issues.push({code:'UNSUBSCRIBE_VERSION_UNSUPPORTED',path,message:'Unsubscribe evidence cannot be reliably scoped to one Email version.'});
  if(r.type==='event'){if(!/^[a-z0-9._-]{1,120}$/i.test(r.name))issues.push({code:'EVENT_NAME_INVALID',path,message:'Event name contains unsupported characters.'});if(r.schemaVersion!==undefined&&(!Number.isInteger(r.schemaVersion)||r.schemaVersion<1))issues.push({code:'EVENT_SCHEMA_VERSION_INVALID',path,message:'Event schema version is invalid.'});if(r.property){if(!r.schemaVersion)issues.push({code:'EVENT_PROPERTY_SCHEMA_REQUIRED',path,message:'Event-property conditions require a selected schema version.'});if(!propertyKey.test(r.property.key))issues.push({code:'EVENT_PROPERTY_INVALID',path,message:'Event property is invalid.'});profileIssue({field:`property:${r.property.key}`,...r.property},path,issues,limits)}}
 };visit(rule,0,'$');if(leaves>limits.maxLeaves)issues.push({code:'RULE_TOO_COMPLEX',path:'$',message:`Maximum leaf rules is ${limits.maxLeaves}.`});return issues;
}

export function collectRuleLeaves(rule:SegmentRule):SegmentRule[]{return rule.type==='group'?rule.children.flatMap(collectRuleLeaves):[rule]}

/** One allowlisted, parameterized compiler for Segments, Flow filters, exits and splits. */
export function compileSegmentRule(rule:SegmentRule,options:{at?:Date}={}):SegmentCompiledPlan{
 const issues=validateSegmentRule(rule);if(issues.length)throw new Error(`SEGMENT_RULE_INVALID:${issues.map(x=>x.code).join(',')}`);
 const params:unknown[]=[];let complexity=0;const p=(v:unknown)=>{params.push(v);return `$${params.length}`};const now=()=>options.at?p(options.at):'NOW()';const since=(days:number)=>`(${now()}::timestamptz - (${p(days)}::int * INTERVAL '1 day'))`;
 const activeSuppression=(reason?:string)=>`EXISTS (SELECT 1 FROM suppression sp WHERE sp.workspace_id=p.workspace_id AND sp.profile_id=p.id AND sp.channel='email' AND sp.revoked_at IS NULL AND (sp.expires_at IS NULL OR sp.expires_at>${now()})${reason?` AND sp.reason=${p(reason)}`:''})`;
 const typedComparison=(column:string,r:{operator:ProfileOperator;value?:unknown;valueTo?:unknown;withinDays?:number})=>{
  const value=r.value===undefined?undefined:p(r.value),to=r.valueTo===undefined?undefined:p(r.valueTo);
  if(r.operator==='exists')return `${column} IS NOT NULL`;
  if(r.operator==='not_exists')return `${column} IS NULL`;
  if(r.operator==='contains')return `${column}::text ILIKE '%' || ${value}::text || '%'`;
  if(r.operator==='does_not_contain')return `(${column} IS NULL OR ${column}::text NOT ILIKE '%' || ${value}::text || '%')`;
  if(r.operator==='starts_with')return `${column}::text ILIKE ${value}::text || '%'`;
  if(r.operator==='ends_with')return `${column}::text ILIKE '%' || ${value}::text`;
  if(r.operator==='between')return `${column} BETWEEN ${value} AND ${to}`;
  if(r.operator==='within_last')return `${column} >= ${since(r.withinDays!)}`;
  if(r.operator==='before')return `${column} < ${value}::timestamptz`;
  if(r.operator==='after')return `${column} > ${value}::timestamptz`;
  const operator={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[r.operator];
  if(!operator)throw new Error(`PROFILE_OPERATOR_UNSUPPORTED:${r.operator}`);
  return `${column} ${operator} ${value}`;
 };
 const activityCount=(r:Extract<SegmentRule,{type:'email_activity'}>):string=>{const version=r.emailVersionId?` AND m.email_version_id=${p(r.emailVersionId)}::uuid`:'';const count=p(r.count),op=comparison(r.operator),start=since(r.withinDays);if(r.event==='sent')return `(SELECT COUNT(*) FROM message m WHERE m.workspace_id=p.workspace_id AND m.profile_id=p.id AND m.source_type<>'test' AND m.submitted_at>=${start}${version}) ${op} ${count}`;if(r.event==='clicked'||r.event==='opened')return `(SELECT COUNT(DISTINCT te.id) FROM trace_event te JOIN message m ON m.id=te.aggregate_id AND m.workspace_id=te.workspace_id WHERE te.workspace_id=p.workspace_id AND te.aggregate_type='message' AND m.profile_id=p.id AND te.kind=${p(`engagement.${r.event==='clicked'?'click':'open'}`)} AND te.occurred_at>=${start} AND COALESCE(te.detail_json->>'classification','human') NOT IN ('bot','scanner')${version}) ${op} ${count}`;if(r.event==='unsubscribed')return `(SELECT COUNT(*) FROM consent_record cr WHERE cr.workspace_id=p.workspace_id AND cr.profile_id=p.id AND cr.channel='email' AND cr.purpose='marketing' AND cr.status='withdrawn' AND cr.occurred_at>=${start}) ${op} ${count}`;const events=r.event==='bounced'?['bounce','soft_bounce','hard_bounce']:[r.event];return `(SELECT COUNT(*) FROM delivery_event de JOIN message m ON m.id=de.message_id AND m.workspace_id=de.workspace_id WHERE de.workspace_id=p.workspace_id AND m.profile_id=p.id AND de.event_type IN (${events.map(p).join(',')}) AND de.occurred_at>=${start}${version}) ${op} ${count}`};
 const eventProperty=(filter:EventPropertyFilter)=>{const key=p(filter.key),col=filter.valueType==='number'?`(e.properties_json->>${key})::numeric`:filter.valueType==='boolean'?`(e.properties_json->>${key})::boolean`:filter.valueType==='datetime'?`(e.properties_json->>${key})::timestamptz`:`e.properties_json->>${key}`;return ` AND (${typedComparison(col,filter)})`};
 const c=(r:SegmentRule):string=>{
  complexity++;
  if(r.type==='group')return `(${r.children.map(c).join(r.operator==='and'?' AND ':' OR ')})`;
  if(r.type==='profile'){
   if(r.field.startsWith('property:')){
    const key=p(r.field.slice(9));
    const type=r.valueType??(typeof r.value==='number'?'number':typeof r.value==='boolean'?'boolean':'text');
    const column=type==='number'?'ppv.number_value':type==='boolean'?'ppv.boolean_value':type==='datetime'?'ppv.datetime_value':'ppv.text_value';
    const base=`SELECT 1 FROM profile_property_value ppv JOIN profile_property_definition ppd ON ppd.id=ppv.definition_id WHERE ppv.workspace_id=p.workspace_id AND ppv.profile_id=p.id AND ppd.workspace_id=p.workspace_id AND ppd.key=${key}`;
    if(r.operator==='not_exists')return `NOT EXISTS (${base} AND ${column} IS NOT NULL)`;
    return `EXISTS (${base} AND ${typedComparison(column,r)})`;
   }
   const column=({email:'p.normalized_email',first_name:'p.first_name',last_name:'p.last_name',locale:'p.locale',timezone:'p.timezone',country_code:'p.country_code',region:'p.region',city:'p.city',source:'p.source',first_seen_at:'p.first_seen_at',created_at:'p.created_at',updated_at:'p.updated_at',last_seen_at:'p.last_seen_at'} as Record<string,string>)[r.field]!;
   return typedComparison(column,r);
  }
  if(r.type==='list')return `${r.operator==='is_not_member'?'NOT ':''}EXISTS (SELECT 1 FROM list_membership lm JOIN audience_list al ON al.id=lm.list_id WHERE lm.workspace_id=p.workspace_id AND lm.profile_id=p.id AND lm.list_id=${p(r.listId)}::uuid AND lm.state='active' AND al.status='active')`;
  if(r.type==='segment')return `${r.operator==='is_not_member'?'NOT ':''}EXISTS (SELECT 1 FROM segment_membership_projection sm JOIN segment s ON s.id=sm.segment_id WHERE sm.workspace_id=p.workspace_id AND sm.profile_id=p.id AND sm.segment_id=${p(r.segmentId)}::uuid AND sm.is_member=true AND sm.evaluated_at>=${now()}::timestamptz - INTERVAL '15 minutes' AND s.status='active')`;
  if(r.type==='consent')return `COALESCE((SELECT ss.current_status FROM subscription_state ss WHERE ss.workspace_id=p.workspace_id AND ss.profile_id=p.id AND ss.channel=${p(r.channel)} AND ss.purpose=${p(r.purpose)}),'unknown')=${p(r.value)}`;
  if(r.type==='eligibility'){
   const eligible=`p.normalized_email IS NOT NULL AND EXISTS (SELECT 1 FROM subscription_state ss WHERE ss.workspace_id=p.workspace_id AND ss.profile_id=p.id AND ss.channel='email' AND ss.purpose='marketing' AND ss.current_status='granted') AND NOT ${activeSuppression()}`;
   return r.value==='eligible'?`(${eligible})`:`NOT (${eligible})`;
  }
  if(r.type==='suppression'){
   const clause=activeSuppression(r.reason);
   return r.operator==='is_suppressed'?clause:`NOT ${clause}`;
  }
  if(r.type==='email_activity')return activityCount(r);
  const schema=r.schemaVersion===undefined?'':` AND e.schema_version=${p(r.schemaVersion)}`;
  const property=r.property?eventProperty(r.property):'';
  return `(SELECT COUNT(*) FROM event e WHERE e.workspace_id=p.workspace_id AND e.profile_id=p.id AND e.event_name=${p(r.name)} AND e.occurred_at>=${since(r.withinDays)}${schema}${property}) ${comparison(r.operator)} ${p(r.count)}`;
 };
 return {sql:c(rule),params,complexity};
}
