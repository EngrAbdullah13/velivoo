import type { FlowGraph } from "./entities.js";

export interface FlowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export function validateFlowGraph(graph: FlowGraph): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  const ends = graph.nodes.filter((n) => n.type === "end");
  if (triggers.length !== 1) issues.push({ code: "TRIGGER_COUNT", message: "Flow must have exactly one trigger." });
  if (ends.length < 1) issues.push({ code: "MISSING_END", message: "Flow must have at least one terminal end node." });

  for (const edge of graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      issues.push({ code: "DANGLING_EDGE", message: `Edge ${edge.from} -> ${edge.to} references an unknown node.` });
    }
  }

  const outgoingCount = new Map<string, number>();
  for (const edge of graph.edges) outgoingCount.set(edge.from, (outgoingCount.get(edge.from) ?? 0) + 1);

  for (const node of graph.nodes) {
    const count = outgoingCount.get(node.id) ?? 0;
    if (node.type === "end" && count !== 0) issues.push({ code: "END_HAS_OUTGOING", message: "End node cannot have outgoing edges.", nodeId: node.id });
    if (node.type !== "end" && count === 0) issues.push({ code: "MISSING_OUTGOING", message: "Non-terminal node must continue to exactly one next node in Phase 0.", nodeId: node.id });
    if (node.type !== "end" && count > 1) issues.push({ code: "AMBIGUOUS_OUTGOING", message: "Branching requires an explicit conditional node and is not supported by the Phase 0 graph.", nodeId: node.id });
    if (node.type === "delay" && (!Number.isFinite(node.durationMs) || node.durationMs < 0)) {
      issues.push({ code: "INVALID_DELAY", message: "Delay must be a finite non-negative duration.", nodeId: node.id });
    }
    if (node.type === "email" && !node.emailVersionId) {
      issues.push({ code: "MISSING_EMAIL_VERSION", message: "Email node must pin a published email version.", nodeId: node.id });
    }
  }

  if (triggers.length === 1) {
    const start = triggers[0]!;
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    const seen = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) { issues.push({ code: "CYCLE", message: "Cycles are not supported in Release 1.", nodeId: id }); return; }
      if (seen.has(id)) return;
      seen.add(id); active.add(id);
      for (const next of adjacency.get(id) ?? []) visit(next);
      active.delete(id);
    };
    visit(start.id);
    for (const node of graph.nodes) if (!seen.has(node.id)) issues.push({ code: "UNREACHABLE_NODE", message: "Node is unreachable from trigger.", nodeId: node.id });
  }
  return dedupe(issues);
}

function dedupe(issues: FlowValidationIssue[]): FlowValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.nodeId ?? ""}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
