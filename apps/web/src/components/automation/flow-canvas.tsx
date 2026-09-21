'use client';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Graph, Step, Connection, BuilderOptions, Issue } from './flow-types';
import { FlowIcon } from './flow-ui';
import s from './flows.module.css';
export const stepLabels = { email: 'Send email', delay: 'Time delay', wait_until: 'Wait until local time', conditional: 'If / else split', end: 'End of flow', trigger: 'Trigger' };
export function triggerLabel(graph: Graph, options: BuilderOptions | null) {
  const trigger = graph.trigger;
  switch (trigger.type) {
    case 'list_joined': return options?.lists.find(item => item.id === trigger.listId)?.name ? `Joins ${options.lists.find(item => item.id === trigger.listId)!.name}` : 'Choose a list';
    case 'segment_entered': return options?.segments.find(item => item.id === trigger.segmentId)?.name ? `Enters ${options.segments.find(item => item.id === trigger.segmentId)!.name}` : 'Choose a segment';
    case 'generic_event': return trigger.eventName || 'Choose an event';
    case 'profile_date': return trigger.field ? `Date: ${trigger.field}` : 'Choose a date property';
    case 'manual_test': return 'Manual test entry';
    default: return 'Choose your trigger';
  }
}
export function stepSummary(node: Step, options: BuilderOptions | null) {
  switch (node.type) {
    case 'email': { const email = options?.emails.find(item => item.id === node.emailVersionId); return email ? `${email.name} · v${email.versionNumber}` : 'Select an approved email'; }
    case 'delay': return node.durationSeconds % 86400 === 0 ? `${node.durationSeconds / 86400} days` : node.durationSeconds % 3600 === 0 ? `${node.durationSeconds / 3600} hours` : `${node.durationSeconds / 60} minutes`;
    case 'wait_until': return `${String(node.hour).padStart(2, '0')}:${String(node.minute).padStart(2, '0')} · profile timezone`;
    case 'conditional': return 'Send contacts down Yes or No';
    case 'end': return 'Journey completed';
  }
}
type Position = { x: number; y: number };
function layoutGraph(graph: Graph) {
  const result = new Map<string, Position>();
  const depths = new Map<string, number>();
  // Longest depth puts merged branches below every incoming connection.
  const depth = (id: string, level: number, ancestors: Set<string>) => {
    if (ancestors.has(id) || level > 100) return;
    depths.set(id, Math.max(depths.get(id) ?? 0, level));
    const path = new Set(ancestors).add(id);
    graph.edges.filter(edge => edge.from === id).forEach(edge => depth(edge.to, level + 1, path));
  };
  depth('trigger', 0, new Set());
  let column = 0;
  const visit = (id: string): number => {
    const existing = result.get(id); if (existing) return existing.x;
    result.set(id, { x: column * 310 + 600, y: (depths.get(id) ?? 0) * 220 + 40 });
    const outgoing = graph.edges.filter(edge => edge.from === id);
    const xs = outgoing.map(edge => visit(edge.to));
    const x = xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : column++ * 310 + 600;
    result.set(id, { x, y: (depths.get(id) ?? 0) * 220 + 40 }); return x;
  };
  visit('trigger');
  for (const node of graph.nodes) if (!result.has(node.id)) result.set(node.id, { x: column++ * 310 + 600, y: 260 });
  return result;
}
export function FlowCanvas({ graph, options, issues, selected, onSelect, onInsert, zoom, readOnly }: { graph: Graph; options: BuilderOptions | null; issues: Issue[]; selected: string; onSelect: (id: string) => void; onInsert: (edge: Connection) => void; zoom: number; readOnly: boolean }) {
  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const [manualPositions, setManualPositions] = useState<Record<string, Position>>({});
  const [dragging, setDragging] = useState<{ id: string; position: Position } | null>(null);
  const drag = useRef<{ id: string; start: Position; origin: Position; moved: boolean } | null>(null);
  const width = Math.max(1000, ...[...positions.values()].map(p => p.x + 320));
  const height = Math.max(600, ...[...positions.values()].map(p => p.y + 180));
  const begin = (event: PointerEvent<HTMLButtonElement>, id: string, position: Position) => { if (readOnly || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, start: { x: event.clientX, y: event.clientY }, origin: position, moved: false }; };
  const move = (event: PointerEvent<HTMLButtonElement>) => { const current = drag.current; if (!current) return; const dx = (event.clientX - current.start.x) / (zoom / 100), dy = (event.clientY - current.start.y) / (zoom / 100); if (Math.abs(dx) + Math.abs(dy) > 5) current.moved = true; if (current.moved) setDragging({ id: current.id, position: { x: Math.max(16, current.origin.x + dx), y: Math.max(16, current.origin.y + dy) } }); };
  const finish = () => { if (dragging && drag.current?.moved) setManualPositions(current => ({ ...current, [dragging.id]: dragging.position })); setDragging(null); drag.current = null; };
  const position = (id: string) => dragging?.id === id ? dragging.position : manualPositions[id] ?? positions.get(id);
  return <div className={s.canvasScroll} aria-label="Flow canvas"><div className={s.scaledCanvas} style={{ width: width * zoom / 100, height: height * zoom / 100 }}><div className={s.canvasStage} style={{ width, height, transform: `scale(${zoom / 100})` }}>
    <svg className={s.connections} width={width} height={height} aria-hidden="true">{graph.edges.map((edge, index) => { const from = position(edge.from), to = position(edge.to); if (!from || !to) return null; const x1 = from.x + 124, y1 = from.y + 124, x2 = to.x + 124, y2 = to.y; return <g key={index}><path d={`M${x1} ${y1} V${y1 + 38} H${x2} V${y2}`}/>{edge.outcome && <text x={x2 + 12} y={y1 + 64} data-outcome={edge.outcome}>{edge.outcome.toUpperCase()}</text>}</g>; })}</svg>
    {graph.edges.map((edge, index) => { const from = position(edge.from), to = position(edge.to); if (!from || !to) return null; return <button key={`add-${index}`} className={s.insertStep} style={{ left: to.x + 109, top: to.y - 44 }} disabled={readOnly} onClick={() => onInsert(edge)} title={`Add step${edge.outcome ? ` to ${edge.outcome} branch` : ''}`} aria-label={`Add step after ${edge.from}${edge.outcome ? ` on ${edge.outcome} branch` : ''}`}><FlowIcon name="plus" size={16}/></button>; })}
    {['trigger', ...graph.nodes.map(node => node.id)].map(id => { const node = graph.nodes.find(item => item.id === id), pos = position(id); if (!pos) return null; const kind = node?.type ?? 'trigger'; const blocked = issues.some(issue => issue.nodeId === id || (id === 'trigger' && (issue.field === 'trigger' || issue.path?.startsWith('trigger')))); return <button key={id} className={s.node} data-kind={kind} data-selected={selected === id} data-blocked={blocked} style={{ left: pos.x, top: pos.y }} onPointerDown={event => begin(event, id, pos)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setDragging(null); }} onClick={() => onSelect(id)} aria-pressed={selected === id}><span className={s.nodeTop}><span className={s.nodeIcon}><FlowIcon name={kind}/></span><span>{stepLabels[kind]}</span><span className={s.grip} aria-hidden="true">⠿</span></span><strong>{node ? stepSummary(node, options) : triggerLabel(graph, options)}</strong><small>{blocked ? 'Needs attention — review settings' : node?.type === 'email' ? (node.mode === 'test' ? 'Test delivery' : 'Live delivery when activated') : id === 'trigger' ? 'When a contact qualifies' : 'Click to configure'}</small></button>; })}
  </div></div></div>;
}
