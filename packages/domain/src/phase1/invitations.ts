import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newInvitationToken(): { token: string; hash: string } {
  const token=randomBytes(32).toString("base64url");
  return {token,hash:hashInvitationToken(token)};
}
export function hashInvitationToken(token:string):string{return createHash("sha256").update(token).digest("hex")}
export function invitationTokenMatches(token:string,expectedHash:string):boolean{
  const a=Buffer.from(hashInvitationToken(token),"hex"), b=Buffer.from(expectedHash,"hex");
  return a.length===b.length && timingSafeEqual(a,b);
}
