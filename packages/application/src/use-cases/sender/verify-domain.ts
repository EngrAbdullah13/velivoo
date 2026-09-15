import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const verifyDomain=(service:Phase1Service,workspaceId:string,actor:ServiceActor,domainId:string)=>service.verifySenderDomain(workspaceId,actor,domainId);
