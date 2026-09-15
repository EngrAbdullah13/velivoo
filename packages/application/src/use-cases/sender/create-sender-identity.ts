import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const createSenderIdentity=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:Parameters<Phase1Service["createSenderIdentity"]>[2])=>service.createSenderIdentity(workspaceId,actor,input);
