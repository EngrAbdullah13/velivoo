import type { DomainLifecycleState, DomainReadinessStatus } from "../../../domain/src/phase1/branded-domain.js";
import type { ManagedDnsRecord } from "./dns-provider.js";
export interface ProvisioningDomain {
  id:string;workspaceId:string;domain:string;rootDomain?:string|null;delegatedSubdomain?:string|null;provisioningMode:string;
  provisioningVersion?:string|null;provisioningCallerReference?:string|null;dkimTokens?:unknown;dkimSigningHostedZone?:string|null;
  ownershipVerificationToken?:string|null;dkimSigningMode?:string|null;dkimSigningDomain?:string|null;dkimSelector?:string|null;
  delegationStatus?:string|null;soaStatus?:string|null;verificationStatus?:string|null;dmarcObservation?:unknown;
  dkimStatus?:string|null;mailFromStatus?:string|null;
  lifecycleState:DomainLifecycleState;authenticationStatus:string;readinessStatus:DomainReadinessStatus;readinessReasons?:unknown;
  hostedZoneReference?:string|null;delegationSetReference?:string|null;providerReference?:string|null;providerRegion?:string|null;
  mailFromDomain?:string|null;trackingDomain?:string|null;trackingProvider?:string|null;trackingTenantReference?:string|null;
  trackingConnectionGroupReference?:string|null;trackingRoutingEndpoint?:string|null;trackingCertificateReference?:string|null;
  trackingCertificateStatus?:string|null;trackingHttpsStatus?:string|null;trackingValidationMethod?:string|null;
}
export interface DomainProvisioningRepository {
  findProvisioningDomain(workspaceId:string,domainId:string):Promise<ProvisioningDomain|null>;
  findProvisioningDomainByRoot(workspaceId:string,rootDomain:string):Promise<ProvisioningDomain|null>;
  findWorkspacePrimaryProvisioningDomain(workspaceId:string):Promise<ProvisioningDomain|null>;
  findProvisioningDomainOutsideWorkspace(workspaceId:string,rootDomain:string):Promise<{id:string}|null>;
  createBrandedDomain(input:{workspaceId:string;rootDomain:string;delegatedSubdomain:string;region:string;provisioningVersion:string;provisioningMode?:string;setupMode?:string}):Promise<ProvisioningDomain>;
  updateProvisioningDomain(input:{workspaceId:string;domainId:string;patch:Record<string,unknown>}):Promise<ProvisioningDomain>;
  upsertDnsEvidence(input:{workspaceId:string;senderDomainId:string;purpose:string;ownership:"customer"|"platform";record:ManagedDnsRecord;verificationStatus:string;customerActionRequired:boolean;observedValues?:string[];validationMethod?:string;lastCheckedAt?:Date}):Promise<void>;
  retireCustomerDnsEvidence(workspaceId:string,senderDomainId:string):Promise<void>;
  retireDnsEvidenceExceptName?(workspaceId:string,senderDomainId:string,purpose:string,keepName:string):Promise<void>;
  retireDnsEvidenceExceptExpected?(workspaceId:string,senderDomainId:string,purpose:string,keepName:string,keepExpectedValue:string):Promise<void>;
  purgeDnsEvidenceExceptName?(workspaceId:string,senderDomainId:string,purpose:string,keepName:string):Promise<void>;
  purgeDnsEvidenceDuplicatesForPurposes?(workspaceId:string,senderDomainId:string,purposes:string[]):Promise<void>;
  retireLegacyStaticDnsEvidence?(workspaceId:string,senderDomainId:string):Promise<void>;
  listDnsEvidence(workspaceId:string,senderDomainId:string,customerOnly?:boolean):Promise<Array<{purpose:string;ownership:string;recordType:string;name:string;expectedValue:string;observedValues?:unknown;verificationStatus:string;customerActionRequired:boolean;validationMethod?:string|null;lastCheckedAt?:Date|null}>>;
  upsertDeliveryRoute(input:{workspaceId:string;senderDomainId:string;provider:string;providerRegion:string;providerIdentityReference?:string;configurationSetName?:string;mailFromDomain?:string;trackingMode:string;trackingHostname?:string;status:string;holdReason?:string|null;rateLimitPerSecond?:number;warmingDailyLimit?:number}):Promise<{id:string;status:string}>;
  senderIdentityCount(workspaceId:string,senderDomainId:string):Promise<number>;
  workspaceOperationalReadiness(workspaceId:string):Promise<{businessReady:boolean;feedbackReady:boolean;unsubscribeReady:boolean;held:boolean}>;
  upsertWorkspaceProviderConfig(input:{workspaceId:string;provider:string;region:string}):Promise<{configurationSetName?:string|null}>;
  updateWorkspaceProviderConfigurationSet(workspaceId:string,provider:string,name:string):Promise<void>;
  upsertProviderQuotaSnapshot(input:{provider:string;region:string;max24Hour?:number;maxSendRate?:number;sentLast24Hours?:number;fetchedAt:Date;expiresAt:Date}):Promise<void>;
  scheduleDomainVerification(input:{workspaceId:string;senderDomainId:string;dueAt:Date;reason:string}):Promise<void>;
  archiveProvisioningDomain(workspaceId:string,senderDomainId:string,at:Date,reason?:string|null):Promise<void>;
  holdDomainRoute(workspaceId:string,senderDomainId:string,reason:string):Promise<void>;
  hasActiveDeliveryAttempts(workspaceId:string,senderDomainId:string):Promise<boolean>;
  claimDomainProvisioning(input:{workspaceId:string;senderDomainId:string;owner:string;leaseUntil:Date}):Promise<boolean>;
  releaseDomainProvisioning(input:{workspaceId:string;senderDomainId:string;owner:string}):Promise<void>;
  recordAudit?(input:{workspaceId:string;action:string;objectId:string;riskLevel:string;after?:unknown;before?:unknown}):Promise<void>;
}
