export type VariableNamespace = "profile" | "workspace" | "event" | "system";
export interface ParsedVariable { raw: string; namespace: VariableNamespace; path: string; fallback?: string }
export interface ContentVariableDefinition { key:string; label:string; namespace:VariableNamespace; path:string; type:"text"|"url"; requiresFallback:boolean; availability:"always"|"profile"|"event" }
/** The editor consumes this server-owned vocabulary; unsupported runtime data is never offered. */
export const RELEASE1_VARIABLES:ContentVariableDefinition[]=[
  {key:"profile.first_name",label:"First name",namespace:"profile",path:"first_name",type:"text",requiresFallback:true,availability:"profile"},
  {key:"profile.last_name",label:"Last name",namespace:"profile",path:"last_name",type:"text",requiresFallback:true,availability:"profile"},
  {key:"profile.email",label:"Email",namespace:"profile",path:"email",type:"text",requiresFallback:true,availability:"profile"},
  {key:"workspace.business_name",label:"Business name",namespace:"workspace",path:"business_name",type:"text",requiresFallback:false,availability:"always"},
  {key:"workspace.business_address",label:"Business address",namespace:"workspace",path:"business_address",type:"text",requiresFallback:false,availability:"always"},
  {key:"system.unsubscribe_url",label:"Unsubscribe URL",namespace:"system",path:"unsubscribe_url",type:"url",requiresFallback:false,availability:"always"},
  {key:"system.preferences_url",label:"Preferences URL",namespace:"system",path:"preferences_url",type:"url",requiresFallback:false,availability:"always"},
];
const TOKEN = /\{\{\s*(profile|workspace|event|system)\.([a-zA-Z0-9_.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g;

export function parseVariables(input: string): ParsedVariable[] {
  const out: ParsedVariable[] = [];
  for (const match of input.matchAll(TOKEN)) out.push({ raw: match[0], namespace: match[1] as VariableNamespace, path: match[2]!, fallback: match[3] });
  return out;
}

export function findUnknownVariableSyntax(input: string): string[] {
  const candidate = input.match(/\{\{[^}]+\}\}/g) ?? [];
  const valid = new Set(parseVariables(input).map((v) => v.raw));
  return candidate.filter((v) => !valid.has(v));
}

export function variableNeedsFallback(v: ParsedVariable): boolean {
  if (v.namespace === "system" || v.namespace === "workspace") return false;
  return v.fallback === undefined;
}
