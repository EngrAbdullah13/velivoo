import type { FlowGraph, FlowNode } from "./entities.js";
import { validateFlowGraph } from "./flow-validator.js";

export interface SimulatedFlowStep {
  nodeId: string;
  type: FlowNode["type"];
  arrivedAt: string;
  detail?: Record<string, unknown>;
}

/** Pure deterministic Phase 0 simulator. It creates no runs/jobs/messages. */
export function simulateFlow(graph: FlowGraph, startAt: Date): SimulatedFlowStep[] {
  const issues = validateFlowGraph(graph);
  if (issues.length) throw new Error(`FLOW_SIMULATION_INVALID:${issues.map((x) => x.code).join(",")}`);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const trigger = graph.nodes.find((node) => node.type === "trigger")!;
  const steps: SimulatedFlowStep[] = [];
  let current: FlowNode = trigger;
  let clock = new Date(startAt);
  const visited = new Set<string>();

  for (;;) {
    if (visited.has(current.id)) throw new Error("FLOW_SIMULATION_CYCLE");
    visited.add(current.id);
    const detail = current.type === "delay"
      ? { durationMs: current.durationMs }
      : current.type === "email"
        ? { emailVersionId: current.emailVersionId }
        : undefined;
    steps.push({ nodeId: current.id, type: current.type, arrivedAt: clock.toISOString(), ...(detail ? { detail } : {}) });
    if (current.type === "end") break;
    if (current.type === "delay") clock = new Date(clock.getTime() + current.durationMs);
    const nextIds = outgoing.get(current.id) ?? [];
    if (nextIds.length !== 1) throw new Error(`FLOW_SIMULATION_AMBIGUOUS:${current.id}`);
    const next = byId.get(nextIds[0]!);
    if (!next) throw new Error(`FLOW_SIMULATION_MISSING_NODE:${nextIds[0]}`);
    current = next;
  }
  return steps;
}
