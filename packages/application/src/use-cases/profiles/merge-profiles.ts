import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const mergeProfiles=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:{canonicalId:string;sourceId:string})=>service.mergeProfiles(workspaceId,actor,input);
