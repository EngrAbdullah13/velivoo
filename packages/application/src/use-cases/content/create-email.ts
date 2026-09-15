import type { Phase2ContentService, Phase2Actor } from "../../phase2/content-service.js";
export function createEmail(service:Phase2ContentService,actor:Phase2Actor,input:{internalName:string;authoringMode?:"structured"|"html"}){return service.createEmail(actor,input)}
