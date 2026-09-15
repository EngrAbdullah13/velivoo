import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
export const createWorkspace=(service:Phase1Service,actor:ServiceActor,input:{name:string;legalName:string;businessAddress:string;timezone:string;locale:string})=>service.createWorkspace(actor,input);
