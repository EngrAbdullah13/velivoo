import { apiAuthHeaders } from "./api-auth";

export type ApiError = { error?: { code?: string; message?: string } };

const friendlyErrors:Record<string,string>={
  AUTH_INVALID_CREDENTIALS:'The email address or password is incorrect.',
  AUTH_REQUIRED:'Please sign in to continue.',
  WORKSPACE_ACCESS_DENIED:'You do not have access to this workspace. Sign in again or switch to a workspace you belong to.',
  EMAIL_PREFLIGHT_BLOCKED:'This email is not ready to publish. Open Preflight and resolve the listed items.',
  EMAIL_VERSION_PREFLIGHT_BLOCKING:'The selected published email version has preflight issues that must be resolved.',
  FLOW_CONFLICT:'This Flow was changed elsewhere. Reload it before saving again.',
  CONCURRENCY_CONFLICT:'This item was changed elsewhere. Reload the page and try again.',
  DOMAIN_NOT_VERIFIED:'Verify the sending domain before using it for a sender identity.',
  WORKSPACE_SENDING_DOMAIN_EXISTS:'This workspace already has a sending domain. Remove the current setup before adding another domain.',
  WORKSPACE_SENDING_DOMAIN_REQUIRED:'Use the workspace sending domain when creating a sender identity.',
  WORKSPACE_SENDING_DOMAIN_NOT_CURRENT:'This sender belongs to a historical domain. Use the workspace sending domain instead.',
  DOMAIN_HAS_SENDER_IDENTITIES:'Remove or change the sender identities that use this domain before removing it.',
  DOMAIN_PROVIDER_NOT_CONFIGURED:'Branded sending-domain setup is not configured on this server. Existing domains and unrelated features remain available.',
  DNS_PROVIDER_NOT_CONFIGURED:'Branded domain setup is not available yet. Existing domains and unrelated features remain available.',
  EMAIL_DOMAIN_PROVIDER_NOT_CONFIGURED:'The server-side email-domain provider is not configured for new branded domains.',
  TRACKING_PROVIDER_NOT_CONFIGURED:'Branded tracking infrastructure is not configured on this server.',
  SES_ACCESS_DENIED:'The email provider rejected the request because platform permissions are incomplete.',
  SES_AUTHENTICATION_FAILED:'The platform could not authenticate with its email provider.',
  SES_PROVIDER_UNAVAILABLE:'The sending-domain provider is temporarily unavailable. Please try again shortly.',
  INVALID_DOMAIN:'Enter only a domain, such as example.com, not an email address or URL.',
  EMAIL_USED_INSTEAD_OF_DOMAIN:'Enter a domain like hollapic.com, not an email address.',
  URL_USED_INSTEAD_OF_DOMAIN:'Enter a domain like hollapic.com, not a URL.',
  SENDER_NOT_FOUND:'Select an active sender identity before continuing.',
  TEST_DELIVERY_UNAVAILABLE:'Test delivery is not available until the server-side email provider is configured.',
  IMPORT_HTML_EMPTY:'Paste or upload the HTML body of your email template.',
  IMPORT_HTML_INVALID:'This does not look like email HTML. Export or copy the HTML design from your email platform, not the raw delivery message.',
  IMPORT_EMAIL_SOURCE_NO_HTML:'This looks like a full email file (.eml) without an HTML body. Export HTML from your email platform instead.',
  IMPORT_FILE_TYPE_INVALID:'Upload an .html, .htm, or .eml file, or a .zip export.',
  TEMPLATE_NOT_FOUND:'This template is no longer available in this workspace.',
  SCHEMA_MIGRATION_REQUIRED:'The database schema is out of date. Run npm run db:migrate from the project root, then restart the API server.',
  INTERNAL:'The request could not be completed. Please try again.',
  TESTING_FLOW_REQUIRES_TEST_EMAIL_NODES:'Testing activation requires every Email node to use Test mode. Open each Email node, set Mode to Test, save, publish again, then activate testing.',
  PRODUCTION_FLOW_REQUIRES_LIVE_EMAIL_NODES:'Production activation requires every Email node to use Live mode.',
  FLOW_NOT_IN_TESTING:'Start a test run only after activating this Flow in testing mode.',
  FLOW_VALIDATION_FAILED:'This Flow has blocking validation issues. Resolve them before publishing or activating.',
  FLOW_NOT_ACTIVE:'This Flow is not active. Publish and activate it before starting a test run.',
  PROFILE_NOT_FOUND:'Select a workspace profile before starting a test run.',
  COOLDOWN_INVALID:'Re-entry cooldown must be at least 60 seconds (1 minute) and at most 1 year. Open Trigger settings and fix the cooldown duration.',
};

function presentError(code:string,detail:string){const friendly=friendlyErrors[code];if(friendly)return `${friendly} Diagnostic code: ${code}`;if(code.startsWith('HTTP_'))return `The request could not be completed. Please try again. Diagnostic code: ${code}`;return `${detail||'The request could not be completed.'} Diagnostic code: ${code}`}

export async function phase1Api<T>(path:string, init:RequestInit={}):Promise<T>{
  const base=process.env.NEXT_PUBLIC_EMAIL_PLATFORM_API_URL??'http://localhost:4000';
  let response:Response;
  try{response=await fetch(`${base}${path}`,{...init,credentials:'include',headers:{'content-type':'application/json',...apiAuthHeaders(),...(init.headers??{})},cache:'no-store'})}
  catch{throw new Error(`The application server is unavailable. Start the local API and try again. Diagnostic code: API_UNREACHABLE`)}
  const raw=await response.text();let data:any={};try{data=raw?JSON.parse(raw):{raw}}catch{data={raw}}
  if(!response.ok){const errorBody=data?.error;const detail=typeof errorBody==='string'?errorBody:errorBody&&typeof errorBody.message==='string'?errorBody.message:typeof data?.message==='string'?data.message:`Request failed (${response.status})`;const code=errorBody&&typeof errorBody.code==='string'?errorBody.code:`HTTP_${response.status}`;throw new Error(presentError(code,detail))}
  return data as T;
}
