import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const createExport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:Parameters<Phase1Service["createExport"]>[2])=>service.createExport(workspaceId,actor,input);
