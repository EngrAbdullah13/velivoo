'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFlowStep, insertFlowStep, removeFlowStep, type EditableStep } from '../../../../../packages/domain/src/phase3/flow-editing';
import type { Connection, Graph, Step, Issue, FlowDetail, BuilderOptions, RuleOptions, Profile, ActivationReview as Review, Simulation, Trigger } from './flow-types';
import { profileName } from './flow-types';
import { FlowCanvas, stepLabels, stepSummary, triggerLabel } from './flow-canvas';
import { FlowRules, RuleEditor, eligibleRule, ruleSentence } from './flow-rule-editor';
import { FlowDialog, FlowIcon, Status, type IconName } from './flow-ui';
import { phase3Api } from '../../lib/phase3-api';
import s from './flows.module.css';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
type InsertTarget = Connection | 'append' | null;
type StepCard = { type: EditableStep; icon: IconName; title: string; description: string };
const stepGroups: { title: string; description: string; cards: StepCard[] }[] = [
  { title: 'Actions', description: 'What the flow does', cards: [{ type: 'email', icon: 'email', title: 'Send email', description: 'Send an approved version' }] },
  { title: 'Timing', description: 'Control when contacts continue', cards: [
    { type: 'delay', icon: 'delay', title: 'Time delay', description: 'Wait minutes, hours, or days' },
    { type: 'wait_until', icon: 'wait_until', title: 'Wait until local time', description: 'Resume in the contact timezone' },
  ] },
  { title: 'Logic', description: 'Build personalized paths', cards: [
    { type: 'conditional', icon: 'conditional', title: 'If / else split', description: 'Branch by profile, audience, behavior, or event' },
  ] },
];
const clone = <T,>(value: T): T => structuredClone(value);
const json = (value: unknown) => JSON.stringify(value);
const statusText = (state: SaveState) => state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'error' ? 'Save failed' : 'All changes saved';
const audienceStartDescription = (graph: Graph) => graph.trigger.type === 'list_joined'
  ? (graph.trigger.enrollmentMode ?? 'existing_and_future') === 'existing_and_future'
    ? 'Existing active members are queued once when you activate production. Future joins enter as they happen.'
    : 'Only contacts who join after production activation enter this flow. Existing members are not enrolled.'
  : graph.trigger.type === 'segment_entered' ? 'Only future confirmed segment entries start a run; existing and stale projected members do not.'
  : graph.trigger.type === 'generic_event' ? 'Only accepted events received after activation can start a run.'
  : graph.trigger.type === 'profile_date' ? 'Future dates are scheduled at the selected local time. Past dates are skipped.'
  : 'Test entries are selected explicitly and never create production messages.';
const triggerName = (trigger: Trigger | null, options: BuilderOptions) => {
  if (!trigger) return 'No live trigger';
  if (trigger.type === 'list_joined') return `List: ${options.lists.find(item => item.id === trigger.listId)?.name ?? 'Unavailable list'}`;
  if (trigger.type === 'segment_entered') return `Segment: ${options.segments.find(item => item.id === trigger.segmentId)?.name ?? 'Unavailable segment'}`;
  if (trigger.type === 'generic_event') return `Event: ${trigger.eventName || 'Not selected'}`;
  if (trigger.type === 'profile_date') return `Date: ${trigger.field || 'Not selected'}`;
  if (trigger.type === 'manual_test') return 'Manual test only';
  return 'Trigger not configured';
};

