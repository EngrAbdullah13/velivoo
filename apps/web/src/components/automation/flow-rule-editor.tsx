'use client';
import { useMemo, useState } from 'react';
import type { Rule, RuleOptions, RuleValueType, ProfileOperator } from './flow-types';
import s from './flows.module.css';
export const eligibleRule: Rule = { type: 'eligibility', operator: 'is', value: 'eligible' };
type RulePreset = { id: string; label: string; description: string; rule: Rule };
type ActivityRule = Extract<Rule, { type: 'email_activity' | 'event' }>;
const rulePresets: { title: string; items: RulePreset[] }[] = [
  { title: 'Email engagement', items: [
    { id: 'sent', label: 'Was sent an email', description: 'At least once in the last 30 days', rule: { type: 'email_activity', event: 'sent', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'not-sent', label: 'Was not sent an email', description: 'No sends in the last 30 days', rule: { type: 'email_activity', event: 'sent', operator: 'at_most', count: 0, withinDays: 30 } },
    { id: 'opened', label: 'Opened an email', description: 'At least once in the last 30 days', rule: { type: 'email_activity', event: 'opened', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'not-opened', label: 'Did not open an email', description: 'No opens in the last 30 days', rule: { type: 'email_activity', event: 'opened', operator: 'at_most', count: 0, withinDays: 30 } },
    { id: 'clicked', label: 'Clicked an email', description: 'At least once in the last 30 days', rule: { type: 'email_activity', event: 'clicked', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'not-clicked', label: 'Did not click an email', description: 'No clicks in the last 30 days', rule: { type: 'email_activity', event: 'clicked', operator: 'at_most', count: 0, withinDays: 30 } },
    { id: 'delivered', label: 'Received an email', description: 'Delivered at least once', rule: { type: 'email_activity', event: 'delivered', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'not-delivered', label: 'Did not receive an email', description: 'No delivery in the last 30 days', rule: { type: 'email_activity', event: 'delivered', operator: 'at_most', count: 0, withinDays: 30 } },
    { id: 'bounced', label: 'Bounced from an email', description: 'Bounced at least once', rule: { type: 'email_activity', event: 'bounced', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'complained', label: 'Marked email as spam', description: 'Complaint received at least once', rule: { type: 'email_activity', event: 'complained', operator: 'at_least', count: 1, withinDays: 30 } },
  ] },
  { title: 'Audience and consent', items: [
    { id: 'eligible', label: 'Eligible for marketing', description: 'Subscribed and not suppressed', rule: structuredClone(eligibleRule) },
    { id: 'unsubscribed', label: 'Unsubscribed', description: 'Marketing consent is withdrawn', rule: { type: 'consent', channel: 'email', purpose: 'marketing', operator: 'is', value: 'withdrawn' } },
    { id: 'suppressed', label: 'Suppressed', description: 'Any active suppression', rule: { type: 'suppression', operator: 'is_suppressed' } },
    { id: 'in-list', label: 'In a list', description: 'Choose an active workspace list', rule: { type: 'list', listId: '', operator: 'is_member' } },
    { id: 'in-segment', label: 'In a segment', description: 'Choose an active workspace segment', rule: { type: 'segment', segmentId: '', operator: 'is_member' } },
  ] },
  { title: 'Customer data and behavior', items: [
    { id: 'profile', label: 'Profile property', description: 'Country, source, date, or a custom property', rule: { type: 'profile', field: 'email', operator: 'contains', value: '', valueType: 'text' } },
    { id: 'event', label: 'Customer event', description: 'Order, cart, page, or registered product event', rule: { type: 'event', name: '', operator: 'at_least', count: 1, withinDays: 30 } },
    { id: 'not-event', label: 'Did not perform an event', description: 'Zero matching events in the last 30 days', rule: { type: 'event', name: '', operator: 'at_most', count: 0, withinDays: 30 } },
  ] },
  { title: 'Advanced logic', items: [
    { id: 'group', label: 'Combine conditions', description: 'Match all or any of several conditions', rule: { type: 'group', operator: 'and', children: [structuredClone(eligibleRule)] } },
  ] },
];
const valueType = (type?: string): RuleValueType => type === 'number' || type === 'boolean' ? type : type === 'date' || type === 'datetime' ? 'datetime' : 'text';
function typedValue(text: string, type?: RuleValueType): string | number | boolean { return type === 'number' ? Number(text) : type === 'boolean' ? text === 'true' : text; }
const activityLabel = (event: string) => ({ sent: 'sent', delivered: 'received', opened: 'opened', clicked: 'clicked', bounced: 'bounced', complained: 'marked as spam', unsubscribed: 'unsubscribed' }[event] ?? event);
function activityTimingSentence(rule: ActivityRule): string {
  const frequency = rule.operator === 'at_least' ? `at least ${rule.count}` : rule.operator === 'at_most' ? `at most ${rule.count}` : `exactly ${rule.count}`;
  const window = rule.window?.mode === 'all_time'
    ? 'over all time'
    : rule.window?.mode === 'between'
      ? `between ${rule.window.from.slice(0, 10)} and ${rule.window.to.slice(0, 10)}`
      : rule.window?.mode === 'within'
        ? `in the last ${rule.window.amount} ${rule.window.unit}`
        : `in the last ${rule.withinDays ?? 30} days`;
  const simpleFrequency = (rule.operator === 'at_least' && rule.count === 1) || (rule.operator === 'at_most' && rule.count === 0);
  return simpleFrequency ? window : `${frequency} time${rule.count === 1 ? '' : 's'} ${window}`;
}
export function ruleSentence(rule: Rule, options: RuleOptions): string {
  if (rule.type === 'group') return `${rule.operator === 'and' ? 'All' : 'Any'} of ${rule.children.length} conditions match`;
  if (rule.type === 'eligibility') return rule.value === 'eligible' ? 'Eligible to receive marketing email' : 'Not eligible to receive marketing email';
  if (rule.type === 'consent') return `Email subscription is ${rule.value}`;
  if (rule.type === 'suppression') return `${rule.operator === 'is_suppressed' ? 'Is' : 'Is not'} suppressed${rule.reason ? ` for ${rule.reason.replaceAll('_', ' ')}` : ''}`;
  if (rule.type === 'list') return `${rule.operator === 'is_member' ? 'Is' : 'Is not'} in ${options.lists.find(item => item.id === rule.listId)?.name ?? 'a list'}`;
  if (rule.type === 'segment') return `${rule.operator === 'is_member' ? 'Is' : 'Is not'} in ${options.segments.find(item => item.id === rule.segmentId)?.name ?? 'a segment'}`;
  if (rule.type === 'profile') return `${options.nativeProfileFields.find(item => item.key === rule.field)?.label ?? options.profileProperties.find(item => `property:${item.key}` === rule.field)?.displayName ?? rule.field.replace('property:', '')} · ${rule.operator.replaceAll('_', ' ')}`;
  if (rule.type === 'email_activity') return `${rule.operator === 'at_most' && rule.count === 0 ? 'Has not' : 'Has'} ${activityLabel(rule.event)} ${rule.emailVersionId ? options.emails.find(item => item.id === rule.emailVersionId)?.name ?? 'the selected email' : 'any email'} · ${activityTimingSentence(rule)}`;
  return `${rule.operator === 'at_most' && rule.count === 0 ? 'Did not perform' : 'Performed'} ${rule.name || 'a customer event'} · ${activityTimingSentence(rule)}`;
}

export function FlowRules({ title, rules, options, onChange }: { title: string; rules: Rule[]; options: RuleOptions; onChange: (rules: Rule[]) => void }) {
  return <section className={s.ruleSection}><div className={s.sectionHeading}><h3>{title}</h3><span>{rules.length}</span></div><p className={s.hint}>{title.startsWith('Exit') ? 'A match to any exit rule ends a run before its next action.' : 'All of these rules must match to allow entry.'}</p>{rules.map((rule, index) => <div className={s.ruleCard} key={index}><RuleEditor rule={rule} options={options} onChange={value => onChange(rules.map((item, i) => i === index ? value : item))}/><button className={s.textDanger} onClick={() => onChange(rules.filter((_, i) => i !== index))}>Remove rule</button></div>)}<button className={s.secondary} onClick={() => onChange([...rules, structuredClone(eligibleRule)])}>+ Add rule</button></section>;
}

export function RuleEditor({ rule, options, onChange, depth = 1 }: { rule: Rule; options: RuleOptions; onChange: (rule: Rule) => void; depth?: number }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const fieldChoices = [...options.nativeProfileFields.map(f => ({ key: f.key, label: f.label, type: valueType(f.type) })), ...options.profileProperties.map(f => ({ key: `property:${f.key}`, label: f.displayName, type: valueType(f.dataType) }))];
  const visiblePresets = useMemo(() => rulePresets.map(group => ({ ...group, items: group.items.filter(item => (item.id !== 'group' || depth < 4) && `${item.label} ${item.description} ${group.title}`.toLowerCase().includes(search.trim().toLowerCase())) })).filter(group => group.items.length), [depth, search]);
  return <div className={s.formStack}>
    <div className={s.ruleSummary}><span>IF</span><strong>{ruleSentence(rule, options)}</strong><button type="button" onClick={() => setLibraryOpen(open => !open)}>{libraryOpen ? 'Close' : 'Change condition'}</button></div>
    {libraryOpen && <section className={s.rulePresets}><header><div><strong>Condition library</strong><small>Choose what this split should check.</small></div><button type="button" onClick={() => setLibraryOpen(false)} aria-label="Close condition library">×</button></header><label className={s.ruleSearch}>Search conditions<input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Try opened, country, order…"/></label>{visiblePresets.map(group => <section key={group.title}><strong>{group.title}</strong><div>{group.items.map(item => <button type="button" key={item.id} onClick={() => { onChange(structuredClone(item.rule)); setLibraryOpen(false); setSearch(''); }}><span>{item.label}</span><small>{item.description}</small></button>)}</div></section>)}{visiblePresets.length === 0 && <p>No conditions match “{search}”.</p>}</section>}
    {rule.type === 'group' && <><label>Match<select value={rule.operator} onChange={e => onChange({ ...rule, operator: e.target.value === 'or' ? 'or' : 'and' })}><option value="and">All conditions (AND)</option><option value="or">Any condition (OR)</option></select></label>{rule.children.map((child, i) => <div className={s.ruleCard} key={i}><RuleEditor rule={child} options={options} depth={depth + 1} onChange={value => onChange({ ...rule, children: rule.children.map((item, index) => i === index ? value : item) })}/><button className={s.textDanger} disabled={rule.children.length === 1} onClick={() => onChange({ ...rule, children: rule.children.filter((_, index) => i !== index) })}>Remove condition</button></div>)}<button className={s.secondary} disabled={rule.children.length >= 10} onClick={() => onChange({ ...rule, children: [...rule.children, structuredClone(eligibleRule)] })}>+ Add condition</button></>}
    {rule.type === 'eligibility' && <label>Profile is<select value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value === 'eligible' ? 'eligible' : 'not_eligible' })}><option value="eligible">Subscribed and not suppressed</option><option value="not_eligible">Not eligible for marketing</option></select></label>}
    {rule.type === 'consent' && <label>Marketing subscription<select value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value as typeof rule.value })}><option value="granted">Subscribed</option><option value="withdrawn">Unsubscribed</option><option value="unknown">Unknown</option></select></label>}
    {rule.type === 'suppression' && <><label>Profile<select value={rule.operator} onChange={e => onChange({ ...rule, operator: e.target.value === 'is_suppressed' ? 'is_suppressed' : 'is_not_suppressed' })}><option value="is_not_suppressed">Is not suppressed</option><option value="is_suppressed">Is suppressed</option></select></label><label>Reason<select value={rule.reason ?? ''} onChange={e => onChange({ ...rule, reason: e.target.value ? e.target.value as typeof rule.reason : undefined })}><option value="">Any reason</option>{['complaint', 'global_unsubscribe', 'hard_bounce', 'category_unsubscribe', 'manual', 'administrative', 'legal'].map(reason => <option key={reason} value={reason}>{reason.replaceAll('_', ' ')}</option>)}</select></label></>}
    {(rule.type === 'list' || rule.type === 'segment') && <><label>{rule.type === 'list' ? 'List' : 'Segment'}<select value={rule.type === 'list' ? rule.listId : rule.segmentId} onChange={e => onChange(rule.type === 'list' ? { ...rule, listId: e.target.value } : { ...rule, segmentId: e.target.value })}><option value="">Choose a {rule.type}</option>{(rule.type === 'list' ? options.lists : options.segments).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Membership<select value={rule.operator} onChange={e => onChange({ ...rule, operator: e.target.value === 'is_member' ? 'is_member' : 'is_not_member' })}><option value="is_member">Is a member</option><option value="is_not_member">Is not a member</option></select></label></>}
    {rule.type === 'profile' && <><label>Property<select value={rule.field} onChange={e => { const field = fieldChoices.find(f => f.key === e.target.value); onChange({ ...rule, field: e.target.value as typeof rule.field, valueType: field?.type, operator: 'eq', value: field?.type === 'boolean' ? true : field?.type === 'number' ? 0 : '', valueTo: undefined }); }}><option value="">Choose property</option>{fieldChoices.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label><Comparison type={rule.valueType} operator={rule.operator} value={rule.value} valueTo={rule.valueTo} withinDays={rule.withinDays} onChange={patch => onChange({ ...rule, ...patch })}/></>}
    {rule.type === 'email_activity' && <EmailActivityEditor rule={rule} options={options} onChange={onChange}/>} 
    {rule.type === 'event' && <CustomerEventEditor rule={rule} options={options} onChange={onChange}/>} 
    {(rule.type === 'email_activity' || rule.type === 'event') && <ActivityTiming rule={rule} onChange={onChange}/>} 
  </div>;
}
type ComparisonPatch = { operator?: ProfileOperator; value?: string | number | boolean; valueTo?: string | number; withinDays?: number };
type EmailActivityRule = Extract<Rule, { type: 'email_activity' }>;
type CustomerEventRule = Extract<Rule, { type: 'event' }>;
const emailActivityOptions: Array<{ value: EmailActivityRule['event']; label: string }> = [
  { value: 'sent', label: 'been sent an email' },
  { value: 'delivered', label: 'received an email' },
  { value: 'opened', label: 'opened an email' },
  { value: 'clicked', label: 'clicked an email' },
  { value: 'bounced', label: 'had an email bounce' },
  { value: 'complained', label: 'marked an email as spam' },
  { value: 'unsubscribed', label: 'unsubscribed from email' },
];
function EmailActivityEditor({ rule, options, onChange }: { rule: EmailActivityRule; options: RuleOptions; onChange: (rule: Rule) => void }) {
  const negative = rule.operator === 'at_most' && rule.count === 0;
  return <>
    <div className={s.ruleBuilderSentence}>
      <label>Contact<select value={negative ? 'not' : 'has'} onChange={event => onChange({ ...rule, operator: event.target.value === 'not' ? 'at_most' : 'at_least', count: event.target.value === 'not' ? 0 : 1 })}><option value="has">Has</option><option value="not">Has not</option></select></label>
      <label>Activity<select value={rule.event} onChange={event => { const next = event.target.value as EmailActivityRule['event']; onChange({ ...rule, event: next, emailVersionId: next === 'unsubscribed' ? undefined : rule.emailVersionId }); }}>{emailActivityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    </div>
    {rule.event !== 'unsubscribed' && <label>Which email?<select value={rule.emailVersionId ?? ''} onChange={event => onChange({ ...rule, emailVersionId: event.target.value || undefined })}><option value="">Any email</option>{options.emails.map(email => <option key={email.id} value={email.id}>{email.name} · v{email.versionNumber}</option>)}</select></label>}
  </>;
}
function CustomerEventEditor({ rule, options, onChange }: { rule: CustomerEventRule; options: RuleOptions; onChange: (rule: Rule) => void }) {
  const negative = rule.operator === 'at_most' && rule.count === 0;
  const eventDefinition = options.events.find(item => item.name === rule.name && item.schemaVersion === rule.schemaVersion);
  return <>
    <div className={s.ruleBuilderSentence}>
      <label>Contact<select value={negative ? 'not' : 'has'} onChange={event => onChange({ ...rule, operator: event.target.value === 'not' ? 'at_most' : 'at_least', count: event.target.value === 'not' ? 0 : 1 })}><option value="has">Has performed</option><option value="not">Has not performed</option></select></label>
      <label>Event<select value={`${rule.name}|${rule.schemaVersion ?? ''}`} onChange={event => { const [name, version] = event.target.value.split('|'); onChange({ ...rule, name, schemaVersion: Number(version), property: undefined }); }}><option value="|">Choose event</option>{options.events.map(item => <option key={`${item.name}|${item.schemaVersion}`} value={`${item.name}|${item.schemaVersion}`}>{item.name}</option>)}</select></label>
    </div>
    {eventDefinition && Object.keys(eventDefinition.properties ?? {}).length > 0 && <details className={s.advancedRule} open={Boolean(rule.property)}><summary>Filter by an event detail <span>Optional</span></summary><label>Event property<select value={rule.property?.key ?? ''} onChange={event => { const type = valueType(eventDefinition.properties?.[event.target.value]?.type); onChange({ ...rule, property: event.target.value ? { key: event.target.value, valueType: type, operator: 'exists' } : undefined }); }}><option value="">Any event detail</option>{Object.keys(eventDefinition.properties ?? {}).map(key => <option key={key}>{key}</option>)}</select></label>{rule.property && <Comparison type={rule.property.valueType} {...rule.property} onChange={patch => onChange({ ...rule, property: { ...rule.property!, ...patch } })}/>}</details>}
  </>;
}
function ActivityTiming({ rule, onChange }: { rule: ActivityRule; onChange: (rule: Rule) => void }) {
  const window = rule.window;
  const simplePeriod = window?.mode === 'all_time' ? 'all_time'
    : window?.mode === 'within' && window.amount === 24 && window.unit === 'hours' ? '24_hours'
      : window?.mode === 'within' && [7, 30, 90].includes(window.amount) && window.unit === 'days' ? `${window.amount}_days`
        : !window && rule.withinDays === 1 ? '24_hours'
          : !window && [7, 30, 90].includes(rule.withinDays ?? 30) ? `${rule.withinDays ?? 30}_days`
          : 'custom';
  const advancedByDefault = simplePeriod === 'custom' || !((rule.operator === 'at_least' && rule.count === 1) || (rule.operator === 'at_most' && rule.count === 0));
  const [advancedOpen, setAdvancedOpen] = useState(advancedByDefault);
  const patch = (next: Partial<ActivityRule>) => onChange({ ...rule, ...next } as ActivityRule);
  return <>
    <label>Time period<select value={simplePeriod} onChange={event => { const period = event.target.value; if (period === 'all_time') patch({ window: { mode: 'all_time' } }); else if (period === '24_hours') patch({ window: { mode: 'within', amount: 24, unit: 'hours' } }); else if (period.endsWith('_days')) patch({ window: { mode: 'within', amount: Number(period.split('_')[0]), unit: 'days' } }); else { setAdvancedOpen(true); patch({ window: window ?? { mode: 'within', amount: rule.withinDays ?? 30, unit: 'days' } }); } }}><option value="24_hours">Last 24 hours</option><option value="7_days">Last 7 days</option><option value="30_days">Last 30 days</option><option value="90_days">Last 90 days</option><option value="all_time">All time</option><option value="custom">Custom…</option></select></label>
    <details className={s.advancedRule} open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Advanced frequency and dates <span>Optional</span></summary><div className={s.twoFields}><label>Frequency<select value={rule.operator} onChange={event => patch({ operator: event.target.value as ActivityRule['operator'] })}><option value="at_least">At least</option><option value="exactly">Exactly</option><option value="at_most">At most</option></select></label><label>Times<input type="number" min={0} max={1000} value={rule.count} onChange={event => patch({ count: Number(event.target.value) })}/></label></div><label>Date range<select value={window?.mode ?? 'within'} onChange={event => patch({ window: event.target.value === 'all_time' ? { mode: 'all_time' } : event.target.value === 'between' ? { mode: 'between', from: new Date(Date.now() - 7 * 86400000).toISOString(), to: new Date().toISOString() } : { mode: 'within', amount: rule.withinDays ?? 30, unit: 'days' } })}><option value="within">Rolling period</option><option value="all_time">All time</option><option value="between">Between dates</option></select></label>{(!window || window.mode === 'within') && <div className={s.twoFields}><label>Amount<input type="number" min={1} max={8760} value={window?.mode === 'within' ? window.amount : rule.withinDays ?? 30} onChange={event => patch({ window: { mode: 'within', amount: Math.max(1, Number(event.target.value)), unit: window?.mode === 'within' ? window.unit : 'days' } })}/></label><label>Unit<select value={window?.mode === 'within' ? window.unit : 'days'} onChange={event => patch({ window: { mode: 'within', amount: window?.mode === 'within' ? window.amount : rule.withinDays ?? 30, unit: event.target.value as 'hours' | 'days' | 'weeks' | 'months' } })}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label></div>}{window?.mode === 'between' && <div className={s.twoFields}><label>From<input type="datetime-local" value={window.from.slice(0, 16)} onChange={event => event.target.value && patch({ window: { mode: 'between', from: new Date(event.target.value).toISOString(), to: window.to } })}/></label><label>To<input type="datetime-local" value={window.to.slice(0, 16)} onChange={event => event.target.value && patch({ window: { mode: 'between', from: window.from, to: new Date(event.target.value).toISOString() } })}/></label></div>}</details>
    {rule.type === 'email_activity' && rule.operator === 'at_most' && rule.count === 0 && <p className={s.ruleTimingNote}>Tip: place a time delay before this split so contacts have time to open or click.</p>}
  </>;
}
function Comparison({ type, operator, value, valueTo, withinDays, onChange }: { type?: RuleValueType; operator: ProfileOperator; value?: string | number | boolean; valueTo?: string | number; withinDays?: number; onChange: (patch: ComparisonPatch) => void }) {
  const operators: ProfileOperator[] = type === 'boolean' ? ['eq', 'neq', 'exists', 'not_exists'] : type === 'number' ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists', 'not_exists'] : type === 'datetime' ? ['before', 'after', 'between', 'within_last', 'exists', 'not_exists', 'eq'] : ['eq', 'neq', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'exists', 'not_exists'];
  const labels: Record<ProfileOperator, string> = { eq: 'Equals', neq: 'Does not equal', contains: 'Contains', does_not_contain: 'Does not contain', starts_with: 'Starts with', ends_with: 'Ends with', exists: 'Is set', not_exists: 'Is not set', gt: 'Greater than', gte: 'Greater than or equal', lt: 'Less than', lte: 'Less than or equal', between: 'Is between', before: 'Is before', after: 'Is after', within_last: 'Is within the last' };
  const needsValue = operator !== 'exists' && operator !== 'not_exists' && operator !== 'within_last';
  return <><label>Comparison<select value={operator} onChange={e => onChange({ operator: e.target.value as ProfileOperator })}>{[...new Set([operator, ...operators])].map(op => <option value={op} key={op}>{labels[op]}</option>)}</select></label>{operator === 'within_last' ? <label>Days<input type="number" min={1} max={365} value={withinDays ?? 30} onChange={e => onChange({ withinDays: Number(e.target.value) })}/></label> : needsValue && <label>Value{type === 'boolean' ? <select value={String(value ?? true)} onChange={e => onChange({ value: e.target.value === 'true' })}><option>true</option><option>false</option></select> : <input type={type === 'number' ? 'number' : type === 'datetime' ? 'datetime-local' : 'text'} placeholder={type === 'datetime' ? 'Choose date and time' : 'Enter value'} value={String(value ?? '')} onChange={e => onChange({ value: typedValue(e.target.value, type) })}/>}</label>}{operator === 'between' && <label>Upper value<input type={type === 'number' ? 'number' : type === 'datetime' ? 'datetime-local' : 'text'} value={String(valueTo ?? '')} onChange={e => onChange({ valueTo: type === 'number' ? Number(e.target.value) : e.target.value })}/></label>}</>;
}
