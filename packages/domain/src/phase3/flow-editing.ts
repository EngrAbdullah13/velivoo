import type { FlowEdge3, FlowGraph3, FlowNode3 } from './flow.js';

export type EditableStep = Exclude<FlowNode3['type'], 'end'>;
export function createFlowStep(type: EditableStep, id: string, test = false): FlowNode3 {
  switch (type) {
    case 'email': return { id, type, emailVersionId: '', mode: test ? 'test' : 'live' };
    case 'delay': return { id, type, durationSeconds: 86400 };
    case 'wait_until': return { id, type, hour: 9, minute: 0, timezonePolicy: 'profile_then_workspace' };
    case 'conditional': return { id, type, rule: { type: 'eligibility', operator: 'is', value: 'eligible' } };
  }
}

/** Insert on a specific connection. A split always has two distinct, valid branches. */
export function insertFlowStep(graph: FlowGraph3, connection: FlowEdge3, node: FlowNode3): FlowGraph3 {
  if (graph.nodes.some(item => item.id === node.id) || node.type === 'end') return graph;
  const index = graph.edges.findIndex(edge => edge.from === connection.from && edge.to === connection.to && edge.outcome === connection.outcome);
  if (index < 0) return graph;
  const nodes = [...graph.nodes, node];
  const edges = graph.edges.map((edge, i) => i === index ? { ...edge, to: node.id } : edge);
  if (node.type === 'conditional') {
    let endId = `${node.id}-no-end`;
    while (nodes.some(item => item.id === endId)) endId += '-1';
    nodes.push({ id: endId, type: 'end' });
    edges.push({ from: node.id, to: connection.to, outcome: 'yes' }, { from: node.id, to: endId, outcome: 'no' });
  } else edges.push({ from: node.id, to: connection.to });
  return { ...graph, nodes, edges };
}

/** Removing a split requires choosing the branch to keep; prune only unreachable nodes. */
export function removeFlowStep(graph: FlowGraph3, id: string, keep: 'yes' | 'no' = 'yes'): FlowGraph3 {
  const node = graph.nodes.find(item => item.id === id);
  if (!node || node.type === 'end') return graph;
  const exit = graph.edges.find(edge => edge.from === id && (node.type !== 'conditional' || edge.outcome === keep));
  if (!exit) return graph;
  const edges = graph.edges.filter(edge => edge.from !== id).map(edge => edge.to === id ? { ...edge, to: exit.to } : edge);
  const reachable = new Set<string>();
  const visit = (current: string) => { if (reachable.has(current)) return; reachable.add(current); edges.filter(edge => edge.from === current).forEach(edge => visit(edge.to)); };
  visit('trigger');
  return { ...graph, nodes: graph.nodes.filter(item => item.id !== id && reachable.has(item.id)), edges: edges.filter(edge => reachable.has(edge.from) && reachable.has(edge.to)), layout: Object.fromEntries(Object.entries(graph.layout ?? {}).filter(([key]) => reachable.has(key) && key !== id)) };
}
