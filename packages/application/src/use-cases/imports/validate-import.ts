import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const validateImport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,importId:string)=>service.validateImport(workspaceId,actor,importId);
