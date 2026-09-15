import { createHmac, timingSafeEqual } from "node:crypto";

export interface TrackingTokenPayload {v:1;purpose:"click"|"open";messageId:string;trackingLinkId?:string;exp:number}
function enc(value:unknown){return Buffer.from(JSON.stringify(value)).toString("base64url")}
function sig(body:string,secret:string){return createHmac("sha256",secret).update(body).digest("base64url")}
export function createTrackingToken(payload:TrackingTokenPayload,secret:string){const body=enc(payload);return `${body}.${sig(body,secret)}`}
export function verifyTrackingToken(token:string,secret:string,now=Math.floor(Date.now()/1000)):TrackingTokenPayload{const [body,signature]=token.split(".");if(!body||!signature)throw new Error("TRACKING_TOKEN_INVALID");const expected=sig(body,secret);const a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error("TRACKING_TOKEN_INVALID");const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8")) as TrackingTokenPayload;if(payload.v!==1||payload.exp<now)throw new Error("TRACKING_TOKEN_EXPIRED");return payload}
export function assertSafeTrackingDestination(value:string){const u=new URL(value);if(u.protocol!=="https:")throw new Error("TRACKING_DESTINATION_UNSAFE");return u.toString()}
export function classifyClick(userAgent:string|undefined):"human_or_unknown"|"scanner"{const ua=(userAgent??"").toLowerCase();return /(proofpoint|barracuda|mimecast|microsoft office existence verification|googleimageproxy|safelinks|security|scanner|bot)/.test(ua)?"scanner":"human_or_unknown"}
