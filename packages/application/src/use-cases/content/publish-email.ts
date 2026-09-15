import type { Phase2ContentService, Phase2Actor } from "../../phase2/content-service.js";
import type { PreflightContext } from "../../../../domain/src/phase2/preflight.js";
export function publishEmail(service:Phase2ContentService,actor:Phase2Actor,emailId:string,ctx:PreflightContext){return service.publish(actor,emailId,ctx)}
