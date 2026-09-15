import type { Role } from "../../../domain/src/phase1/permissions.js";
import type { ConsentStatus, SuppressionReason } from "../../../domain/src/phase1/consent.js";
import type { PropertyType } from "../../../domain/src/phase1/profile.js";
import type { ImportMapping, ImportPolicy } from "../../../domain/src/phase1/import-policy.js";

export interface DbWorkspace { id:string; name:string; legalName:string; businessAddress:string; timezone:string; locale:string; status:string; rowVersion:bigint; }
export interface DbMember { id:string; workspaceId:string; userId:string; role:Role; status:string; email?:string; displayName?:string|null; invitedBy?:string|null; createdAt?:Date; updatedAt?:Date; }
export interface DbProfile { id:string; workspaceId:string; normalizedEmail:string; originalEmail:string; firstName?:string|null; lastName?:string|null; locale?:string|null; timezone?:string|null; countryCode?:string|null; region?:string|null; city?:string|null; source:string; rowVersion:bigint; deletedAt?:Date|null; }
export interface DbPropertyDefinition { id:string;workspaceId:string;key:string;displayName:string;dataType:PropertyType;isArray:boolean;status:string; }
export interface DbAudienceList { id:string;workspaceId:string;name:string;description?:string|null;status:string;archivedAt?:Date|null; }
export interface DbSenderDomain { id:string;workspaceId:string;workspacePrimary?:boolean;domain:string;status:string;expectedRecords?:unknown;observedRecords?:unknown;providerReference?:string|null;providerRegion?:string|null;providerStatus?:string|null;providerEvidence?:unknown;dkimStatus?:string|null;mailFromStatus?:string|null;dmarcStatus?:string|null;verificationStatus?:string|null;delegationStatus?:string|null;soaStatus?:string|null;dkimTokens?:unknown;dkimSigningHostedZone?:string|null;ownershipVerificationToken?:string|null;ownershipVerificationTokenHash?:string|null;ownershipVerificationStatus?:string|null;ownershipVerifiedAt?:Date|null;dkimSigningMode?:string|null;dkimSigningDomain?:string|null;dkimSelector?:string|null;dkimPublicKey?:string|null;dkimPrivateKeySecretRef?:string|null;dkimStandbySelector?:string|null;dkimStandbyPublicKey?:string|null;dkimStandbyPrivateKeySecretRef?:string|null;dkimRotationState?:string|null;dkimRotationGraceUntil?:Date|null;setupMode?:string|null;routingId?:string|null;dnsStatus?:string|null;dmarcObservation?:unknown;lastCheckedAt?:Date|null;verifiedAt?:Date|null;rootDomain?:string|null;delegatedSubdomain?:string|null;provisioningMode:string;provisioningVersion?:string|null;provisioningCallerReference?:string|null;lifecycleState:string;authenticationStatus:string;readinessStatus:string;readinessReasons?:unknown;dnsProvider?:string|null;hostedZoneReference?:string|null;delegationSetReference?:string|null;mailFromDomain?:string|null;trackingDomain?:string|null;trackingProvider?:string|null;trackingTenantReference?:string|null;trackingConnectionGroupReference?:string|null;trackingRoutingEndpoint?:string|null;trackingCertificateReference?:string|null;trackingCertificateStatus?:string|null;trackingHttpsStatus?:string|null;trackingValidationMethod?:string|null;lastErrorCode?:string|null;lastErrorMessage?:string|null;archivedAt?:Date|null; }
export interface DbWorkspaceProviderConfig { workspaceId:string;provider:string;region:string;sesTenantName?:string|null;configurationSetName?:string|null;providerStatus:string; }
export interface DbSenderIdentity { id:string;workspaceId:string;domainId:string;fromName:string;fromEmail:string;replyTo:string;status:string; }
export interface DbImportJob { id:string;workspaceId:string;state:string;objectKey?:string|null;originalName?:string|null;contentHash?:string|null;mapping?:ImportMapping|null;policy?:ImportPolicy|null;totals?:unknown;createdBy?:string|null;createdAt:Date;completedAt?:Date|null; }
export interface DbExportJob { id:string;workspaceId:string;state:string;scope:unknown;fields:string[];purpose?:string|null;objectKey?:string|null;tokenHash?:string|null;expiresAt?:Date|null;recordCount?:number|null;createdBy:string; }

