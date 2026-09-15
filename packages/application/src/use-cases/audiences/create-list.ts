import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const createList=(service:Phase1Service,workspaceId:string,actor:ServiceActor,input:{name:string;description?:string})=>service.createList(workspaceId,actor,input);
