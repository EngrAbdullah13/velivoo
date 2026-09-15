import { randomUUID } from "node:crypto";
export interface CorrelationContext { requestId: string; correlationId: string; workspaceId?: string; }
export function newCorrelationContext(workspaceId?: string): CorrelationContext { return { requestId: randomUUID(), correlationId: randomUUID(), workspaceId }; }
