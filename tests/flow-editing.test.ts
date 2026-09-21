import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlowStep, insertFlowStep, removeFlowStep } from '../packages/domain/src/phase3/flow-editing.js';
import { validateFlow3, type FlowGraph3 } from '../packages/domain/src/phase3/flow.js';
const blank = (): FlowGraph3 => ({ schemaVersion: 1, trigger: { type: 'manual_test' }, nodes: [{ id: 'end', type: 'end' }], edges: [{ from: 'trigger', to: 'end' }], entryPolicy: { mode: 'once' }, entryFilters: [], exitRules: [] });
test('all structural insertions preserve connections, including nested splits', () => {
  let graph = blank();
  for (const [index, type] of (['delay', 'wait_until', 'conditional', 'conditional'] as const).entries()) {
    graph = insertFlowStep(graph, graph.edges[0]!, createFlowStep(type, `node-${index}`));
    assert.deepEqual(validateFlow3(graph), []);
  }
});
test('new emails never select arbitrary workspace content', () => {
  const node = createFlowStep('email', 'email', true);
  assert.deepEqual(node, { id: 'email', type: 'email', emailVersionId: '', mode: 'test' });
});
test('deleting a split keeps chosen branch and prunes orphaned nodes', () => {
  const original = blank();
  const split = insertFlowStep(original, original.edges[0]!, createFlowStep('conditional', 'split'));
  const branched = insertFlowStep(split, split.edges.find(e => e.outcome === 'no')!, createFlowStep('delay', 'wait'));
  for (const branch of ['yes', 'no'] as const) {
    const result = removeFlowStep(branched, 'split', branch);
    assert.deepEqual(validateFlow3(result), []);
    assert.equal(result.nodes.some(n => n.id === 'wait'), branch === 'no');
  }
  assert.equal(branched.nodes.length, 4);
  assert.equal(original.nodes.length, 1);
});
test('removing an ordinary step preserves the parent branch outcome', () => {
  const base = blank();
  const split = insertFlowStep(base, base.edges[0]!, createFlowStep('conditional', 'split'));
  const graph = insertFlowStep(split, split.edges.find(e => e.outcome === 'yes')!, createFlowStep('delay', 'wait'));
  assert.deepEqual(validateFlow3(removeFlowStep(graph, 'wait')), []);
  assert.equal(removeFlowStep(graph, 'end'), graph);
});
