import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const uploadImport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:{fileName:string;csv:string})=>service.uploadImport(workspaceId,actor,input);