export interface Phase1Repository {
  transaction<T>(fn:(tx:Phase1Repository)=>Promise<T>):Promise<T>;
  ensureUser(input:{provider:string;subject:string;email:string;displayName?:string}):Promise<{id:string;email:string}>;
  createWorkspace(input:{userId:string;name:string;legalName:string;businessAddress:string;timezone:string;locale:string}):Promise<DbWorkspace>;
  listWorkspacesForUser(userId:string):Promise<DbWorkspace[]>;
  findWorkspace(workspaceId:string):Promise<DbWorkspace|null>;
  updateWorkspace(workspaceId:string,expectedRowVersion:bigint,patch:Partial<Pick<DbWorkspace,"name"|"legalName"|"businessAddress"|"timezone"|"locale">>):Promise<DbWorkspace>;
  findMember(workspaceId:string,userId:string):Promise<DbMember|null>;
  listMembers(workspaceId:string):Promise<DbMember[]>;
  createInvitation(input:{workspaceId:string;email:string;role:Role;tokenHash:string;invitedBy:string;expiresAt:Date}):Promise<{id:string}>;
  acceptInvitation(tokenHash:string,email:string,userId:string):Promise<DbMember>;
  updateMemberRole(workspaceId:string,memberId:string,role:Role):Promise<DbMember>;
  revokeMember(workspaceId:string,memberId:string):Promise<DbMember>;
  transferOwnership(workspaceId:string,fromMemberId:string,toMemberId:string):Promise<{from:DbMember;to:DbMember}>;

  upsertProfile(input:{workspaceId:string;email:string;normalizedEmail:string;firstName?:string;lastName?:string;locale?:string;timezone?:string;countryCode?:string;region?:string;city?:string;source:string;expectedRowVersion?:bigint}):Promise<{profile:DbProfile;created:boolean;before?:unknown}>;
  findProfile(workspaceId:string,profileId:string):Promise<DbProfile|null>;
  findProfileByEmail(workspaceId:string,normalizedEmail:string):Promise<DbProfile|null>;
  listProfiles(input:{workspaceId:string;q?:string;limit:number;cursorId?:string|null}):Promise<DbProfile[]>;
  profileTimeline(workspaceId:string,profileId:string):Promise<Array<{id:string;kind:string;occurredAt:Date;detail:unknown}>>;
  defineProperty(input:{workspaceId:string;key:string;displayName:string;dataType:PropertyType;isArray:boolean}):Promise<DbPropertyDefinition>;
  listPropertyDefinitions(workspaceId:string):Promise<DbPropertyDefinition[]>;
  setPropertyValue(input:{workspaceId:string;profileId:string;definition:DbPropertyDefinition;value:unknown;source:string}):Promise<void>;
  mergeProfiles(input:{workspaceId:string;canonicalId:string;sourceId:string;actorId:string}):Promise<DbProfile>;
  deleteProfile(input:{workspaceId:string;profileId:string}):Promise<DbProfile>;

  createList(input:{workspaceId:string;name:string;description?:string}):Promise<DbAudienceList>;
  listLists(workspaceId:string):Promise<DbAudienceList[]>;
  findList(workspaceId:string,listId:string):Promise<DbAudienceList|null>;
  updateList(input:{workspaceId:string;listId:string;name?:string;description?:string}):Promise<DbAudienceList>;
  listMemberships(workspaceId:string,listId:string):Promise<Array<{profileId:string;state:string;sourceType:string;sourceId?:string|null;joinedAt:Date;leftAt?:Date|null}>>;
  setMembership(input:{workspaceId:string;listId:string;profileId:string;state:"active"|"left";sourceType:string;sourceId?:string;actorId:string}):Promise<void>;
  archiveList(workspaceId:string,listId:string):Promise<DbAudienceList>;

  appendConsent(input:{workspaceId:string;profileId:string;status:ConsentStatus;source:string;occurredAt:Date;actorId:string;evidenceObjectKey?:string;jurisdiction?:string}):Promise<{id:string}>;
  currentSubscription(workspaceId:string,profileId:string):Promise<ConsentStatus|"unknown">;
  listConsent(workspaceId:string,profileId:string):Promise<Array<{id:string;status:ConsentStatus;source:string;occurredAt:Date}>>;
  createSuppression(input:{workspaceId:string;profileId:string;reason:SuppressionReason;source:string;protected:boolean;expiresAt?:Date}):Promise<{id:string;reason:SuppressionReason;protected:boolean;revokedAt?:Date|null;expiresAt?:Date|null}>;
  listActiveSuppressions(workspaceId:string,profileId:string):Promise<Array<{id:string;reason:SuppressionReason;protected:boolean;revokedAt?:Date|null;expiresAt?:Date|null}>>;
  listSuppressions(workspaceId:string):Promise<Array<{id:string;profileId:string;reason:SuppressionReason;protected:boolean;source:string;createdAt:Date;revokedAt?:Date|null;expiresAt?:Date|null}>>;
  revokeSuppression(workspaceId:string,suppressionId:string):Promise<void>;

