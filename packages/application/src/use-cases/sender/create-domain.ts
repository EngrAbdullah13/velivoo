import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const createDomain=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:{domain:string})=>service.createSenderDomain(workspaceId,actor,input);
