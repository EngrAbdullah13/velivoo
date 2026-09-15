import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const upsertProfile=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:Parameters<Phase1Service["upsertProfile"]>[2])=>service.upsertProfile(workspaceId,actor,input);
