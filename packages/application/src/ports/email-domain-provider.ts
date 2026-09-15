import type { ManagedDnsRecord } from "./dns-provider.js";
export interface EmailDomainIdentityState {
  reference:string;identityVerified:boolean;verifiedForSending:boolean;verificationStatus:string;dkimStatus:string;mailFromStatus:string;
  dkimSigningOrigin?:string|null;dkimSigningSelector?:string|null;mailFromDomain?:string|null;
  dkimTokens:string[];dkimSigningHostedZone:string|null;dkimRecords:ManagedDnsRecord[];
  ownershipVerificationToken?:string|null;ownershipVerificationRecord?:ManagedDnsRecord|null;
}
export interface EmailDomainProvider {
  readonly provider:string;readonly region:string;
  ensureIdentity(input:{domain:string;existingReference?:string|null;workspaceId?:string;senderDomainId?:string}):Promise<EmailDomainIdentityState>;
  getIdentity(input:{domain:string;reference?:string|null}):Promise<EmailDomainIdentityState>;
  configureMailFrom(input:{domain:string;mailFromDomain:string;behaviorOnMxFailure?:"REJECT_MESSAGE"|"USE_DEFAULT_VALUE"}):Promise<ManagedDnsRecord[]>;
  ensureWorkspaceConfigurationSet(input:{workspaceId:string;existingName?:string|null;snsTopicArn?:string}):Promise<{name:string;feedbackReady:boolean}>;
  associateConfigurationSet?(input:{domain:string;configurationSetName:string}):Promise<void>;
  readQuota():Promise<{max24Hour?:number;maxSendRate?:number;sentLast24Hours?:number}>;
  removeIdentity(input:{domain:string;reference?:string|null}):Promise<{alreadyMissing?:boolean}>;
  ensureByodkimIdentity?(input:{domain:string;selector:string;privateKeyPem:string;existingReference?:string|null;workspaceId?:string;senderDomainId?:string}):Promise<EmailDomainIdentityState>;
}
