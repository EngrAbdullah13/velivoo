import type { Role } from "../../../domain/src/phase1/permissions.js";
import type { ImportMapping, ImportPolicy } from "../../../domain/src/phase1/import-policy.js";
export type { Role, ImportMapping, ImportPolicy };

export interface Actor { userId:string; email:string; displayName?:string; }
export interface ImportUploadInput { fileName:string; csv:string; }
export interface ExportRequest { scope:{type:"all"|"selected";profileIds?:string[]}; fields:string[]; purpose?:string; ttlSeconds?:number; }
