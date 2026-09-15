import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const commitImport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,importId:string)=>service.commitImport(workspaceId,actor,importId);
