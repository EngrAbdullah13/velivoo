import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKETING_ENTRY_FILTER, normalizeFlowGraph3 } from "../packages/domain/src/phase3/flow.js";

const end = { id: "end", type: "end" as const };

test("normalizeFlowGraph3 adds default marketing entry filter for live email flows", () => {
  const graph = {
    schemaVersion: 1 as const,
    trigger: { type: "list_joined" as const, listId: "list-1" },
    nodes: [{ id: "email-1", type: "email" as const, emailVersionId: "v1", mode: "live" as const }, end],
    edges: [{ from: "trigger" as const, to: "email-1" }, { from: "email-1", to: "end" }],
    entryPolicy: { mode: "once" as const },
    entryFilters: [],
    exitRules: [],
  };
  const normalized = normalizeFlowGraph3(graph);
  assert.deepEqual(normalized.entryFilters, [DEFAULT_MARKETING_ENTRY_FILTER]);
});

test("normalizeFlowGraph3 leaves explicit entry filters unchanged", () => {
  const custom = { type: "consent" as const, channel: "email" as const, purpose: "marketing" as const, operator: "is" as const, value: "granted" as const };
  const graph = {
    schemaVersion: 1 as const,
    trigger: { type: "manual_test" as const },
    nodes: [{ id: "email-1", type: "email" as const, emailVersionId: "v1", mode: "test" as const }, end],
    edges: [{ from: "trigger" as const, to: "email-1" }, { from: "email-1", to: "end" }],
    entryPolicy: { mode: "once" as const },
    entryFilters: [custom],
    exitRules: [],
  };
  assert.deepEqual(normalizeFlowGraph3(graph).entryFilters, [custom]);
});
