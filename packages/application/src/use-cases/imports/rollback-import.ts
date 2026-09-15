import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const rollbackImport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,importId:string)=>service.rollbackImport(workspaceId,actor,importId);
