import { issueApiKey,verifyApiKey } from '../../../domain/src/phase3/api-key.js';
import type { Phase3ApiKeyRepository } from '../ports/phase3-api-key-repository.js';
export class Phase3ApiKeyService{
  constructor(private readonly repo:Phase3ApiKeyRepository,private readonly pepper:string){}
  async issue(input:{workspaceId:string;name:string;scopes:string[];expiresAt?:Date}){const allowed=new Set(['events.write','events.read']);if(!input.scopes.length||input.scopes.some(s=>!allowed.has(s)))throw new Error('API_KEY_SCOPE_INVALID');const k=issueApiKey(this.pepper),record=await this.repo.createCredential({workspaceId:input.workspaceId,name:input.name,prefix:k.prefix,secretHash:k.hash,scopes:[...new Set(input.scopes)],expiresAt:input.expiresAt});return {credential:record,secret:k.secret}}
  async authenticate(secret:string,requiredScope:string,now=new Date()){const prefix=secret.slice(0,10),c=await this.repo.credentialByPrefix(prefix);if(!c||c.revokedAt||(c.expiresAt&&c.expiresAt<=now)||!verifyApiKey(secret,c.secretHash,this.pepper))throw new Error('API_KEY_INVALID');if(!c.scopes.includes(requiredScope))throw new Error('API_KEY_SCOPE_DENIED');await this.repo.touchCredential(c.workspaceId,c.id,now);return {workspaceId:c.workspaceId,credentialId:c.id,scopes:c.scopes}}
  revoke(workspaceId:string,id:string,now=new Date()){return this.repo.revokeCredential(workspaceId,id,now)}
  list(workspaceId:string){return this.repo.listCredentials(workspaceId)}
}
