import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
import type { Role } from "../../../../domain/src/phase1/permissions.js";
export const inviteMember=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:{email:string;role:Exclude<Role,"owner">;ttlHours?:number})=>service.inviteMember(workspaceId,actor,input);
