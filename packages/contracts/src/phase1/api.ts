export interface ApiErrorEnvelope{error:{code:string;message:string;retryable:boolean;requestId?:string;details?:unknown[]}}
export interface CursorPage<T>{items:T[];nextCursor?:string;freshness?:string}
export interface WorkspaceContext{workspaceId:string;userId:string;permissions:string[];correlationId:string}
