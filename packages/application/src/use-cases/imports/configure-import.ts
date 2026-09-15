import type { Phase1Service, ServiceActor } from "../../phase1/phase1-service.js";
import type { ImportMapping, ImportPolicy } from "../../../../domain/src/phase1/import-policy.js";
export const configureImport=(service:Phase1Service,workspaceId:string,actor:ServiceActor,importId:string,mapping:ImportMapping,policy:ImportPolicy)=>service.configureImport(workspaceId,actor,importId,mapping,policy);
