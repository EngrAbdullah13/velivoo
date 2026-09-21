// @ts-nocheck -- Flow graphs are runtime-validated server contracts; this UI also
// accepts forward-compatible node properties while those contracts evolve.
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { phase3Api } from '../../lib/phase3-api';
type Rule = any;
type Node = {
    id: string;
    type: 'delay' | 'wait_until' | 'conditional' | 'email' | 'end';
    durationSeconds?: number;
    hour?: number;
    minute?: number;
    emailVersionId?: string;
    mode?: 'test' | 'live';
    rule?: Rule;
};
type Graph = {
    schemaVersion: number;
    trigger: any;
    nodes: Node[];
    edges: Array<{
        from: string;
        to: string;
        outcome?: 'yes' | 'no';
    }>;
    entryPolicy: {
        mode: 'once' | 'once_per_event' | 'cooldown';
        cooldownSeconds?: number;
    };
    entryFilters: Rule[];
    exitRules: Rule[];
    layout?: Record<string, {
        x: number;
        y: number;
    }>;
};
type Issue = {
    code: string;
    severity: 'blocking' | 'warning';
    message: string;
    nodeId?: string;
    field?: string;
};
type Flow = {
    id: string;
    name: string;
    status: string;
    rowVersion: number;
    activeVersionId?: string | null;
    draftGraph: Graph;
    versions?: Array<{
        id: string;
        versionNumber: number;
        graphJson?: Graph;
    }>;
    validation?: {
        issues: Issue[];
    } | null;
};
type Options = {
    lists: Array<{
        id: string;
        name: string;
    }>;
    segments: Array<{
        id: string;
        name: string;
    }>;
    events: Array<{
        eventName: string;
        schemaVersion: number;
    }>;
    dateProperties: Array<{
        key: string;
        displayName: string;
        dataType: string;
    }>;
    emails: Array<{
        id: string;
        name: string;
        versionNumber: number;
        emailDefinitionId: string;
        preflightState: string;
        readinessState: string;
        readinessDetail: string;
    }>;
    triggerContracts: Record<string, string>;
};
type RuleOptions = {
    lists: Array<{
        id: string;
        name: string;
    }>;
    segments: Array<{
        id: string;
        name: string;
    }>;
    emails: Array<{
        id: string;
        name: string;
        versionNumber: number;
    }>;
    events: Array<{
        name: string;
        schemaVersion: number;
        properties: Record<string, {
            type: string;
        }>;
    }>;
    profileProperties: Array<{
        key: string;
        displayName: string;
        dataType: string;
    }>;
    nativeProfileFields: Array<{
        key: string;
        label: string;
        type: string;
    }>;
};
type Profile = {
    id: string;
    displayName?: string;
    email?: string;
    originalEmail?: string;
    firstName?: string;
    lastName?: string;
};
const eligibility = { type: 'eligibility', operator: 'is', value: 'eligible' };
const label = (type: string) => ({ delay: 'Delay', wait_until: 'Wait until', conditional: 'Conditional split', email: 'Email', end: 'End' }[type] ?? type);
const icon = (type: string) => ({ trigger: '⚡', delay: '◷', wait_until: '◷', conditional: '◇', email: '✉', end: '■' }[type] ?? '•');
const edgesFrom = (graph: Graph, id: string) => graph.edges.filter(edge => edge.from === id);
function ruleSummary(rule: Rule) { if (!rule)
    return 'Configure a canonical rule'; if (rule.type === 'group') {
    const lead = rule.children?.[0];
    return `${rule.operator === 'and' ? 'ALL' : 'ANY'} of ${rule.children?.length ?? 0} conditions${lead ? ` · ${ruleSummary(lead)}` : ''}`;
} if (rule.type === 'eligibility')
    return rule.value === 'eligible' ? 'Marketing email eligible' : 'Marketing email not eligible'; if (rule.type === 'consent')
    return `Consent is ${rule.value}`; if (rule.type === 'profile')
    return `${String(rule.field).replaceAll('_', ' ')} ${rule.operator} ${rule.value ?? ''}`; if (rule.type === 'list')
    return `List is ${rule.operator === 'is_member' ? 'a member' : 'not a member'}`; if (rule.type === 'segment')
    return `Segment is ${rule.operator === 'is_member' ? 'a member' : 'not a member'}`; if (rule.type === 'suppression')
    return `${rule.operator === 'is_suppressed' ? 'Suppressed' : 'Not suppressed'}${rule.reason ? ` · ${rule.reason}` : ''}`; if (rule.type === 'email_activity')
    return `${rule.event} ${rule.operator.replace('_', ' ')} ${rule.count} in ${rule.withinDays} days`; if (rule.type === 'event')
    return `${rule.name} ${rule.operator.replace('_', ' ')} ${rule.count} in ${rule.withinDays} days`; return 'Canonical audience rule'; }
function triggerSummary(trigger: any, options: Options | null) { if (!trigger || trigger.type === 'unconfigured')
    return 'Configure trigger'; if (trigger.type === 'list_joined')
    return options?.lists.find(item => item.id === trigger.listId)?.name ?? 'Select a List'; if (trigger.type === 'segment_entered')
    return options?.segments.find(item => item.id === trigger.segmentId)?.name ?? 'Select a Segment'; if (trigger.type === 'generic_event')
    return trigger.eventName ? `${trigger.eventName} · v${trigger.schemaVersion}` : 'Select an event'; if (trigger.type === 'profile_date')
    return trigger.field ? `${trigger.field} · profile timezone` : 'Select date property'; return 'Explicit test entry'; }
function triggerKey(trigger: any) { if (!trigger || trigger.type === 'unconfigured')
    return ''; if (trigger.type === 'list_joined')
    return `list:${trigger.listId ?? ''}`; if (trigger.type === 'segment_entered')
    return `segment:${trigger.segmentId ?? ''}`; if (trigger.type === 'generic_event')
    return `event:${trigger.eventName ?? ''}|${trigger.schemaVersion ?? ''}`; if (trigger.type === 'profile_date')
    return `date:${trigger.field ?? ''}`; if (trigger.type === 'manual_test')
    return 'manual_test'; return trigger.type ?? ''; }
function nodeSummary(node: Node, options: Options | null) { if (node.type === 'email') {
    const email = options?.emails.find(item => item.id === node.emailVersionId);
    return email ? `${email.name} · v${email.versionNumber} · ${node.mode === 'test' ? 'Test' : 'Live'}` : 'Published Email Version required';
} if (node.type === 'delay')
    return `Wait ${node.durationSeconds ?? 0} seconds`; if (node.type === 'wait_until')
    return `Next day · ${String(node.hour ?? 9).padStart(2, '0')}:${String(node.minute ?? 0).padStart(2, '0')} · Profile timezone`; if (node.type === 'conditional')
    return ruleSummary(node.rule); return node.type === 'end' ? 'Journey complete' : ''; }
function profileName(profile: Profile) { return profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email || profile.originalEmail || profile.id; }
function normalizeEntryPolicy(graph: Graph): Graph { if (graph.entryPolicy?.mode !== 'cooldown')
    return graph; const seconds = graph.entryPolicy.cooldownSeconds; if (typeof seconds === 'number' && seconds >= 60 && seconds <= 31536000)
    return graph; return { ...graph, entryPolicy: { ...graph.entryPolicy, cooldownSeconds: typeof seconds === 'number' && seconds > 0 ? Math.max(60, Math.min(31536000, seconds)) : 86400 } }; }
function prepareEmailModes(graph: Graph, mode: 'testing' | 'production'): Graph { return { ...graph, nodes: graph.nodes.map(node => node.type === 'email' ? { ...node, mode: mode === 'testing' ? 'test' : 'live' } : node) }; }
function applyTriggerDefaults(graph: Graph, triggerType: string): Graph { let next = structuredClone(graph); if (triggerType === 'manual_test')
    next = prepareEmailModes(next, 'testing'); if (triggerType === 'list_joined' || triggerType === 'segment_entered')
    next = { ...next, entryPolicy: { mode: 'once_per_event' } }; return next; }
