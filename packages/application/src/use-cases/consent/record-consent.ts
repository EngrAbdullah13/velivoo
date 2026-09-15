import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const recordConsent=(service:Phase1Service,workspaceId:string,actor:ServiceActor,profileId:string,input:Parameters<Phase1Service["recordConsent"]>[3])=>service.recordConsent(workspaceId,actor,profileId,input);
