import { createHash } from 'node:crypto';
export type EventPropertyType='string'|'number'|'boolean'|'datetime';
export interface GenericEventSchema { name:string; version:number; properties:Record<string,{type:EventPropertyType;required?:boolean}> }
export interface GenericEventInput { eventId:string; name:string; occurredAt:string; profileId:string; source:string; schemaVersion:number; properties:Record<string,unknown>; idempotencyKey:string }
export interface GenericEventIssue { code:string; path:string; message:string }
export function validateEventSchema(s:GenericEventSchema){if(!/^[a-z0-9._-]{1,120}$/i.test(s.name))throw new Error('EVENT_SCHEMA_NAME_INVALID');if(!Number.isInteger(s.version)||s.version<1)throw new Error('EVENT_SCHEMA_VERSION_INVALID');if(Object.keys(s.properties).length>100)throw new Error('EVENT_SCHEMA_TOO_WIDE')}
export function validateGenericEvent(input:GenericEventInput,schema:GenericEventSchema,now=new Date()):GenericEventIssue[]{
 const issues:GenericEventIssue[]=[];if(input.name!==schema.name||input.schemaVersion!==schema.version)issues.push({code:'EVENT_SCHEMA_MISMATCH',path:'$',message:'Event does not match the selected schema version.'});
 if(!input.eventId||input.eventId.length>200)issues.push({code:'EVENT_ID_INVALID',path:'eventId',message:'Event ID is required and bounded.'});if(!input.idempotencyKey||input.idempotencyKey.length>200)issues.push({code:'IDEMPOTENCY_KEY_INVALID',path:'idempotencyKey',message:'Idempotency key is required and bounded.'});
 const t=new Date(input.occurredAt);if(Number.isNaN(t.getTime()))issues.push({code:'EVENT_TIME_INVALID',path:'occurredAt',message:'Timestamp is invalid.'});else if(t.getTime()>now.getTime()+5*60_000)issues.push({code:'EVENT_TIME_FUTURE',path:'occurredAt',message:'Future-dated event is quarantined/rejected.'});
 for(const [key,def] of Object.entries(schema.properties)){const v=input.properties[key];if(def.required&&v===undefined)issues.push({code:'PROPERTY_REQUIRED',path:`properties.${key}`,message:'Required event property is missing.'});if(v===undefined)continue;const ok=def.type==='string'?typeof v==='string':def.type==='number'?typeof v==='number'&&Number.isFinite(v):def.type==='boolean'?typeof v==='boolean':typeof v==='string'&&!Number.isNaN(Date.parse(v));if(!ok)issues.push({code:'PROPERTY_TYPE',path:`properties.${key}`,message:`Expected ${def.type}.`})}
 for(const key of Object.keys(input.properties))if(!schema.properties[key])issues.push({code:'PROPERTY_UNKNOWN',path:`properties.${key}`,message:'Property is not declared in this schema version.'});return issues;
}
export function genericEventFingerprint(workspaceId:string,input:GenericEventInput){return createHash('sha256').update(`${workspaceId}|${input.source}|${input.idempotencyKey}`).digest('hex')}