  createImport(input:{workspaceId:string;objectKey:string;originalName:string;checksum:string;contentHash:string;createdBy:string}):Promise<DbImportJob>;
  findImport(workspaceId:string,importId:string):Promise<DbImportJob|null>;
  findCompletedImportByHash(workspaceId:string,contentHash:string):Promise<DbImportJob|null>;
  updateImport(input:{workspaceId:string;importId:string;state:string;mapping?:ImportMapping;policy?:ImportPolicy;totals?:unknown;completedAt?:Date}):Promise<DbImportJob>;
  replaceImportRows(workspaceId:string,importId:string,rows:Array<{rowNumber:number;state:string;errors:string[];profileId?:string}>):Promise<void>;
  replaceImportChunks(workspaceId:string,importId:string,chunks:Array<{chunkIndex:number;rowStart:number;rowEnd:number;state:string}>):Promise<void>;
  completeImportChunk(workspaceId:string,importId:string,chunkIndex:number):Promise<void>;
  restoreProfileSnapshot(input:{workspaceId:string;profileId:string;expectedRevision:bigint;snapshot:unknown}):Promise<boolean>;
  recordImportChange(input:{workspaceId:string;importJobId:string;profileId:string;changeType:string;fieldKey?:string;before?:unknown;after?:unknown;revision?:bigint}):Promise<void>;
  listImportChanges(workspaceId:string,importId:string):Promise<Array<{profileId:string;changeType:string;fieldKey?:string|null;before?:unknown;after?:unknown;revision?:bigint|null}>>;
  listImports(workspaceId:string):Promise<DbImportJob[]>;

  createExport(input:{workspaceId:string;scope:unknown;fields:string[];purpose?:string;tokenHash:string;expiresAt:Date;createdBy:string}):Promise<DbExportJob>;
  findExport(workspaceId:string,exportId:string):Promise<DbExportJob|null>;
  completeExport(input:{workspaceId:string;exportId:string;objectKey:string;recordCount:number}):Promise<DbExportJob>;

  createDomain(input:{workspaceId:string;domain:string;expectedRecords?:unknown;providerReference?:string;providerRegion?:string;providerStatus?:string;providerEvidence?:unknown;dkimStatus?:string|null;mailFromStatus?:string|null}):Promise<DbSenderDomain>;
  findDomain(workspaceId:string,domainId:string):Promise<DbSenderDomain|null>;
  findDomainByName(workspaceId:string,domain:string):Promise<DbSenderDomain|null>;
  findDomainOutsideWorkspace(workspaceId:string,domain:string):Promise<{id:string}|null>;
  listDomains(workspaceId:string):Promise<DbSenderDomain[]>;
  deleteDomain(workspaceId:string,domainId:string):Promise<void>;
  countSenderIdentitiesForDomain(workspaceId:string,domainId:string):Promise<number>;
  /**
   * Permanently removes identities bound to a domain and clears editable
   * drafts that still point to them. Published versions remain immutable
   * history and cannot send after the domain route is archived.
   */
  deleteSenderIdentitiesForDomain(workspaceId:string,domainId:string):Promise<number>;
  updateDomainCheck(input:{workspaceId:string;domainId:string;status:string;observedRecords:unknown;expectedRecords?:unknown;providerReference?:string;providerRegion?:string;providerStatus?:string;providerEvidence?:unknown;dkimStatus?:string|null;mailFromStatus?:string|null;verifiedAt?:Date}):Promise<DbSenderDomain>;
  upsertWorkspaceProviderConfig(input:{workspaceId:string;provider:string;region:string}):Promise<DbWorkspaceProviderConfig>;
  workspaceProviderConfig(workspaceId:string,provider:string):Promise<DbWorkspaceProviderConfig|null>;
  createSenderIdentity(input:{workspaceId:string;domainId:string;fromName:string;fromEmail:string;replyTo:string}):Promise<DbSenderIdentity>;
  listSenderIdentities(workspaceId:string):Promise<DbSenderIdentity[]>;
  upsertReadiness(workspaceId:string,checks:Array<{key:string;passed:boolean;evidence?:unknown}>):Promise<void>;

  audit(input:{workspaceId:string;actorId:string;action:string;objectType:string;objectId?:string;riskLevel:string;before?:unknown;after?:unknown;requestId?:string;correlationId?:string}):Promise<void>;
  listAudit(workspaceId:string,limit:number):Promise<Array<{id:string;action:string;objectType:string;objectId?:string|null;riskLevel:string;occurredAt:Date}>>;
}
