import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type { AuthenticatedIdentity, IdentityProvider } from "../ports/identity-provider.js";

interface Discovery { issuer:string; jwks_uri:string; }
interface Jwk { kid:string; kty:string; alg?:string; use?:string; n?:string; e?:string; x?:string; y?:string; crv?:string; }
const cache=new Map<string,{expires:number,value:any}>();
async function cachedJson<T>(url:string,ttlMs=300_000):Promise<T>{const c=cache.get(url);if(c&&c.expires>Date.now())return c.value as T;const r=await fetch(url,{headers:{accept:"application/json"}});if(!r.ok)throw new Error("OIDC_DISCOVERY_FAILED");const value=await r.json() as T;cache.set(url,{expires:Date.now()+ttlMs,value});return value}
function decodePart(part:string):any{return JSON.parse(Buffer.from(part,"base64url").toString("utf8"))}
function audienceMatches(aud:unknown,expected:string):boolean{return typeof aud==="string"?aud===expected:Array.isArray(aud)&&aud.includes(expected)}

export class OidcJwtIdentityProvider implements IdentityProvider {
  constructor(private readonly config:{issuer:string;audience:string;emailClaim?:string;displayNameClaim?:string}){}
  async authenticate(input:{authorization?:string}):Promise<AuthenticatedIdentity|null>{
    const raw=input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]; if(!raw)return null;
    const parts=raw.split("."); if(parts.length!==3)throw new Error("AUTH_TOKEN_INVALID");
    const [h,p,s]=parts as [string,string,string]; const header=decodePart(h),payload=decodePart(p);
    if(header.alg!=="RS256"||!header.kid)throw new Error("AUTH_ALGORITHM_UNSUPPORTED");
    const issuer=this.config.issuer.replace(/\/$/,""); const discovery=await cachedJson<Discovery>(`${issuer}/.well-known/openid-configuration`);
    if(discovery.issuer.replace(/\/$/,"")!==issuer)throw new Error("OIDC_ISSUER_MISMATCH");
    const jwks=await cachedJson<{keys:Jwk[]}>(discovery.jwks_uri);const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)throw new Error("AUTH_KEY_NOT_FOUND");
    const ok=verify("RSA-SHA256",Buffer.from(`${h}.${p}`),createPublicKey({key:jwk as unknown as JsonWebKey,format:"jwk"}),Buffer.from(s,"base64url"));if(!ok)throw new Error("AUTH_SIGNATURE_INVALID");
    const now=Math.floor(Date.now()/1000),skew=60;if(payload.iss?.replace(/\/$/,"")!==issuer)throw new Error("AUTH_ISSUER_INVALID");if(!audienceMatches(payload.aud,this.config.audience))throw new Error("AUTH_AUDIENCE_INVALID");if(typeof payload.exp!=="number"||payload.exp<now-skew)throw new Error("AUTH_EXPIRED");if(typeof payload.nbf==="number"&&payload.nbf>now+skew)throw new Error("AUTH_NOT_YET_VALID");if(!payload.sub)throw new Error("AUTH_SUBJECT_REQUIRED");
    const email=payload[this.config.emailClaim??"email"];if(typeof email!=="string"||!email.includes("@"))throw new Error("AUTH_EMAIL_REQUIRED");const display=payload[this.config.displayNameClaim??"name"];
    return {subject:String(payload.sub),email,displayName:typeof display==="string"?display:undefined};
  }
}