function RuleEditor({ title, value, onChange, options }: {
    title: string;
    value: Rule;
    onChange: (rule: Rule) => void;
    options: RuleOptions | null;
}) { const group = value?.type === 'group' ? value : { type: 'group', operator: 'and', children: [value ?? eligibility] }; const set = (children: Rule[], operator = group.operator) => onChange({ type: 'group', operator, children }); return <section className="flow-rule-editor"><h3>{title}</h3><label>Match<select value={group.operator} onChange={event => set(group.children, event.target.value as 'and' | 'or')}><option value="and">ALL conditions</option><option value="or">ANY condition</option></select></label>{group.children.map((rule: Rule, index: number) => <ConditionEditor key={index} index={index} rule={rule} options={options} onChange={next => set(group.children.map((item: Rule, i: number) => i === index ? next : item))} remove={group.children.length > 1 ? () => set(group.children.filter((_: Rule, i: number) => i !== index)) : undefined}/>)}<button type="button" onClick={() => set([...group.children, { ...eligibility }])}>+ Add condition</button></section>; }
function ConditionEditor({ index, rule, options, onChange, remove }: {
    index: number;
    rule: Rule;
    options: RuleOptions | null;
    onChange: (rule: Rule) => void;
    remove?: () => void;
}) { const type = rule.type === 'group' ? 'eligibility' : rule.type; const changeType = (next: string) => { const defaults: any = { eligibility: { ...eligibility }, consent: { type: 'consent', channel: 'email', purpose: 'marketing', operator: 'is', value: 'granted' }, suppression: { type: 'suppression', operator: 'is_suppressed' }, profile: { type: 'profile', field: 'country_code', valueType: 'text', operator: 'eq', value: '' }, list: { type: 'list', listId: options?.lists[0]?.id ?? '', operator: 'is_member' }, segment: { type: 'segment', segmentId: options?.segments[0]?.id ?? '', operator: 'is_member' }, email_activity: { type: 'email_activity', event: 'clicked', operator: 'at_least', count: 1, withinDays: 7 }, event: { type: 'event', name: options?.events[0]?.name ?? '', schemaVersion: options?.events[0]?.schemaVersion, operator: 'at_least', count: 1, withinDays: 14 } }; onChange(defaults[next]); }; const patch = (next: any) => onChange({ ...rule, ...next }); const profileField = rule.type === 'profile' ? rule.field : 'country_code', profileMeta = [...(options?.nativeProfileFields ?? []), ...(options?.profileProperties ?? []).map(item => ({ key: `property:${item.key}`, label: item.displayName, type: item.dataType }))].find(item => item.key === profileField), date = profileMeta?.type === 'date' || profileMeta?.type === 'datetime'; const eventSchema = rule.type === 'event' ? options?.events.find(item => item.name === rule.name && item.schemaVersion === rule.schemaVersion) : undefined; return <fieldset className="flow-condition"><legend>Condition {index + 1}</legend><label>Condition type<select value={type} onChange={event => changeType(event.target.value)}><option value="eligibility">Marketing eligibility</option><option value="profile">Profile property</option><option value="list">List membership</option><option value="segment">Segment membership</option><option value="consent">Consent / subscription</option><option value="suppression">Suppression</option><option value="email_activity">Email activity</option><option value="event">Generic Event</option></select></label>{type === 'eligibility' && <label>State<select value={rule.value} onChange={event => patch({ value: event.target.value })}><option value="eligible">Eligible</option><option value="not_eligible">Not eligible</option></select></label>}{type === 'consent' && <label>Subscription state<select value={rule.value} onChange={event => patch({ value: event.target.value })}><option value="granted">Granted</option><option value="withdrawn">Unsubscribed</option><option value="unknown">Unknown</option></select></label>}{type === 'suppression' && <><label>State<select value={rule.operator} onChange={event => patch({ operator: event.target.value })}><option value="is_suppressed">Is suppressed</option><option value="is_not_suppressed">Is not suppressed</option></select></label><label>Reason<select value={rule.reason ?? ''} onChange={event => patch({ reason: event.target.value || undefined })}><option value="">Any suppression</option><option value="complaint">Complaint</option><option value="hard_bounce">Hard bounce</option><option value="manual">Manual</option><option value="global_unsubscribe">Global unsubscribe</option></select></label></>}{type === 'list' && <><label>List<select value={rule.listId} onChange={event => patch({ listId: event.target.value })}>{options?.lists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Membership<select value={rule.operator} onChange={event => patch({ operator: event.target.value })}><option value="is_member">Is a member</option><option value="is_not_member">Is not a member</option></select></label></>}{type === 'segment' && <><label>Segment<select value={rule.segmentId} onChange={event => patch({ segmentId: event.target.value })}>{options?.segments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Membership<select value={rule.operator} onChange={event => patch({ operator: event.target.value })}><option value="is_member">Is currently in</option><option value="is_not_member">Is not currently in</option></select></label></>}{type === 'profile' && <><label>Property<select value={profileField} onChange={event => { const meta = [...(options?.nativeProfileFields ?? []), ...(options?.profileProperties ?? []).map(item => ({ key: `property:${item.key}`, label: item.displayName, type: item.dataType }))].find(item => item.key === event.target.value); onChange({ type: 'profile', field: event.target.value, valueType: meta?.type === 'date' ? 'datetime' : meta?.type ?? 'text', operator: meta?.type === 'date' || meta?.type === 'datetime' ? 'within_last' : 'eq', value: meta?.type === 'date' || meta?.type === 'datetime' ? undefined : '', withinDays: meta?.type === 'date' || meta?.type === 'datetime' ? 30 : undefined }); }}>{[...(options?.nativeProfileFields ?? []), ...(options?.profileProperties ?? []).map(item => ({ key: `property:${item.key}`, label: item.displayName, type: item.dataType }))].map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>Operator<select value={rule.operator} onChange={event => patch({ operator: event.target.value })}>{date ? <><option value="before">Before</option><option value="after">After</option><option value="within_last">Within last</option><option value="between">Between</option></> : <><option value="eq">Equals</option><option value="neq">Does not equal</option><option value="contains">Contains</option><option value="starts_with">Starts with</option><option value="exists">Exists</option></>}</select></label>{rule.operator === 'within_last' ? <label>Last days<input type="number" min="1" max="365" value={rule.withinDays ?? 30} onChange={event => patch({ withinDays: Number(event.target.value) })}/></label> : rule.operator !== 'exists' && <label>Value<input type={date ? 'datetime-local' : 'text'} value={rule.value ?? ''} onChange={event => patch({ value: event.target.value })}/></label>}</>}{type === 'email_activity' && <><label>Activity<select value={rule.event} onChange={event => patch({ event: event.target.value, emailVersionId: event.target.value === 'unsubscribed' ? undefined : rule.emailVersionId })}><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="opened">Opened</option><option value="clicked">Clicked</option><option value="bounced">Bounced</option><option value="complained">Complained</option><option value="unsubscribed">Unsubscribed</option></select></label>{rule.event !== 'unsubscribed' && <label>Email version<select value={rule.emailVersionId ?? ''} onChange={event => patch({ emailVersionId: event.target.value || undefined })}><option value="">Any marketing email</option>{options?.emails.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.versionNumber}</option>)}</select></label>}<CountFields rule={rule} patch={patch}/>{rule.event === 'opened' && <small>Open tracking can be affected by privacy protections; clicks are stronger engagement evidence.</small>}</>}{type === 'event' && <><label>Event schema<select value={`${rule.name}|${rule.schemaVersion ?? ''}`} onChange={event => { const [name, version] = event.target.value.split('|'); patch({ name, schemaVersion: Number(version), property: undefined }); }}>{options?.events.map(item => <option key={`${item.name}|${item.schemaVersion}`} value={`${item.name}|${item.schemaVersion}`}>{item.name} · v{item.schemaVersion}</option>)}</select></label><CountFields rule={rule} patch={patch}/>{eventSchema && <label>Property filter<select value={rule.property?.key ?? ''} onChange={event => { const property = event.target.value ? { key: event.target.value, valueType: eventSchema.properties[event.target.value]?.type ?? 'string', operator: 'eq', value: '' } : undefined; patch({ property }); }}><option value="">No property filter</option>{Object.keys(eventSchema.properties ?? {}).map(key => <option key={key} value={key}>{key}</option>)}</select></label>}{rule.property && <label>Property value<input value={rule.property.value ?? ''} onChange={event => patch({ property: { ...rule.property, value: event.target.value } })}/></label>}</>}{remove && <button type="button" onClick={remove}>Remove condition</button>}</fieldset>; }
function CountFields({ rule, patch }: {
    rule: any;
    patch: (value: any) => void;
}) { return <div className="flow-inline-fields"><label>Operator<select value={rule.operator} onChange={event => patch({ operator: event.target.value })}><option value="at_least">At least</option><option value="exactly">Exactly</option><option value="at_most">At most</option></select></label><label>Count<input type="number" min="0" max="1000" value={rule.count ?? 1} onChange={event => patch({ count: Number(event.target.value) })}/></label><label>During last days<input type="number" min="1" max="365" value={rule.withinDays ?? 7} onChange={event => patch({ withinDays: Number(event.target.value) })}/></label></div>; }
function emailVersionLabel(email: {
    name: string;
    versionNumber: number;
    preflightState: string;
    readinessState: string;
}) { return `${email.name} · v${email.versionNumber} · ${email.preflightState} · ${email.readinessState}`; }
function EmailVersionPicker({ value, emails, open, onOpenChange, onPick, onHover, onLeave, highlightId }: {
    value: string;
    emails: Array<{
        id: string;
        name: string;
        versionNumber: number;
        preflightState: string;
        readinessState: string;
    }>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPick: (id: string) => void;
    onHover: (id: string) => void;
    onLeave: () => void;
    highlightId?: string;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const selected = emails.find(item => item.id === value);
    useEffect(() => { if (!open)
        return; const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
        onLeave();
    } }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, [open, onLeave, onOpenChange]);
    return <div className="flow-email-version-picker" ref={rootRef}><span className="flow-email-version-label">Published Email Version</span><button type="button" className="flow-email-version-trigger" aria-expanded={open} onClick={() => onOpenChange(!open)}>{selected ? emailVersionLabel(selected) : 'Select published Email Version'}</button>{open && <ul className="flow-email-version-list" role="listbox">{emails.map(item => <li key={item.id} role="option" aria-selected={value === item.id} className={[value === item.id ? 'selected' : '', highlightId === item.id ? 'previewing' : ''].filter(Boolean).join(' ')} onMouseEnter={() => onHover(item.id)} onMouseLeave={onLeave} onClick={() => onPick(item.id)}>{emailVersionLabel(item)}</li>)}</ul>}</div>;
}
function EmailHoverPreview({ preview, loading, emailName, pinned, onUse, onClose }: {
    preview: any;
    loading: boolean;
    emailName?: string;
    pinned: boolean;
    onUse: () => void;
    onClose: () => void;
}) {
    if (!preview && !loading && !pinned)
        return null;
    return <div className={`flow-email-hover-preview${pinned ? ' is-pinned' : ''}`} aria-live="polite" onClick={pinned ? onClose : undefined}><div className="flow-email-hover-preview-card" onClick={event => event.stopPropagation()}><div className="flow-email-hover-preview-head"><strong>{emailName ?? 'Email preview'}</strong>{preview?.source?.versionNumber != null && <span>v{preview.source.versionNumber}</span>}{loading && <em>Loading preview…</em>}<div className="flow-email-hover-preview-actions">{pinned && <button type="button" className="flow-email-hover-preview-use" onClick={onUse}>Use</button>}{pinned && <button type="button" className="flow-email-hover-preview-close" onClick={onClose} aria-label="Close preview">×</button>}</div></div>{preview && !loading && <><p className="flow-email-hover-preview-subject">{preview.subject}</p><iframe title="Email template hover preview" sandbox="" srcDoc={preview.html}/></>}{!preview && loading && <p className="flow-email-hover-preview-subject">Fetching rendered preview…</p>}</div></div>;
}
const FLOW_NODE_WIDTH = 224;
const FLOW_NODE_HEIGHT = 128;
function buildFlowRows(graph: Graph) { const result: Array<{
    id: string;
    depth: number;
    lane: number;
}> = [{ id: 'trigger', depth: 0, lane: 0 }], seen = new Set(['trigger']); for (let i = 0; i < result.length; i++) {
    const row = result[i]!;
    edgesFrom(graph, row.id).forEach((edge, lane) => { if (!seen.has(edge.to)) {
        seen.add(edge.to);
        result.push({ id: edge.to, depth: row.depth + 1, lane: row.lane + lane });
    } });
} return result; }
function buildFlowPositions(graph: Graph, rows: Array<{
    id: string;
    depth: number;
    lane: number;
}>) { const maxLane = Math.max(0, ...rows.map(row => row.lane)); return new Map(rows.map(row => { const fallback = { x: Math.max(24, 402 + (row.lane - maxLane / 2) * 280 - 112), y: 42 + row.depth * 178 }; return [row.id, graph.layout?.[row.id] ?? fallback]; })); }
function computeFitView(positions: Map<string, {
    x: number;
    y: number;
}>, viewportWidth: number, viewportHeight: number, padding = 56) { if (viewportWidth <= 0 || viewportHeight <= 0)
    return { zoom: 100, pan: { x: 0, y: 0 } }; const coords = [...positions.values()]; if (!coords.length)
    return { zoom: 100, pan: { x: 40, y: 40 } }; const minX = Math.min(...coords.map(point => point.x)) - padding, minY = Math.min(...coords.map(point => point.y)) - padding, maxX = Math.max(...coords.map(point => point.x + FLOW_NODE_WIDTH)) + padding, maxY = Math.max(...coords.map(point => point.y + FLOW_NODE_HEIGHT)) + padding, contentW = maxX - minX, contentH = maxY - minY, scale = Math.min(viewportWidth / contentW, viewportHeight / contentH, 1.5), zoom = Math.max(40, Math.min(160, Math.round(scale * 100))), s = zoom / 100; return { zoom, pan: { x: (viewportWidth - contentW * s) / 2 - minX * s, y: (viewportHeight - contentH * s) / 2 - minY * s } }; }
function Canvas({ graph, options, issues, selected, onSelect, onInsert, onMove, zoom, onZoomChange, pan, onPanChange, fitKey, onRegisterFit }: {
    graph: Graph;
    options: Options | null;
    issues: Issue[];
    selected: string;
    onSelect: (id: string) => void;
    onInsert?: (fromId: string, toId: string, outcome: 'yes' | 'no' | undefined, type: 'email') => void;
    onMove: (id: string, position: {
        x: number;
        y: number;
    }) => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
    pan: {
        x: number;
        y: number;
    };
    onPanChange: (pan: {
        x: number;
        y: number;
    }) => void;
    fitKey: string;
    onRegisterFit: (fit: () => void) => void;
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState<any>(null);
    const [panning, setPanning] = useState(false);
    const dragRef = useRef<any>(null);
    const panRef = useRef<any>(null);
    const clampZoom = (value: number) => Math.max(40, Math.min(160, value));
    const rows = useMemo(() => buildFlowRows(graph), [graph]);
    const positions = useMemo(() => buildFlowPositions(graph, rows), [graph, rows]);
    const maxX = Math.max(0, ...[...positions.values()].map(position => position.x)), maxY = Math.max(0, ...[...positions.values()].map(position => position.y)), stageWidth = Math.max(maxX + FLOW_NODE_WIDTH + 48, maxX + 270), stageHeight = Math.max(maxY + FLOW_NODE_HEIGHT + 48, maxY + 164);
    const fitView = useCallback(() => { const viewport = viewportRef.current; if (!viewport)
        return; const fit = computeFitView(positions, viewport.clientWidth, viewport.clientHeight); onZoomChange(fit.zoom); onPanChange(fit.pan); }, [onPanChange, onZoomChange, positions]);
    useEffect(() => { onRegisterFit(fitView); }, [fitView, onRegisterFit]);
    useEffect(() => { const viewport = viewportRef.current; if (!viewport)
        return; const run = () => { if (viewport.clientWidth > 0 && viewport.clientHeight > 0)
        fitView(); }; run(); const frame = requestAnimationFrame(run); return () => cancelAnimationFrame(frame); }, [fitKey, fitView]);
    const beginDrag = (event: any, id: string, position: {
        x: number;
        y: number;
    }) => { if (event.button !== 0)
        return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const next = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position, position }; dragRef.current = next; setDragging(next); onSelect(id); };
    const drag = (event: any) => { const active = dragRef.current; if (active && active.pointerId === event.pointerId) {
        const scale = zoom / 100;
        const next = { ...active, position: { x: Math.max(24, active.origin.x + (event.clientX - active.startX) / scale), y: Math.max(24, active.origin.y + (event.clientY - active.startY) / scale) } };
        dragRef.current = next;
        setDragging(next);
        return;
    } const panActive = panRef.current; if (!panActive || panActive.pointerId !== event.pointerId)
        return; onPanChange({ x: panActive.origin.x + (event.clientX - panActive.startX), y: panActive.origin.y + (event.clientY - panActive.startY) }); };
    const endDrag = (event: any) => { const active = dragRef.current; if (active && active.pointerId === event.pointerId) {
        dragRef.current = null;
        setDragging(null);
        if (Math.abs(active.position.x - active.origin.x) > 1 || Math.abs(active.position.y - active.origin.y) > 1)
            onMove(active.id, active.position);
    } const panActive = panRef.current; if (panActive && panActive.pointerId === event.pointerId) {
        panRef.current = null;
        setPanning(false);
    } };
    const beginPan = (event: any) => { if (event.button !== 0 && event.button !== 1)
        return; const target = event.target as HTMLElement; if (target.closest('.flow-node-card,.flow-branch-add'))
        return; event.currentTarget.setPointerCapture(event.pointerId); panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: pan }; setPanning(true); };
    const wheel = (event: React.WheelEvent<HTMLDivElement>) => { event.preventDefault(); const viewport = viewportRef.current; if (!viewport)
        return; const rect = viewport.getBoundingClientRect(); const pointerX = event.clientX - rect.left; const pointerY = event.clientY - rect.top; const scale = zoom / 100; const delta = event.deltaY < 0 ? 10 : -10; const nextZoom = clampZoom(zoom + delta); const nextScale = nextZoom / 100; const worldX = (pointerX - pan.x) / scale; const worldY = (pointerY - pan.y) / scale; onZoomChange(nextZoom); onPanChange({ x: pointerX - worldX * nextScale, y: pointerY - worldY * nextScale }); };
    return <div ref={viewportRef} className={`flow-canvas-viewport${panning ? ' is-panning' : ''}`} style={{ backgroundPosition: `${pan.x}px ${pan.y}px` }} onPointerDown={beginPan} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={wheel} aria-label="Flow canvas. Drag the background to pan. Scroll to zoom."><div className="flow-canvas-transform" style={{ width: `${stageWidth}px`, height: `${stageHeight}px`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}><div className="flow-canvas-stage" style={{ width: `${stageWidth}px`, height: `${stageHeight}px` }}><svg className="flow-links" aria-hidden="true" width={stageWidth} height={stageHeight}><defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#a092b4"/></marker></defs>{graph.edges.map((edge, index) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to)
        return null; const x1 = from.x + 112, y1 = from.y + 128, x2 = to.x + 112, y2 = to.y + 6, branch = edge.outcome && edge.from !== 'trigger' ? edge.outcome.toUpperCase() : null; return <g key={`${edge.from}-${edge.to}-${index}`}><path d={`M ${x1} ${y1} C ${x1} ${y1 + 28}, ${x2} ${y2 - 28}, ${x2} ${y2}`} markerEnd="url(#flow-arrow)"/>{branch && <text x={x1 + (x2 - x1) * .34} y={y1 + (y2 - y1) * .42}>{branch}</text>}</g>; })}</svg>{graph.edges.map((edge, index) => { const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to)
        return null; const x = from.x + 112 + (to.x + 112 - (from.x + 112)) * .65, y = from.y + 128 + (to.y + 6 - (from.y + 128)) * .58, branch = edge.outcome ? ` on the ${edge.outcome.toUpperCase()} branch` : ''; return <button key={`insert-${edge.from}-${edge.to}-${index}`} type="button" className={`flow-branch-add ${edge.outcome ?? 'default'}`} style={{ left: x - 16, top: y - 16 }} title={`Add an Email step${branch}`} aria-label={`Add an Email step${branch}`} onClick={event => { event.stopPropagation(); onInsert?.(edge.from, edge.to, edge.outcome, 'email'); onSelect(edge.from); }}>+</button>; })}{rows.map(row => { const node = row.id === 'trigger' ? null : graph.nodes.find(item => item.id === row.id), position = dragging?.id === row.id ? dragging.position : positions.get(row.id)!, blocked = issues.some(issue => issue.nodeId === row.id || (row.id === 'trigger' && issue.field === 'trigger')); return <button key={row.id} type="button" className={`flow-node-card ${selected === row.id ? 'selected' : ''} ${blocked ? 'blocking' : ''} ${dragging?.id === row.id ? 'dragging' : ''}`} style={{ left: position.x, top: position.y }} onPointerDown={event => beginDrag(event, row.id, position)} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={() => onSelect(row.id)} aria-pressed={selected === row.id} title="Drag to reposition this node"><span className="flow-node-icon">{icon(node?.type ?? 'trigger')}</span><span className="flow-node-kind">{node ? label(node.type) : 'Trigger'}</span><strong>{node ? label(node.type) : triggerSummary(graph.trigger, options)}</strong><small>{node ? nodeSummary(node, options) : graph.entryPolicy.mode === 'once' ? 'One time only' : graph.entryPolicy.mode === 'once_per_event' ? 'Every confirmed event' : 'Cooldown'}</small>{node?.type === 'email' && <em>{node.mode === 'test' ? 'Test' : 'Live'} · {options?.emails.find(email => email.id === node.emailVersionId)?.preflightState ?? 'unknown'}</em>}{blocked && <b>Blocking issue</b>}</button>; })}</div></div></div>;
}
function FlowHeaderActions({ flow, busy, history, future, dirty, needsReactivate, onUndo, onRedo, onSave, onValidate, onActivate, onApplyChanges, onPause, onResume }: {
    flow: Flow;
    busy: boolean;
    history: Graph[];
    future: Graph[];
    dirty: boolean;
    needsReactivate: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onSave: () => void;
    onValidate: () => void;
    onActivate: () => void;
    onApplyChanges: () => void;
    onPause: () => void;
    onResume: () => void;
}) { const isLive = flow.status === 'active' || flow.status === 'testing'; const isPaused = flow.status === 'paused'; const hasPublishedVersion = Boolean(flow.activeVersionId); return <div className="flow-header-actions"><button type="button" onClick={onUndo} disabled={!history.length}>Undo</button><button type="button" onClick={onRedo} disabled={!future.length}>Redo</button><button type="button" onClick={onSave} disabled={!dirty || busy}>Save</button><button type="button" onClick={onValidate} disabled={busy}>Validate</button>{needsReactivate && hasPublishedVersion && <button type="button" className="button-primary flow-apply-changes-button" onClick={onApplyChanges} disabled={busy}>{busy ? 'Applying…' : 'Apply changes'}</button>}{isLive ? <><button type="button" className="flow-status-button is-active" disabled aria-current="true">{flow.status === 'testing' ? 'Testing active' : 'Activated'}</button><button type="button" className="flow-pause-button" onClick={onPause} disabled={busy}>Pause</button></> : isPaused ? <><button type="button" className="flow-status-button is-paused" disabled>Paused</button>{needsReactivate && hasPublishedVersion ? <button type="button" className="button-primary flow-apply-changes-button" onClick={onApplyChanges} disabled={busy}>{busy ? 'Applying…' : 'Apply changes'}</button> : <button type="button" className="button-primary" onClick={onResume} disabled={busy}>Resume</button>}</> : <button type="button" className="button-primary flow-activate-button" onClick={onActivate} disabled={busy}>Activate</button>}</div>; }
export function FlowBuilder({ workspaceId, flowId }: {
    workspaceId: string;
    flowId: string;
}) {
    const [flow, setFlow] = useState<Flow | null>(null), [graph, setGraph] = useState<Graph | null>(null), [options, setOptions] = useState<Options | null>(null), [ruleOptions, setRuleOptions] = useState<RuleOptions | null>(null), [issues, setIssues] = useState<Issue[]>([]), [selected, setSelected] = useState(''), [view, setView] = useState<'canvas' | 'structure'>('canvas'), [zoom, setZoom] = useState(100), [pan, setPan] = useState({ x: 0, y: 0 }), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState<Graph[]>([]), [future, setFuture] = useState<Graph[]>([]), [query, setQuery] = useState(''), [profiles, setProfiles] = useState<Profile[]>([]), [profileId, setProfileId] = useState(''), [previewProfileId, setPreviewProfileId] = useState(''), [simulation, setSimulation] = useState<any>(null), [review, setReview] = useState<any>(null), [emailPreview, setEmailPreview] = useState<any>(null), [hoverEmailPreview, setHoverEmailPreview] = useState<any>(null), [hoverEmailLoading, setHoverEmailLoading] = useState(false), [hoverEmailName, setHoverEmailName] = useState(''), [hoverEmailVersionId, setHoverEmailVersionId] = useState(''), [hoverEmailPreviewPinned, setHoverEmailPreviewPinned] = useState(false), fitViewRef = useRef<(() => void) | null>(null), hoverPreviewCache = useRef(new Map<string, any>()), hoverPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null), hoverPreviewRequest = useRef(0), applyEmailVersionRef = useRef<(versionId: string) => void>(() => { }), closeEmailPickerRef = useRef<(() => void) | null>(null), seededEmailRef = useRef(false);
    const registerFit = useCallback((fit: () => void) => { fitViewRef.current = fit; }, []);
    const load = useCallback(async () => { seededEmailRef.current = false; const [detail, choices, rules] = await Promise.all([phase3Api<Flow>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}`), phase3Api<Options>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/builder-options`), phase3Api<RuleOptions>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/rule-options`)]); setFlow(detail); setGraph(normalizeEntryPolicy(structuredClone(detail.draftGraph))); setOptions(choices); setRuleOptions(rules); setIssues(detail.validation?.issues ?? []); setHistory([]); setFuture([]); }, [workspaceId, flowId]);
    useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load Flow.')); }, [load]);
    useEffect(() => { if (!query.trim()) {
        setProfiles([]);
        return;
    } const timer = setTimeout(() => { void phase3Api<{
        items: Profile[];
    }>(`/api/v1/workspaces/${workspaceId}/profiles?limit=10&q=${encodeURIComponent(query)}`).then(result => setProfiles(result.items)).catch(() => setProfiles([])); }, 250); return () => clearTimeout(timer); }, [workspaceId, query]);
    useEffect(() => { if (profileId)
        return; void phase3Api<{
        items: Profile[];
    }>(`/api/v1/workspaces/${workspaceId}/profiles?limit=10`).then(result => { setPreviewProfileId(result.items[0]?.id ?? ''); if (!profileId && result.items[0]?.id)
        setProfileId(result.items[0].id); }).catch(() => setPreviewProfileId('')); }, [workspaceId, profileId]);
    useEffect(() => { if (!graph || !options?.emails?.length || seededEmailRef.current)
        return; const pick = options.emails.find(item => item.preflightState === 'passed') ?? options.emails[0]; if (!pick || !graph.nodes.some(node => node.type === 'email' && !node.emailVersionId))
        return; seededEmailRef.current = true; setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.type === 'email' && !node.emailVersionId ? { ...node, emailVersionId: pick.id } : node) })); }, [graph, options]);
    useEffect(() => () => { if (hoverPreviewTimer.current)
        clearTimeout(hoverPreviewTimer.current); }, []);
    const dirty = useMemo(() => Boolean(flow && graph && JSON.stringify(flow.draftGraph) !== JSON.stringify(graph)), [flow, graph]);
    const liveGraph = useMemo(() => { if (!flow?.activeVersionId || !flow.versions?.length)
        return null; const version = flow.versions.find(item => item.id === flow.activeVersionId); return version?.graphJson ? normalizeEntryPolicy(structuredClone(version.graphJson)) : null; }, [flow]);
    const needsReactivate = useMemo(() => { if (!flow?.activeVersionId || !graph || !liveGraph)
        return false; if (!['active', 'testing', 'paused'].includes(flow.status))
        return false; return triggerKey(graph.trigger) !== triggerKey(liveGraph.trigger) || JSON.stringify(graph) !== JSON.stringify(liveGraph); }, [flow, graph, liveGraph]);
    const liveTriggerLabel = useMemo(() => liveGraph ? triggerSummary(liveGraph.trigger, options) : null, [liveGraph, options]);
    const change = (next: Graph) => { if (graph) {
        setHistory(old => [...old.slice(-39), structuredClone(graph)]);
        setFuture([]);
        setGraph(next);
    } };
    const edit = (fn: (value: Graph) => Graph) => { if (graph)
        change(fn(graph)); };
    const undo = () => { const previous = history.at(-1); if (previous && graph) {
        setFuture(old => [structuredClone(graph), ...old]);
        setHistory(old => old.slice(0, -1));
        setGraph(previous);
    } };
    const redo = () => { const next = future[0]; if (next && graph) {
        setHistory(old => [...old, structuredClone(graph)]);
        setFuture(old => old.slice(1));
        setGraph(next);
    } };
    const newNode = (type: 'delay' | 'wait_until' | 'conditional' | 'email', id: string): Node => type === 'delay' ? { id, type, durationSeconds: 86400 } : type === 'wait_until' ? { id, type, hour: 9, minute: 0 } : type === 'conditional' ? { id, type, rule: structuredClone(eligibility) } : { id, type, emailVersionId: '', mode: flow?.status === 'testing' || graph?.trigger?.type === 'manual_test' ? 'test' : 'live' };
    const add = (type: 'delay' | 'wait_until' | 'conditional' | 'email') => edit(current => { const end = current.nodes.find(node => node.type === 'end'), incoming = end && current.edges.find(edge => edge.to === end.id); if (!end || !incoming)
        return current; const id = `${type}-${Date.now()}`, node = newNode(type, id), edges = current.edges.filter(edge => edge !== incoming); if (type === 'conditional') {
        const noEnd = { id: `end-no-${Date.now()}`, type: 'end' } as Node;
        edges.push({ ...incoming, to: id }, { from: id, to: end.id, outcome: 'yes' }, { from: id, to: noEnd.id, outcome: 'no' });
        return { ...current, nodes: [...current.nodes.filter(item => item.id !== end.id), node, end, noEnd], edges };
    } edges.push({ ...incoming, to: id }, { from: id, to: end.id }); return { ...current, nodes: [...current.nodes.filter(item => item.id !== end.id), node, end], edges }; });
    const addOnBranch = (conditionalId: string, outcome: 'yes' | 'no', type: 'delay' | 'wait_until' | 'conditional' | 'email') => edit(current => { const edge = current.edges.find(item => item.from === conditionalId && item.outcome === outcome); if (!edge)
        return current; const id = `${type}-${Date.now()}`, node = newNode(type, id); return { ...current, nodes: [...current.nodes, node], edges: current.edges.map(item => item === edge ? { ...item, to: id } : item).concat({ from: id, to: edge.to }) }; });
    const insertBetween = (fromId: string, toId: string, outcome: 'yes' | 'no' | undefined, type: 'delay' | 'wait_until' | 'conditional' | 'email') => edit(current => { const edge = current.edges.find(item => item.from === fromId && item.to === toId && item.outcome === outcome); if (!edge)
        return current; const id = `${type}-${Date.now()}`, node = newNode(type, id); return { ...current, nodes: [...current.nodes, node], edges: current.edges.map(item => item === edge ? { ...item, to: id } : item).concat({ from: id, to: toId }) }; });
    const removeNode = (id: string) => edit(current => { const node = current.nodes.find(item => item.id === id); if (!node || node.type === 'end')
        return current; const incoming = current.edges.filter(edge => edge.to === id), outgoing = current.edges.filter(edge => edge.from === id), untouched = current.edges.filter(edge => edge.to !== id && edge.from !== id), bypass = incoming.flatMap(entry => outgoing.map(exit => ({ from: entry.from, to: exit.to, outcome: entry.outcome ?? exit.outcome }))), edges = [...untouched, ...bypass].filter((edge, index, all) => edge.from !== edge.to && all.findIndex(candidate => candidate.from === edge.from && candidate.to === edge.to && candidate.outcome === edge.outcome) === index); return { ...current, nodes: current.nodes.filter(item => item.id !== id), edges }; });
    const save = async () => { if (!flow || !graph)
        return false; setBusy(true); try {
        const normalized = normalizeEntryPolicy(graph);
        if (normalized !== graph)
            setGraph(normalized);
        const saved = await phase3Api<Flow>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify({ graph: normalized, rowVersion: flow.rowVersion }) });
        setFlow(old => ({ ...old!, ...saved, versions: old?.versions, validation: null }));
        setGraph(structuredClone(saved.draftGraph));
        setIssues([]);
        setHistory([]);
        setFuture([]);
        setMessage('Draft saved. Validate this revision before publishing.');
        return true;
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Save conflict. Reload before saving again.');
        return false;
    }
    finally {
        setBusy(false);
    } };
    const validate = async () => { try {
        if (dirty && !(await save()))
            return;
        const result = await phase3Api<{
            state: string;
            issues: Issue[];
        }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/validate`, { method: 'POST', body: '{}' });
        setIssues(result.issues);
        setMessage(result.state === 'passed' ? 'Validation passed for the saved draft.' : `${result.issues.length} issue(s) need attention.`);
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Validation failed.');
    } };
    const publish = async () => { try {
        if (dirty)
            throw new Error('Save the current draft before publishing.');
        const result = await phase3Api<any>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/publish`, { method: 'POST', body: JSON.stringify({ rowVersion: flow?.rowVersion }) });
        setMessage(`Published immutable version v${result.versionNumber}. Review activation separately.`);
        await load();
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to publish.');
    } };
    const simulate = async () => { try {
        if (!profileId)
            throw new Error('Select a workspace Profile for simulation.');
        setSimulation(await phase3Api<any>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/simulate`, { method: 'POST', body: JSON.stringify({ profileId }) }));
        setMessage('Simulation is side-effect free: no Runs, Messages, provider calls, or frequency usage.');
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } };
    const previewEmailVersion = async (versionId: string) => { try {
        const effectiveProfileId = profileId || previewProfileId;
        if (!effectiveProfileId)
            throw new Error('Select a workspace Profile before previewing a pinned Email version.');
        setEmailPreview(await phase3Api<any>(`/api/v1/workspaces/${workspaceId}/email-versions/${versionId}/preview`, { method: 'POST', body: JSON.stringify({ profileId: effectiveProfileId }) }));
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to preview the pinned Email version.');
    } };
    const loadEmailVersionPreview = useCallback((versionId: string, { immediate = false, pin = false }: {
        immediate?: boolean;
        pin?: boolean;
    } = {}) => { const email = options?.emails.find(item => item.id === versionId); if (!email)
        return; const run = () => { const effectiveProfileId = profileId || previewProfileId; if (!effectiveProfileId) {
        setHoverEmailName(email.name);
        setHoverEmailPreview(null);
        setHoverEmailLoading(false);
        if (pin) {
            setHoverEmailVersionId(versionId);
            setHoverEmailPreviewPinned(true);
        }
        return;
    } const cached = hoverPreviewCache.current.get(versionId); setHoverEmailVersionId(versionId); setHoverEmailName(email.name); if (pin)
        setHoverEmailPreviewPinned(true); if (cached) {
        setHoverEmailPreview(cached);
        setHoverEmailLoading(false);
        return;
    } const requestId = ++hoverPreviewRequest.current; setHoverEmailLoading(true); setHoverEmailPreview(null); void phase3Api<any>(`/api/v1/workspaces/${workspaceId}/email-versions/${versionId}/preview`, { method: 'POST', body: JSON.stringify({ profileId: effectiveProfileId }) }).then(result => { if (hoverPreviewRequest.current !== requestId)
        return; hoverPreviewCache.current.set(versionId, result); setHoverEmailPreview(result); setHoverEmailLoading(false); }).catch(() => { if (hoverPreviewRequest.current !== requestId)
        return; setHoverEmailLoading(false); }); }; if (hoverPreviewTimer.current) {
        clearTimeout(hoverPreviewTimer.current);
        hoverPreviewTimer.current = null;
    } if (immediate)
        run();
    else
        hoverPreviewTimer.current = setTimeout(run, 220); }, [options?.emails, previewProfileId, profileId, workspaceId]);
    const dismissHoverEmailPreview = useCallback(() => { if (hoverPreviewTimer.current) {
        clearTimeout(hoverPreviewTimer.current);
        hoverPreviewTimer.current = null;
    } setHoverEmailLoading(false); setHoverEmailPreview(null); setHoverEmailName(''); setHoverEmailVersionId(''); setHoverEmailPreviewPinned(false); }, []);
    const clearHoverEmailPreview = useCallback(() => { if (hoverEmailPreviewPinned)
        return; dismissHoverEmailPreview(); }, [dismissHoverEmailPreview, hoverEmailPreviewPinned]);
    const requestHoverEmailPreview = useCallback((versionId: string) => { loadEmailVersionPreview(versionId, { immediate: hoverEmailPreviewPinned, pin: hoverEmailPreviewPinned }); }, [hoverEmailPreviewPinned, loadEmailVersionPreview]);
    const pickEmailVersionPreview = useCallback((versionId: string) => { loadEmailVersionPreview(versionId, { immediate: true, pin: true }); }, [loadEmailVersionPreview]);
    const useHoverEmailPreview = useCallback(() => { if (!hoverEmailVersionId)
        return; applyEmailVersionRef.current(hoverEmailVersionId); closeEmailPickerRef.current?.(); dismissHoverEmailPreview(); }, [dismissHoverEmailPreview, hoverEmailVersionId]);
    const openReview = async () => { try {
        if (dirty && !(await save()))
            return;
        setReview(await phase3Api<any>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/activation-review`));
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to load activation review.');
    } };
    const startTestRun = async (testProfileId = profileId) => { if (!testProfileId) {
        setMessage('Select a workspace profile before starting a test run.');
        return null;
    } try {
        const result = await phase3Api<{
            entered: boolean;
            reason?: string;
        }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/test-entry`, { method: 'POST', body: JSON.stringify({ profileId: testProfileId }) });
        return result;
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start a test run.');
        return null;
    } };
    const activate = async (mode: 'testing' | 'production', testProfileId = profileId) => { if (!flow || !graph)
        throw new Error('Flow not loaded.'); setBusy(true); try {
        let working = prepareEmailModes(normalizeEntryPolicy(graph), mode);
        if (JSON.stringify(working) !== JSON.stringify(graph))
            setGraph(working);
        const saved = await phase3Api<Flow>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify({ graph: working, rowVersion: flow.rowVersion }) });
        setFlow(old => ({ ...old!, ...saved, versions: old?.versions }));
        setGraph(structuredClone(saved.draftGraph));
        const validation = await phase3Api<{
            state: string;
            issues: Issue[];
        }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/validate`, { method: 'POST', body: '{}' });
        setIssues(validation.issues);
        if (validation.state === 'blocking')
            throw new Error(`${validation.issues.length} issue(s) must be fixed before activation.`);
        const version = await phase3Api<any>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/publish`, { method: 'POST', body: JSON.stringify({ rowVersion: saved.rowVersion }) });
        await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/activate`, { method: 'POST', body: JSON.stringify({ versionId: version.id, mode: mode === 'testing' ? 'testing' : 'production' }) });
        if (mode === 'testing') {
            if (!testProfileId)
                throw new Error('Select a workspace profile to send the test email.');
            const result = await startTestRun(testProfileId);
            setReview(null);
            setMessage(result?.entered ? `Test activation started for v${version.versionNumber}. Open Activity → Messages and wait for submitted. If it stays held, restart the API and worker, then try again.` : `Testing activated on v${version.versionNumber}, but this profile did not enter: ${result?.reason ?? 'blocked by entry filters'}.`);
        }
        else {
            setReview(null);
            setMessage(`Production activated on v${version.versionNumber}.`);
        }
        await load();
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Activation failed.');
    }
    finally {
        setBusy(false);
    } };
    const pauseFlow = async () => { setBusy(true); try {
        await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/pause`, { method: 'POST', body: JSON.stringify({ mode: 'pause_future_actions' }) });
        setMessage('Flow paused. New entries and scheduled actions are stopped.');
        await load();
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to pause flow.');
    }
    finally {
        setBusy(false);
    } };
    const resumeFlow = async () => { setBusy(true); try {
        await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/resume`, { method: 'POST', body: JSON.stringify({ overduePolicy: 'immediate' }) });
        setMessage('Flow resumed.');
        await load();
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to resume flow.');
    }
    finally {
        setBusy(false);
    } };
    const applyLiveChanges = async () => { if (!flow)
        return; const mode = flow.status === 'testing' ? 'testing' : 'production'; try {
        await activate(mode, mode === 'testing' ? profileId : undefined);
        if (mode === 'production')
            setMessage('Changes applied. New contacts on your selected list will enter this flow.');
        else
            setMessage('Changes applied to the testing flow.');
    }
    catch { /* activate sets message */ } };
    if (!flow || !graph)
        return <section className="panel flow-loading"><p>Loading Flow…</p>{message && <p role="status">{message}</p>}</section>;
    const selectedNode = selected === 'trigger' ? null : graph.nodes.find(node => node.id === selected);
    const selectedIssues = issues.filter(issue => issue.nodeId === selected || (selected === 'trigger' && issue.field === 'trigger'));
    const isLive = flow.status === 'active' || flow.status === 'testing';
    const statusPrefix = flow.status === 'active' ? 'Live · ' : flow.status === 'testing' ? 'Testing · ' : flow.status === 'paused' ? 'Paused · ' : '';
    const draftTriggerLabel = triggerSummary(graph.trigger, options);
    const setTrigger = (type: string) => edit(current => applyTriggerDefaults({ ...current, trigger: type === 'list_joined' ? { type, listId: '', enrollmentMode: 'future_only' } : type === 'segment_entered' ? { type, segmentId: '' } : type === 'generic_event' ? { type, eventName: '', schemaVersion: 1 } : type === 'profile_date' ? { type, field: '', hour: 9, minute: 0, timezonePolicy: 'profile_then_workspace' } : type === 'manual_test' ? { type } : { type: 'unconfigured' } }, type));
    return <div className="flow-builder">{needsReactivate && flow.activeVersionId && <section className="panel flow-live-drift-banner"><div className="panel-heading"><div><h2>Live version is out of date</h2><p className="panel-subtitle">Live trigger: <strong>{liveTriggerLabel ?? 'Unknown'}</strong> · Draft trigger: <strong>{draftTriggerLabel}</strong>. Saving alone does not update live routing. Click <strong>Apply changes</strong> to publish and re-activate so new list members enter this flow.</p></div><button type="button" className="button-primary" onClick={() => void applyLiveChanges()} disabled={busy}>Apply changes</button></div></section>}{flow.status === 'testing' && <section className="panel flow-testing-banner" style={{ margin: '0 0 16px', padding: 16 }}><div className="panel-heading"><div><h2>Testing is active</h2><p className="panel-subtitle">Pick a profile and send another test run. Messages are analytics-excluded.</p></div><a className="panel-link" href={`/w/${workspaceId}/flows/${flowId}/runs`}>Open Activity</a></div><label>Search workspace profiles<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or email"/></label>{profiles.length > 0 && <select value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Select profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select>}<button type="button" className="button-primary" onClick={() => void startTestRun().then(result => result && setMessage(result.entered ? 'Test run queued. Open Activity → Messages and confirm the row reaches submitted. Held means the email never left the platform.' : `Test run did not enter: ${result.reason ?? 'blocked by entry filters'}.`))} disabled={!profileId || busy}>Send another test</button></section>}<header className="flow-builder-header"><a href={`/w/${workspaceId}/flows`} className="flow-back">← Flows</a><div><h1>{flow.name}</h1><p>{statusPrefix}{dirty ? 'Unsaved draft' : 'Draft saved'} · {flow.activeVersionId ? `Live v${flow.versions?.find(version => version.id === flow.activeVersionId)?.versionNumber ?? '?'} · ${liveTriggerLabel ?? 'trigger'}` : 'No active version'}{graph.trigger.type === 'list_joined' && graph.trigger.listId && !needsReactivate ? ` · List: ${draftTriggerLabel}` : ''}</p></div><div className="flow-lifecycle">Configure <i>→</i> Validate <i>→</i> {isLive ? (flow.status === 'testing' ? 'Testing active' : 'Activated') : 'Activate'}</div><FlowHeaderActions flow={flow} busy={busy} history={history} future={future} dirty={dirty} needsReactivate={needsReactivate} onUndo={undo} onRedo={redo} onSave={() => void save()} onValidate={() => void validate()} onActivate={() => void openReview()} onApplyChanges={() => void applyLiveChanges()} onPause={() => void pauseFlow()} onResume={() => void resumeFlow()}/></header><div className="flow-builder-main"><aside className="flow-palette"><strong>Node palette</strong><span>Add a step before End</span><button type="button" onClick={() => add('email')}>✉ Email</button><button type="button" onClick={() => add('delay')}>◷ Delay</button><button type="button" onClick={() => add('wait_until')}>◷ Wait until</button><button type="button" onClick={() => add('conditional')}>◇ Conditional split</button><small>Execution order comes from graph connections, never coordinates.</small></aside><main className="flow-workspace"><div className="flow-workspace-toolbar"><div><button type="button" className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>Canvas</button><button type="button" className={view === 'structure' ? 'active' : ''} onClick={() => setView('structure')}>Accessible structure</button></div><div><button type="button" onClick={() => setZoom(value => Math.max(40, value - 10))}>−</button><span>{zoom}%</span><button type="button" onClick={() => setZoom(value => Math.min(160, value + 10))}>+</button><button type="button" onClick={() => fitViewRef.current?.()}>Fit</button></div></div>{view === 'canvas' ? <Canvas graph={graph} options={options} issues={issues} selected={selected} onSelect={setSelected} onInsert={(fromId, toId, outcome, type) => insertBetween(fromId, toId, outcome, type)} onMove={(id, position) => edit(current => ({ ...current, layout: { ...current.layout, [id]: position } }))} zoom={zoom} onZoomChange={setZoom} pan={pan} onPanChange={setPan} fitKey={flow.id} onRegisterFit={registerFit}/> : <ol className="flow-outline"><li><button type="button" className={selected === 'trigger' ? 'selected' : ''} onClick={() => setSelected('trigger')}><strong>1. Trigger</strong><span>{triggerSummary(graph.trigger, options)}</span></button></li>{graph.nodes.map((node, index) => <li key={node.id}><button type="button" className={selected === node.id ? 'selected' : ''} onClick={() => setSelected(node.id)}><strong>{index + 2}. {label(node.type)}</strong><span>{nodeSummary(node, options)}</span>{node.type === 'conditional' && <small>Yes / No branches</small>}</button></li>)}</ol>}{simulation && <section className="flow-simulation"><strong>Simulation trace</strong><small>Selected Profile · no production records created</small>{simulation.variables && <p className="flow-contract">Variables: {Object.entries(simulation.variables.profile ?? {}).filter(([, value]) => value !== null).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No displayable profile values'}</p>}{simulation.entry?.allowed === false ? <p>Entry filters blocked this Profile.</p> : <ol>{simulation.steps.map((step: any) => <li key={step.nodeId}><b>{label(step.type)}</b><span>{new Date(step.at).toLocaleString()} {step.detail.result === true ? '· YES' : step.detail.result === false ? '· NO' : ''} {step.detail.policyForecast ? `· policy ${step.detail.policyForecast}` : ''}</span></li>)}</ol>}<small>{simulation.policyOutcome ?? 'The canonical Message Policy is checked before any send.'}</small></section>}</main><aside className="flow-inspector"><div className="flow-inspector-heading"><div><small>Inspector</small><h2>{selected === 'trigger' ? 'Trigger' : selectedNode ? label(selectedNode.type) : 'Select a node'}</h2></div>{selectedIssues.length > 0 && <span className="pill pill-danger">{selectedIssues.length} issue{selectedIssues.length === 1 ? '' : 's'}</span>}</div>{selected === 'trigger' ? <TriggerInspector graph={graph} options={options} ruleOptions={ruleOptions} setTrigger={setTrigger} edit={edit}/> : <NodeInspector node={selectedNode} options={options} ruleOptions={ruleOptions} workspaceId={workspaceId} profileId={profileId} preview={previewEmailVersion} onHoverEmailVersion={requestHoverEmailPreview} onLeaveEmailVersion={clearHoverEmailPreview} onPickEmailVersion={pickEmailVersionPreview} hoverEmailVersionId={hoverEmailVersionId} registerEmailVersionApply={apply => { applyEmailVersionRef.current = apply; }} registerEmailPickerClose={close => { closeEmailPickerRef.current = close; }} addOnBranch={addOnBranch} edit={edit}/>} {selectedNode && selectedNode.type !== 'end' && <button type="button" className="flow-delete-node" onClick={() => { removeNode(selectedNode.id); setSelected('trigger'); }}>Delete {label(selectedNode.type)} node</button>}{selectedNode?.type === 'end' && <p className="flow-node-protected">End is required and cannot be removed.</p>}<section className="flow-simulate-panel"><h3>Simulation</h3><label>Search workspace Profiles<input value={query} placeholder="Search name or email" onChange={event => setQuery(event.target.value)}/></label>{profiles.length > 0 && <select value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Select Profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select>}<button type="button" onClick={() => void simulate()} disabled={!profileId}>Run safe simulation</button></section><section className="flow-operations"><h3>Flow actions</h3><button type="button" onClick={() => void openReview()} disabled={!flow.versions?.length}>Review activation</button><a href={`/w/${workspaceId}/flows/${flowId}/runs`}>Monitor runs</a></section></aside></div><footer className="flow-builder-footer"><div><strong>{issues.filter(issue => issue.severity === 'blocking').length} blocking</strong><span>{issues.filter(issue => issue.severity === 'warning').length} warnings</span>{issues.map((issue, index) => <button type="button" key={`${issue.code}-${index}`} onClick={() => setSelected(issue.nodeId ?? 'trigger')}>{issue.code}: {issue.message}</button>)}</div><span>Canvas and accessible structure use the same draft graph.</span></footer>{message && <p className="flow-message" role="status">{message}</p>}{review && <ActivationReview review={review} close={() => setReview(null)} activate={activate} profileId={profileId} profiles={profiles} query={query} setQuery={setQuery} setProfileId={setProfileId} busy={busy}/>}<EmailHoverPreview preview={hoverEmailPreview} loading={hoverEmailLoading} emailName={hoverEmailName} pinned={hoverEmailPreviewPinned} onUse={useHoverEmailPreview} onClose={dismissHoverEmailPreview}/>{emailPreview && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pinned Email version preview"><section className="modal-card"><div className="modal-head"><h2>Published Email version preview</h2><button type="button" onClick={() => setEmailPreview(null)}>×</button></div><p><strong>{emailPreview.source?.emailDefinitionId}</strong> · v{emailPreview.source?.versionNumber} · selected Profile preview</p><p>{emailPreview.subject}</p><iframe title="Pinned Email version preview" sandbox="" srcDoc={emailPreview.html} style={{ width: '100%', minHeight: 360, border: '1px solid var(--border-subtle)' }}/><details><summary>Plain text</summary><pre>{emailPreview.text}</pre></details></section></div>}</div>;
}
function TriggerInspector({ graph, options, ruleOptions, setTrigger, edit }: {
    graph: Graph;
    options: Options | null;
    ruleOptions: RuleOptions | null;
    setTrigger: (type: string) => void;
    edit: (fn: (value: Graph) => Graph) => void;
}) { return <><label>Trigger type<select value={graph.trigger.type ?? 'unconfigured'} onChange={event => setTrigger(event.target.value)}><option value="manual_test">Manual test (recommended for testing)</option><option value="list_joined">List joined</option><option value="segment_entered">Segment entered</option><option value="generic_event">Generic event</option><option value="profile_date">Profile date</option></select></label>{graph.trigger.type === 'list_joined' && <label>List<select value={graph.trigger.listId} onChange={event => edit(current => ({ ...current, trigger: { ...current.trigger, listId: event.target.value } }))}><option value="">Select a List</option>{options?.lists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{graph.trigger.type === 'segment_entered' && <label>Segment<select value={graph.trigger.segmentId} onChange={event => edit(current => ({ ...current, trigger: { ...current.trigger, segmentId: event.target.value } }))}><option value="">Select a Segment</option>{options?.segments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{graph.trigger.type === 'generic_event' && <label>Event schema<select value={`${graph.trigger.eventName}|${graph.trigger.schemaVersion}`} onChange={event => { const [eventName, schemaVersion] = event.target.value.split('|'); edit(current => ({ ...current, trigger: { type: 'generic_event', eventName, schemaVersion: Number(schemaVersion) } })); }}><option value="|1">Select an event</option>{options?.events.map(item => <option key={`${item.eventName}|${item.schemaVersion}`} value={`${item.eventName}|${item.schemaVersion}`}>{item.eventName} · v{item.schemaVersion}</option>)}</select></label>}{graph.trigger.type === 'profile_date' && <><label>Profile date property<input value={graph.trigger.field} placeholder="e.g. renewal_date" onChange={event => edit(current => ({ ...current, trigger: { ...current.trigger, field: event.target.value } }))}/></label><label>Time<input type="time" value={`${String(graph.trigger.hour ?? 9).padStart(2, '0')}:${String(graph.trigger.minute ?? 0).padStart(2, '0')}`} onChange={event => { const [hour, minute] = event.target.value.split(':').map(Number); edit(current => ({ ...current, trigger: { ...current.trigger, hour, minute } })); }}/></label><small>Profile timezone, with workspace timezone fallback. The scheduler will create future one-time entries.</small></>}<p className="flow-contract">{options?.triggerContracts[graph.trigger.type] ?? 'Select a trigger to see its runtime behavior.'}</p>{graph.trigger.type === 'list_joined' && graph.entryPolicy.mode === 'once' && <p className="flow-contract" style={{ borderColor: '#f0ddb0', background: '#fff8eb' }}><strong>Re-entry is set to one time only.</strong> Contacts who already completed this flow will not get another email when re-added to the list. Use <strong>Every confirmed event</strong> below for list triggers.</p>}<details className="flow-advanced-settings"><summary>Advanced settings (optional)</summary><label>Re-entry<select value={graph.entryPolicy.mode} onChange={event => edit(current => ({ ...current, entryPolicy: { mode: event.target.value as Graph['entryPolicy']['mode'], cooldownSeconds: event.target.value === 'cooldown' ? current.entryPolicy.cooldownSeconds ?? 86400 : undefined } }))}><option value="once">One time only</option><option value="once_per_event">Every confirmed event</option><option value="cooldown">Cooldown</option></select></label>{graph.entryPolicy.mode === 'cooldown' && <><label>Cooldown seconds<input type="number" min="60" max="31536000" value={graph.entryPolicy.cooldownSeconds ?? 86400} onChange={event => edit(current => ({ ...current, entryPolicy: { ...current.entryPolicy, cooldownSeconds: Math.max(60, Math.min(31536000, Number(event.target.value) || 86400)) } }))}/></label>{(graph.entryPolicy.cooldownSeconds ?? 86400) < 60 && <small className="flow-contract">Cooldown must be at least 60 seconds. Save will auto-fix this to 60.</small>}</>}<RuleEditor title="Entry filter" options={ruleOptions} value={graph.entryFilters[0] ?? eligibility} onChange={rule => edit(current => ({ ...current, entryFilters: [rule] }))}/><RuleEditor title="Exit rule" options={ruleOptions} value={graph.exitRules[0] ?? eligibility} onChange={rule => edit(current => ({ ...current, exitRules: [rule] }))}/></details></>; }
function NodeInspector({ node, options, ruleOptions, workspaceId, profileId, preview, onHoverEmailVersion, onLeaveEmailVersion, onPickEmailVersion, hoverEmailVersionId, registerEmailVersionApply, registerEmailPickerClose, addOnBranch, edit }: {
    node: Node | null;
    options: Options | null;
    ruleOptions: RuleOptions | null;
    workspaceId: string;
    profileId: string;
    preview: (versionId: string) => Promise<void>;
    onHoverEmailVersion: (versionId: string) => void;
    onLeaveEmailVersion: () => void;
    onPickEmailVersion: (versionId: string) => void;
    hoverEmailVersionId: string;
    registerEmailVersionApply: (apply: (versionId: string) => void) => void;
    registerEmailPickerClose: (close: () => void) => void;
    addOnBranch: (id: string, outcome: 'yes' | 'no', type: 'delay' | 'wait_until' | 'conditional' | 'email') => void;
    edit: (fn: (value: Graph) => Graph) => void;
}) { const [emailPickerOpen, setEmailPickerOpen] = useState(false); if (!node)
    return null; const replace = (patch: Partial<Node>) => edit(current => ({ ...current, nodes: current.nodes.map(item => item.id === node.id ? { ...item, ...patch } : item) })); if (node.type === 'email') {
    const email = options?.emails.find(item => item.id === node.emailVersionId);
    registerEmailVersionApply(versionId => replace({ emailVersionId: versionId }));
    registerEmailPickerClose(() => setEmailPickerOpen(false));
    return <><EmailVersionPicker value={node.emailVersionId ?? ''} emails={options?.emails ?? []} open={emailPickerOpen} onOpenChange={setEmailPickerOpen} onPick={onPickEmailVersion} onHover={onHoverEmailVersion} onLeave={onLeaveEmailVersion} highlightId={hoverEmailVersionId}/><small className="flow-email-hover-hint">Hover to preview · click to keep open · Use to select this template.</small>{email && <section className="flow-contract"><strong>{email.name} · immutable v{email.versionNumber}</strong><small>Preflight: {email.preflightState} · Runtime readiness: {email.readinessState}</small>{email.senderIdentity && <small>Sender identity: {email.senderIdentity.fromName} &lt;{email.senderIdentity.fromEmail}&gt; · pinned by this published Email Version</small>}<p>{email.readinessDetail}</p></section>}<small className="flow-contract">Test activation sets this to Test automatically. Production activation sets Live.</small>{node.emailVersionId && <div className="flow-inline-fields"><button type="button" onClick={() => void preview(node.emailVersionId!)}>Preview pinned version</button><a className="panel-link" href={`/w/${workspaceId}/content/emails/${email?.emailDefinitionId}/edit`}>Open Content</a></div>}{node.emailVersionId && !profileId && <small>Select a workspace Profile below to personalize preview merge tags.</small>}</>;
} if (node.type === 'delay')
    return <label>Wait duration (seconds)<input type="number" min="0" max="31536000" value={node.durationSeconds ?? 0} onChange={event => replace({ durationSeconds: Number(event.target.value) })}/></label>; if (node.type === 'wait_until')
    return <><label>Hour<input type="number" min="0" max="23" value={node.hour ?? 9} onChange={event => replace({ hour: Number(event.target.value) })}/></label><label>Minute<input type="number" min="0" max="59" value={node.minute ?? 0} onChange={event => replace({ minute: Number(event.target.value) })}/></label><p className="flow-contract">Profile timezone first, then Workspace timezone. The runtime records the source and calculated time.</p></>; if (node.type === 'conditional')
    return <><RuleEditor title="Conditional split" options={ruleOptions} value={node.rule ?? eligibility} onChange={rule => replace({ rule })}/><section className="flow-contract"><strong>Branch steps</strong><div className="flow-inline-fields"><span>YES <button type="button" onClick={() => addOnBranch(node.id, 'yes', 'email')}>+ Email</button> <button type="button" onClick={() => addOnBranch(node.id, 'yes', 'delay')}>+ Delay</button></span><span>NO <button type="button" onClick={() => addOnBranch(node.id, 'no', 'email')}>+ Email</button> <button type="button" onClick={() => addOnBranch(node.id, 'no', 'delay')}>+ Delay</button></span></div></section></>; return <p className="flow-contract">End completes the run. It cannot have outgoing connections.</p>; }
function ActivationReview({ review, close, activate, profileId, profiles, query, setQuery, setProfileId, busy }: {
    review: any;
    close: () => void;
    activate: (mode: 'testing' | 'production', profileId?: string) => Promise<void>;
    profileId: string;
    profiles: Profile[];
    query: string;
    setQuery: (value: string) => void;
    setProfileId: (value: string) => void;
    busy: boolean;
}) { const blockers = (review.readiness?.checks ?? []).filter((check: any) => !check.passed); const setupHref = blockers.find((check: any) => check.actionHref)?.actionHref; return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Activation review"><section className="modal-card flow-activation-review"><div className="modal-head"><h2>Activate this flow</h2><button type="button" onClick={close} aria-label="Close activation review">×</button></div><p>One click saves, validates, publishes, and activates. Test activation also sends a test email to the profile you choose.</p><section className="flow-activation-test-profile"><strong>Test recipient</strong><label>Search profiles<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or email"/></label>{profiles.length > 0 && <select value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Select profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select>}<small>The profile must pass your entry filters (for example, subscribed and not suppressed).</small></section><dl><dt>Production readiness</dt><dd>{review.readiness?.ready ? 'Ready' : 'Action required'}</dd></dl>{blockers.length > 0 && <section className="flow-activation-blockers" aria-live="polite"><strong>Before production activation</strong><p>This is a platform safety check, not a problem with the flow design. Test activation remains available after you select a recipient.</p><ul>{blockers.map((check: any) => <li key={check.key}><b>{check.label}</b><span>{check.detail}</span>{check.diagnostic && <code>{check.diagnostic}</code>}</li>)}</ul>{setupHref && <a className="button-secondary" href={setupHref}>Open infrastructure readiness</a>}</section>}<div className="modal-actions"><button type="button" className="button-secondary" disabled={!profileId || busy} title={profileId ? 'Save, validate, publish, activate, and send a test email' : 'Select a profile first'} onClick={() => void activate('testing', profileId)}>{busy ? 'Working…' : 'Start test activation'}</button><button type="button" className="button-primary" disabled={!review.readiness?.ready || busy} title={review.readiness?.ready ? 'Save, validate, publish, and go live' : 'Complete the listed readiness checks first'} onClick={() => void activate('production')}>{busy ? 'Working…' : 'Activate production'}</button></div></section></div>; }