export function FlowBuilderV2({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [name, setName] = useState('');
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const [ruleOptions, setRuleOptions] = useState<RuleOptions | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState('trigger');
  const [insertTarget, setInsertTarget] = useState<InsertTarget>(null);
  const [zoom, setZoom] = useState(90);
  const [history, setHistory] = useState<Graph[]>([]);
  const [future, setFuture] = useState<Graph[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileQuery, setProfileQuery] = useState('');
  const [profileId, setProfileId] = useState('');
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [panel, setPanel] = useState<'steps' | 'settings' | 'flow'>('steps');
  const graphRef = useRef<Graph | null>(null), flowRef = useRef<FlowDetail | null>(null), nameRef = useRef('');
  const savePromise = useRef<Promise<FlowDetail | null> | null>(null);
  useEffect(() => { graphRef.current = graph; }, [graph]);
  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => { nameRef.current = name; }, [name]);

  const load = useCallback(async () => {
    try {
      const [detail, choices, rules] = await Promise.all([
        phase3Api<FlowDetail>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}`),
        phase3Api<BuilderOptions>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/builder-options`),
        phase3Api<RuleOptions>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/rule-options`),
      ]);
      setFlow(detail); setGraph(clone(detail.draftGraph)); setName(detail.name); setOptions(choices); setRuleOptions(rules);
      setIssues(detail.validation?.issues ?? detail.validation?.issuesJson ?? []); setSaveState('saved'); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load this flow.'); }
  }, [workspaceId, flowId]);
  useEffect(() => { void load(); }, [load]);

  const dirty = Boolean(flow && graph && (json(graph) !== json(flow.draftGraph) || name.trim() !== flow.name));
  const canWrite = flow?.capabilities?.canWrite !== false && flow?.status !== 'archived';
  const selectedNode = selected === 'trigger' ? null : graph?.nodes.find(node => node.id === selected) ?? null;
  const selectedIssues = issues.filter(issue => issue.nodeId === selected || (selected === 'trigger' && (issue.field === 'trigger' || issue.path?.startsWith('trigger'))));

  const change = (next: Graph) => {
    if (!graph || !canWrite) return;
    setHistory(items => [...items.slice(-49), clone(graph)]); setFuture([]); graphRef.current = next; setGraph(next); setSaveState('unsaved'); setSimulation(null);
  };
  const edit = (fn: (current: Graph) => Graph) => { if (graph) change(fn(clone(graph))); };
  const undo = () => { const previous = history.at(-1); if (!previous || !graph) return; setFuture(items => [clone(graph), ...items]); setHistory(items => items.slice(0, -1)); setGraph(clone(previous)); setSaveState('unsaved'); };
  const redo = () => { const next = future[0]; if (!next || !graph) return; setHistory(items => [...items, clone(graph)]); setFuture(items => items.slice(1)); setGraph(clone(next)); setSaveState('unsaved'); };

  const persist = useCallback(async (override?: Graph, overrideName?: string) => {
    if (savePromise.current) return savePromise.current;
    const currentFlow = flowRef.current, snapshot = clone(override ?? graphRef.current!); const snapshotName = (overrideName ?? nameRef.current).trim();
    if (!currentFlow || !snapshot || !snapshotName) return null;
    setSaveState('saving');
    const request = phase3Api<FlowDetail>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify({ graph: snapshot, name: snapshotName, rowVersion: currentFlow.rowVersion }) })
      .then(saved => {
        const graphMatches = json(graphRef.current) === json(snapshot);
        const nameMatches = nameRef.current.trim() === snapshotName;
        flowRef.current = saved;
        setFlow(saved);
        if (graphMatches) { graphRef.current = clone(saved.draftGraph); setGraph(clone(saved.draftGraph)); }
        if (nameMatches) { nameRef.current = snapshotName; setName(snapshotName); }
        setIssues([]);
        setSaveState(graphMatches && nameMatches ? 'saved' : 'unsaved');
        return saved;
      })
      .catch(error => { setSaveState('error'); setMessage(error instanceof Error ? error.message : 'Could not save the flow.'); return null; })
      .finally(() => { savePromise.current = null; });
    savePromise.current = request; return request;
  }, [workspaceId, flowId]);
  const persistLatest = useCallback(async (override?: Graph) => {
    if (savePromise.current) await savePromise.current;
    return persist(override ?? graphRef.current ?? undefined, nameRef.current);
  }, [persist]);
  const moveCanvasNode = (id: string, position: { x: number; y: number }) => {
    if (!graph || !canWrite) return;
    change({ ...graph, layout: { ...graph.layout, [id]: position } });
    void persistLatest();
  };
  useEffect(() => { if (!dirty || !canWrite || saveState === 'saving') return; const timer = setTimeout(() => { void persist(); }, 1400); return () => clearTimeout(timer); }, [dirty, canWrite, graph, name, saveState, persist]);

  useEffect(() => { const timer = setTimeout(() => { void phase3Api<{ items: Profile[] }>(`/api/v1/workspaces/${workspaceId}/profiles?limit=12&q=${encodeURIComponent(profileQuery)}`).then(result => setProfiles(result.items)).catch(() => setProfiles([])); }, 250); return () => clearTimeout(timer); }, [workspaceId, profileQuery]);

  function chooseStep(type: EditableStep, requestedTarget: InsertTarget = insertTarget) {
    if (!graph || !requestedTarget) return;
    let edge: Connection | undefined = requestedTarget === 'append' ? graph.edges.find(item => graph.nodes.find(node => node.id === item.to)?.type === 'end') : requestedTarget;
    if (!edge) edge = graph.edges.at(-1);
    if (!edge) return;
    const node = createFlowStep(type, `${type}-${crypto.randomUUID()}`, flow?.status === 'testing' || graph.trigger.type === 'manual_test');
    change(insertFlowStep(graph, edge, node)); setInsertTarget(null); setSelected(node.id); setPanel('settings');
  }
  function remove(node: Step) { if (!graph || node.type === 'end') return; if (node.type === 'conditional' && !confirm('Delete this split? The Yes path will be kept; steps only reachable on No will be removed.')) return; change(removeFlowStep(graph, node.id)); setSelected('trigger'); setPanel('settings'); }
  function duplicate(node: Step) { if (!graph || node.type === 'end') return; const outgoing = graph.edges.find(edge => edge.from === node.id && (node.type !== 'conditional' || edge.outcome === 'yes')); if (!outgoing) return; const copy = clone(node); copy.id = `${node.type}-${crypto.randomUUID()}`; change(insertFlowStep(graph, outgoing, copy)); setSelected(copy.id); }

  async function validateDraft() {
    const saved = dirty || savePromise.current ? await persistLatest() : flowRef.current; if (!saved) return null;
    try { const result = await phase3Api<{ state: string; issues: Issue[] }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/validate`, { method: 'POST', body: '{}' }); setIssues(result.issues); setMessage(result.state === 'passed' ? 'Everything looks good. This flow is ready to publish.' : `${result.issues.length} item${result.issues.length === 1 ? '' : 's'} need attention.`); return result; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Validation failed.'); return null; }
  }
  async function openActivation() { setBusy(true); try { const validation = await validateDraft(); if (!validation || validation.state === 'blocking') return; const result = await phase3Api<Review>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/activation-review`); setReview(result); } finally { setBusy(false); } }
  async function activate(mode: 'testing' | 'production') {
    if (!graphRef.current || !flowRef.current) return; if (mode === 'testing' && !profileId) { setMessage('Choose a test recipient first.'); return; }
    setBusy(true);
    try {
      if (savePromise.current) await savePromise.current;
      const currentGraph = graphRef.current;
      if (!currentGraph) return;
      const prepared: Graph = { ...currentGraph, nodes: currentGraph.nodes.map(node => node.type === 'email' ? { ...node, mode: mode === 'testing' ? 'test' : 'live' } : node) };
      graphRef.current = prepared; setGraph(prepared); const saved = await persistLatest(prepared); if (!saved) return;
      const validation = await phase3Api<{ state: string; issues: Issue[] }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/validate`, { method: 'POST', body: '{}' }); setIssues(validation.issues); if (validation.state === 'blocking') throw new Error('Fix the blocking items before turning on this flow.');
      const version = await phase3Api<{ id: string; versionNumber: number }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/publish`, { method: 'POST', body: JSON.stringify({ rowVersion: saved.rowVersion }) });
      await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/activate`, { method: 'POST', body: JSON.stringify({ versionId: version.id, mode }) });
      if (mode === 'testing') { const entry = await phase3Api<{ entered: boolean; reason?: string }>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/test-entry`, { method: 'POST', body: JSON.stringify({ profileId }) }); setMessage(entry.entered ? 'Test run started. Follow delivery in Activity → Messages.' : `The selected profile did not enter: ${entry.reason ?? 'entry rules did not match'}.`); }
      else setMessage(`Flow v${version.versionNumber} is live. New qualifying contacts can enter.`);
      setReview(null); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not activate this flow.'); } finally { setBusy(false); }
  }
  async function changeStatus() { if (!flow) return; setBusy(true); try { if (flow.status === 'active' || flow.status === 'testing') await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/pause`, { method: 'POST', body: JSON.stringify({ mode: 'pause_future_actions' }) }); else if (flow.status === 'paused') await phase3Api(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/resume`, { method: 'POST', body: JSON.stringify({ overduePolicy: 'immediate' }) }); else return void openActivation(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change flow status.'); } finally { setBusy(false); } }
  async function simulate() { if (!profileId) return setMessage('Choose a profile for the preview.'); setBusy(true); try { if ((dirty || savePromise.current) && !(await persistLatest())) return; setSimulation(await phase3Api<Simulation>(`/api/v1/workspaces/${workspaceId}/flows/${flowId}/simulate`, { method: 'POST', body: JSON.stringify({ profileId }) })); setMessage('Preview completed without creating runs, messages, or provider calls.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Preview failed.'); } finally { setBusy(false); } }

  if (!flow || !graph || !options || !ruleOptions) return <div className={s.loading}><span/><span/><p>{message || 'Loading flow builder…'}</p></div>;
  const blocking = issues.filter(issue => issue.severity === 'blocking').length;
  const contentChanged = json({ ...graph, layout: undefined }) !== json({ ...flow.draftGraph, layout: undefined });
  const hasPublishedDraftChanges = flow.liveState.hasActiveVersion && (flow.liveState.hasUnpublishedChanges || contentChanged);
  const canPauseCurrentVersion = hasPublishedDraftChanges && (flow.status === 'active' || flow.status === 'testing');
  return <div className={s.builderShell}>
    <header className={s.builderHeader}>
      <a className={s.iconButton} href={`/w/${workspaceId}/flows`} aria-label="Back to flows"><FlowIcon name="back"/></a>
      <div className={s.titleBlock}><input value={name} maxLength={120} disabled={!canWrite} aria-label="Flow name" onChange={event => { setName(event.target.value); setSaveState('unsaved'); }}/><span data-state={saveState}><FlowIcon name={saveState === 'saved' ? 'check' : 'refresh'} size={13}/>{statusText(saveState)}</span></div>
      <nav className={s.editorTabs} aria-label="Flow workspace"><a className={s.activeTab} href={`/w/${workspaceId}/flows/${flowId}/builder`}>Builder</a><a href={`/w/${workspaceId}/flows/${flowId}/runs`}>Activity</a></nav>
      <div className={s.headerActions}><Status value={flow.status}/><button className={s.iconButton} disabled={!history.length || !canWrite} onClick={undo} title="Undo"><FlowIcon name="undo"/></button><button className={s.iconButton} disabled={!future.length || !canWrite} onClick={redo} title="Redo"><FlowIcon name="redo"/></button><button className={s.secondary} disabled={busy} onClick={() => void simulate()}>Preview path</button><button className={s.secondary} disabled={busy} onClick={() => void validateDraft()}>Review</button>{canPauseCurrentVersion && <button className={s.secondary} disabled={busy || !flow.capabilities.canOperate} onClick={() => void changeStatus()}><FlowIcon name="pause"/>Pause live version</button>}<button className={s.primary} disabled={busy || !flow.capabilities.canActivate} onClick={() => void (hasPublishedDraftChanges ? openActivation() : changeStatus())}>{hasPublishedDraftChanges ? 'Review & apply changes' : flow.status === 'active' || flow.status === 'testing' ? <><FlowIcon name="pause"/>Pause</> : flow.status === 'paused' ? <><FlowIcon name="play"/>Resume</> : 'Review & turn on'}</button></div>
    </header>
    {hasPublishedDraftChanges && <section className={s.liveDraftBanner} role="status"><span><FlowIcon name="refresh"/></span><div><strong>Your saved draft is not live</strong><p>Contacts currently enter through v{flow.liveState.activeVersionNumber ?? '?'} using <b>{triggerName(flow.liveState.activeTrigger, options)}</b>. This draft uses <b>{triggerName(graph.trigger, options)}</b>. Review and apply changes to publish a new immutable version.</p>{graph.trigger.type === 'list_joined' && graph.trigger.enrollmentMode === 'future_only' && <small>Future joins only is selected. Contacts already in this list will not be enrolled when you apply the change.</small>}</div><button className={s.primary} disabled={busy || !flow.capabilities.canActivate} onClick={() => void openActivation()}>Review & apply</button></section>}
    <div className={s.builderBody}>
      <aside className={s.stepPanel}><div className={s.panelTabs}><button data-active={panel === 'steps'} onClick={() => setPanel('steps')}>Steps</button><button data-active={panel === 'settings'} onClick={() => setPanel('settings')}>Selected</button><button data-active={panel === 'flow'} onClick={() => setPanel('flow')}>Flow</button></div>{panel === 'steps' ? <><div className={s.panelIntro}><small>BUILD</small><h2>Add a step</h2><p>Choose an action, timing rule, or decision. Use a + on the canvas to place it exactly.</p></div><div className={s.stepGroups}>{stepGroups.map(group => <section key={group.title}><header><strong>{group.title}</strong><small>{group.description}</small></header><div className={s.stepCards}>{group.cards.map(card => <button key={card.type} disabled={!canWrite} onClick={() => chooseStep(card.type, 'append')}><span><FlowIcon name={card.icon}/></span><strong>{card.title}</strong><small>{card.description}</small></button>)}</div></section>)}</div><button className={s.fullSecondary} disabled={!canWrite} onClick={() => setInsertTarget('append')}><FlowIcon name="plus"/> Choose exact position</button></> : panel === 'flow' ? <FlowSettings graph={graph} options={options} ruleOptions={ruleOptions} edit={edit}/> : <SettingsPanel workspaceId={workspaceId} graph={graph} node={selectedNode} selected={selected} options={options} ruleOptions={ruleOptions} issues={selectedIssues} edit={edit} remove={remove} duplicate={duplicate}/>}</aside>
      <main className={s.canvasArea}><div className={s.canvasToolbar}><div><strong>{graph.nodes.length - graph.nodes.filter(node => node.type === 'end').length} steps</strong><span>{blocking ? `${blocking} blocking issue${blocking === 1 ? '' : 's'}` : 'Ready for review'}</span></div><div><button className={s.iconButton} onClick={() => setZoom(value => Math.max(50, value - 10))}>−</button><span>{zoom}%</span><button className={s.iconButton} onClick={() => setZoom(value => Math.min(130, value + 10))}>+</button><button className={s.secondary} onClick={() => setZoom(90)}>Reset</button></div></div><FlowCanvas graph={graph} options={options} issues={issues} selected={selected} onSelect={id => { setSelected(id); setPanel('settings'); }} onInsert={edge => setInsertTarget(edge)} onMove={moveCanvasNode} zoom={zoom} readOnly={!canWrite}/>{simulation && <SimulationTray simulation={simulation} options={options} graph={graph} close={() => setSimulation(null)}/>}</main>
    </div>
    {issues.length > 0 && <aside className={s.issueBar}><strong>{blocking ? `${blocking} blockers` : 'Recommendations'}</strong>{issues.slice(0, 4).map((issue, index) => <button key={`${issue.code}-${index}`} onClick={() => { setSelected(issue.nodeId ?? 'trigger'); setPanel('settings'); }}>{issue.message}</button>)}</aside>}
    {message && <div className={s.toast} role="status"><span>{message}</span><button aria-label="Dismiss" onClick={() => setMessage('')}><FlowIcon name="close" size={15}/></button></div>}
    {insertTarget && <StepPicker close={() => setInsertTarget(null)} choose={chooseStep}/>} {review && <ActivationDialog updating={flow.liveState.hasActiveVersion} review={review} graph={graph} profiles={profiles} query={profileQuery} profileId={profileId} busy={busy} setQuery={setProfileQuery} setProfileId={setProfileId} close={() => setReview(null)} activate={activate}/>} 
  </div>;
}

function StepPicker({ close, choose }: { close: () => void; choose: (type: EditableStep) => void }) { return <FlowDialog title="What happens next?" close={close}><p className={s.dialogLead}>Add one functional action, timing rule, or decision to this connection.</p>{stepGroups.map(group => <section className={s.pickerSection} key={group.title}><header><strong>{group.title}</strong><small>{group.description}</small></header><div className={s.pickerGrid}>{group.cards.map(card => <button key={card.type} onClick={() => choose(card.type)}><span><FlowIcon name={card.icon}/></span><div><strong>{card.title}</strong><small>{card.description}</small></div><FlowIcon name="plus"/></button>)}</div></section>)}</FlowDialog>; }

function SettingsPanel({ workspaceId, graph, node, selected, options, ruleOptions, issues, edit, remove, duplicate }: { workspaceId: string; graph: Graph; node: Step | null; selected: string; options: BuilderOptions; ruleOptions: RuleOptions; issues: Issue[]; edit: (fn: (graph: Graph) => Graph) => void; remove: (node: Step) => void; duplicate: (node: Step) => void }) {
  const replaceNode = (next: Step) => edit(current => ({ ...current, nodes: current.nodes.map(item => item.id === next.id ? next : item) }));
  return <div className={s.settingsPanel}><div className={s.panelIntro}><small>{selected === 'trigger' ? 'START' : 'STEP SETTINGS'}</small><h2>{selected === 'trigger' ? 'Trigger' : node ? stepLabels[node.type] : 'Select a step'}</h2><p>{selected === 'trigger' ? 'Choose who enters and when.' : node ? stepSummary(node, options) : 'Click a card on the canvas to edit it.'}</p></div>{issues.length > 0 && <div className={s.inlineIssues}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div>}{selected === 'trigger' ? <TriggerSettings graph={graph} options={options} edit={edit}/> : node ? <NodeSettings workspaceId={workspaceId} node={node} options={options} ruleOptions={ruleOptions} replace={replaceNode}/> : null}{node && node.type !== 'end' && <div className={s.stepActions}><button className={s.secondary} onClick={() => duplicate(node)}><FlowIcon name="copy"/>Duplicate</button><button className={s.danger} onClick={() => remove(node)}><FlowIcon name="trash"/>Delete</button></div>}</div>;
}

function TriggerSettings({ graph, options, edit }: { graph: Graph; options: BuilderOptions; edit: (fn: (graph: Graph) => Graph) => void }) {
  const setType = (type: string) => edit(current => ({ ...current, trigger: type === 'list_joined' ? { type, listId: '', enrollmentMode: 'existing_and_future' } : type === 'segment_entered' ? { type, segmentId: '' } : type === 'generic_event' ? { type, eventName: '', schemaVersion: 1 } : type === 'profile_date' ? { type, field: '', hour: 9, minute: 0, timezonePolicy: 'profile_then_workspace' } : { type: 'manual_test' }, entryPolicy: { mode: type === 'manual_test' ? 'once' : 'once_per_event' } }));
  return <div className={s.formStack}><label>Start this flow when<select value={graph.trigger.type === 'unconfigured' ? '' : graph.trigger.type} onChange={event => setType(event.target.value)}><option value="" disabled>Choose a trigger</option><option value="list_joined">Contact joins a list</option><option value="segment_entered">Contact enters a segment</option><option value="generic_event">An event happens</option><option value="profile_date">A date property occurs</option><option value="manual_test">Manual test only</option></select></label>
    {graph.trigger.type === 'list_joined' && <><label>List<select value={graph.trigger.listId} onChange={e => edit(current => ({ ...current, trigger: { type: 'list_joined', listId: e.target.value, enrollmentMode: graph.trigger.type === 'list_joined' ? graph.trigger.enrollmentMode ?? 'existing_and_future' : 'future_only' } }))}><option value="">Choose list</option>{options.lists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Members to enroll<select value={graph.trigger.enrollmentMode ?? 'existing_and_future'} onChange={e => edit(current => ({ ...current, trigger: { ...graph.trigger, enrollmentMode: e.target.value as 'future_only' | 'existing_and_future' } }))}><option value="future_only">Future joins only</option><option value="existing_and_future">Existing members + future joins</option></select></label></>}
    {graph.trigger.type === 'segment_entered' && <label>Segment<select value={graph.trigger.segmentId} onChange={e => edit(current => ({ ...current, trigger: { type: 'segment_entered', segmentId: e.target.value } }))}><option value="">Choose segment</option>{options.segments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {graph.trigger.type === 'generic_event' && <label>Event<select value={`${graph.trigger.eventName}|${graph.trigger.schemaVersion}`} onChange={e => { const [eventName, version] = e.target.value.split('|'); edit(current => ({ ...current, trigger: { type: 'generic_event', eventName, schemaVersion: Number(version) } })); }}><option value="|1">Choose event</option>{options.events.map(event => <option key={`${event.eventName}-${event.schemaVersion}`} value={`${event.eventName}|${event.schemaVersion}`}>{event.eventName} · v{event.schemaVersion}</option>)}</select></label>}
    {graph.trigger.type === 'profile_date' && <><label>Date property<select value={graph.trigger.field} onChange={e => edit(current => ({ ...current, trigger: { ...graph.trigger, field: e.target.value } }))}><option value="">Choose property</option>{options.dateProperties.map(item => <option key={item.key} value={item.key}>{item.displayName}</option>)}</select></label><div className={s.twoFields}><label>Hour<input type="number" min={0} max={23} value={graph.trigger.hour} onChange={e => edit(current => ({ ...current, trigger: { ...graph.trigger, hour: Number(e.target.value) } }))}/></label><label>Minute<input type="number" min={0} max={59} value={graph.trigger.minute} onChange={e => edit(current => ({ ...current, trigger: { ...graph.trigger, minute: Number(e.target.value) } }))}/></label></div></>}
    <div className={s.contract}><strong>{triggerLabel(graph, options)}</strong><span>{graph.trigger.type === 'list_joined' ? audienceStartDescription(graph) : options.triggerContracts[graph.trigger.type] ?? 'Configure a trigger to describe entry behaviour.'}</span></div>
  </div>;
}

function FlowSettings({ graph, options, ruleOptions, edit }: { graph: Graph; options: BuilderOptions; ruleOptions: RuleOptions; edit: (fn: (graph: Graph) => Graph) => void }) {
  const population = audienceStartDescription(graph);
  return <div className={s.settingsPanel}><div className={s.panelIntro}><small>FLOW CONTROLS</small><h2>Audience & delivery</h2><p>Control repeat entry, global filters, exits, and how messages leave the queue.</p></div><div className={s.formStack}>
    <div className={s.queueCard}><span><FlowIcon name="email"/></span><div><strong>{options.deliveryPacing?.ratePerSecond ?? 1} email per second</strong><small>Persistent workspace queue. Extra messages wait safely in Redis and keep their database state until their turn.</small></div></div>
    <div className={s.contract}><strong>Audience start behavior</strong><span>{population}</span></div>
    <label>Allow a contact to enter<select value={graph.entryPolicy.mode} onChange={e => edit(current => ({ ...current, entryPolicy: e.target.value === 'cooldown' ? { mode: 'cooldown', cooldownSeconds: 86400 } : { mode: e.target.value as 'once' | 'once_per_event' } }))}><option value="once">Only once ever</option><option value="once_per_event">Every qualifying event</option><option value="cooldown">Again after a cooldown</option></select></label>
    {graph.entryPolicy.mode === 'cooldown' && <label>Cooldown (hours)<input type="number" min={1} max={8760} value={Math.round((graph.entryPolicy.cooldownSeconds ?? 86400) / 3600)} onChange={e => edit(current => ({ ...current, entryPolicy: { mode: 'cooldown', cooldownSeconds: Math.max(3600, Number(e.target.value) * 3600) } }))}/></label>}
    <FlowRules title="Entry filters" rules={graph.entryFilters} options={ruleOptions} onChange={rules => edit(current => ({ ...current, entryFilters: rules }))}/>
    <FlowRules title="Exit rules" rules={graph.exitRules} options={ruleOptions} onChange={rules => edit(current => ({ ...current, exitRules: rules }))}/>
    <div className={s.contract}><strong>Published versions stay immutable</strong><span>Running contacts continue on the version they entered. New edits apply only after the next review and activation.</span></div>
  </div></div>;
}

function NodeSettings({ workspaceId, node, options, ruleOptions, replace }: { workspaceId: string; node: Step; options: BuilderOptions; ruleOptions: RuleOptions; replace: (node: Step) => void }) {
  if (node.type === 'email') { const selected = options.emails.find(email => email.id === node.emailVersionId); return <div className={s.formStack}><label>Approved email<select value={node.emailVersionId} onChange={e => replace({ ...node, emailVersionId: e.target.value })}><option value="">Choose published email</option>{options.emails.map(email => <option key={email.id} value={email.id}>{email.name} · v{email.versionNumber}</option>)}</select></label>{selected && <div className={s.contract} data-state={selected.readinessState}><strong>{selected.name} · immutable v{selected.versionNumber}</strong><span>Preflight: {selected.preflightState} · Delivery: {selected.readinessState.replaceAll('_', ' ')}</span><span>{selected.readinessDetail}</span><a href={`/w/${workspaceId}/content/emails/${selected.emailDefinitionId}/edit`}>Open email content ↗</a></div>}<p className={s.hint}>Test or live mode is set safely when you activate the flow.</p></div>; }
  if (node.type === 'delay') { const unit = node.durationSeconds >= 86400 && node.durationSeconds % 86400 === 0 ? 'days' : node.durationSeconds >= 3600 && node.durationSeconds % 3600 === 0 ? 'hours' : 'minutes', multiplier = unit === 'days' ? 86400 : unit === 'hours' ? 3600 : 60, value = Math.max(1, node.durationSeconds / multiplier); return <div className={s.formStack}><div className={s.twoFields}><label>Wait<input type="number" min={1} value={value} onChange={e => replace({ ...node, durationSeconds: Math.max(60, Number(e.target.value) * multiplier) })}/></label><label>Unit<select value={unit} onChange={e => { const nextMultiplier = e.target.value === 'days' ? 86400 : e.target.value === 'hours' ? 3600 : 60; replace({ ...node, durationSeconds: Math.max(60, value * nextMultiplier) }); }}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label></div><div className={s.contract}><strong>Contacts wait before continuing</strong><span>Scheduled actions use the saved flow version and resume automatically after the exact delay.</span></div></div>; }
  if (node.type === 'wait_until') return <div className={s.formStack}><div className={s.twoFields}><label>Hour<input type="number" min={0} max={23} value={node.hour} onChange={e => replace({ ...node, hour: Number(e.target.value) })}/></label><label>Minute<input type="number" min={0} max={59} value={node.minute} onChange={e => replace({ ...node, minute: Number(e.target.value) })}/></label></div><div className={s.contract}><strong>Local delivery time</strong><span>Uses the profile timezone, then the workspace timezone as fallback.</span></div></div>;
  if (node.type === 'conditional') { const rule = node.rule ?? eligibleRule; return <div className={s.formStack}><div className={s.contract}><strong>Who should go down the Yes path?</strong><span>Pick one clear condition. Everyone who does not match automatically goes down No.</span></div><RuleEditor rule={rule} options={ruleOptions} onChange={nextRule => replace({ ...node, rule: nextRule })}/><div className={s.branchLegend}><span><i data-branch="yes"/><b>Yes</b> — {ruleSentence(rule, ruleOptions)}</span><span><i data-branch="no"/><b>No</b> — Everyone else</span></div></div>; }
  return <div className={s.emptySettings}><FlowIcon name="end" size={28}/><strong>End of flow</strong><p>Contacts complete their journey here. Add a step on the connection above to continue.</p></div>;
}

function ActivationDialog({ updating, review, graph, profiles, query, profileId, busy, setQuery, setProfileId, close, activate }: { updating: boolean; review: Review; graph: Graph; profiles: Profile[]; query: string; profileId: string; busy: boolean; setQuery: (value: string) => void; setProfileId: (value: string) => void; close: () => void; activate: (mode: 'testing' | 'production') => Promise<void> }) {
  const blockers = review.readiness.checks.filter(check => !check.passed);
  return <FlowDialog title={updating ? 'Review and apply changes' : 'Review and turn on'} close={close} busy={busy} wide><div className={s.activationGrid}><section><h3>Send a safe test</h3><p>Creates one analytics-excluded run for a subscribed workspace profile. Existing List members are never bulk-enrolled during testing.</p><label>Find recipient<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or email"/></label><label>Test profile<select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">Choose profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select></label><button className={s.secondary} disabled={!profileId || busy} onClick={() => void activate('testing')}>Start test activation</button></section><section><h3>{updating ? 'Update the live flow' : 'Turn on production'}</h3><p>Publishes a new immutable version. Existing runs stay pinned to their original version. {audienceStartDescription(graph)}</p><div className={s.readiness}>{review.readiness.checks.map(check => <div key={check.key} data-ready={check.passed}><FlowIcon name={check.passed ? 'check' : 'close'}/><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div><button className={s.primary} disabled={blockers.length > 0 || busy || !review.canActivate} onClick={() => void activate('production')}>{updating ? 'Apply changes to live flow' : 'Activate production'}</button>{blockers.length > 0 && <small className={s.hint}>Complete the failed delivery checks before production activation.</small>}</section></div></FlowDialog>;
}

function SimulationTray({ simulation, graph, options, close }: { simulation: Simulation; graph: Graph; options: BuilderOptions; close: () => void }) { return <section className={s.simulationTray}><header><div><small>SAFE PREVIEW</small><h3>{simulation.entry.allowed ? 'Profile can enter this flow' : 'Entry filters blocked this profile'}</h3></div><button className={s.iconButton} onClick={close}><FlowIcon name="close"/></button></header>{simulation.entry.allowed && <ol>{simulation.steps.map((step, index) => { const node = graph.nodes.find(item => item.id === step.nodeId); return <li key={`${step.nodeId}-${index}`}><span>{index + 1}</span><div><strong>{node ? stepLabels[node.type] : step.type}</strong><small>{node ? stepSummary(node, options) : step.nodeId} · {new Date(step.at).toLocaleString()}</small></div></li>; })}</ol>}<p>{simulation.policyOutcome}</p></section>; }
