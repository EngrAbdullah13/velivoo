export interface ApiCredential3 {id:string;workspaceId:string;name:string;prefix:string;secretHash:string;scopes:string[];createdAt:Date;lastUsedAt?:Date|null;expiresAt?:Date|null;revokedAt?:Date|null}
export interface Phase3ApiKeyRepository{
  createCredential(input:{workspaceId:string;name:string;prefix:string;secretHash:string;scopes:string[];expiresAt?:Date}):Promise<ApiCredential3>;
  credentialByPrefix(prefix:string):Promise<ApiCredential3|null>;
  revokeCredential(workspaceId:string,id:string,at:Date):Promise<void>;
  touchCredential(workspaceId:string,id:string,at:Date):Promise<void>;
  listCredentials(workspaceId:string):Promise<ApiCredential3[]>;
}
