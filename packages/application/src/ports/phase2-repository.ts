import type { EmailDraft, PublishedEmailVersion, StructuredEmailDocument } from "../../../domain/src/phase2/content.js";
import type { MessagePolicyDecision } from "../../../domain/src/phase2/message-policy.js";
import type { SendPolicyConfig } from "../../../domain/src/phase2/send-policy.js";

export interface P2Profile {id:string;workspaceId:string;normalizedEmail:string;originalEmail:string;firstName?:string|null;lastName?:string|null;timezone?:string|null}
export interface P2EventSample { id:string; eventName:string; schemaVersion:number; occurredAt:Date; properties:Record<string,unknown> }
export interface P2EmailTemplate { id:string; workspaceId:string; name:string; category:string|null; document:StructuredEmailDocument; subject:string; preheader:string; plainText:string; settings:Record<string,unknown>|null; editorType:string|null; sourceType:string|null; templateType:string; importMethod:string|null; originalFilename:string|null; originalSourceHtml:string|null; sanitizedHtml:string|null; conversionStatus:string; importWarnings:Array<{code:string;severity:"warning"|"error";message:string}>|null; importedAt:Date|null; importedByUserId:string|null; createdById:string|null; updatedById:string|null; archivedAt:Date|null; createdAt:Date; updatedAt:Date }
export interface P2UniversalBlock {id:string;workspaceId:string;name:string;category:string|null;blocks:StructuredEmailDocument["blocks"];archivedAt:Date|null;createdAt:Date;updatedAt:Date}
export interface P2MediaAsset {id:string;workspaceId:string;name:string;url:string;altText:string;mimeType:string;archivedAt:Date|null;createdAt:Date;updatedAt:Date}
export interface P2BrandKit {workspaceId:string;logoUrl:string|null;primaryColor:string;secondaryColor:string;fontFamily:string;updatedAt:Date}
export interface P2ContentVariable {id:string;workspaceId:string;key:string;label:string;defaultValue:string;type:"text"|"url";archivedAt:Date|null;createdAt:Date;updatedAt:Date}
export interface P2TemplateVersion {id:string;workspaceId:string;templateId:string;versionNumber:number;document:StructuredEmailDocument;subject:string;preheader:string;plainText:string;settings:Record<string,unknown>|null;contentHash:string;approvedAt:Date;approvedBy:string}
export interface P2TemplateUsage {id:string;workspaceId:string;templateId:string;templateVersionId:string|null;usageType:"email"|"flow";referenceId:string;label:string;createdAt:Date}
export interface P2TemplateLibraryInput { cursor?:string; limit:number; query?:string; archived?:boolean }
export interface P2TemplateLibraryPage { items:P2EmailTemplate[]; nextCursor:string|null }
export interface P2Workspace {id:string;businessAddress:string;timezone:string;legalName:string}
export interface P2SenderIdentity {id:string;workspaceId:string;domainId:string;fromName:string;fromEmail:string;replyTo:string;purpose:"marketing"|"transactional";status:string}
export interface P2SenderDomain {id:string;workspaceId:string;domain:string;rootDomain?:string|null;sendingPurpose?:"marketing"|"transactional"|null;workspacePrimary?:boolean;status:string;providerRegion?:string|null;providerReference?:string|null;provisioningMode?:string;provisioningVersion?:string|null;authenticationStatus?:string;readinessStatus?:string;dkimStatus?:string|null;mailFromStatus?:string|null;mailFromDomain?:string|null;dkimSigningMode?:string|null;delegatedSubdomain?:string|null;trackingDomain?:string|null}
export interface P2WorkspaceProviderConfig {provider:string;region:string;configurationSetName?:string|null;providerStatus:string}
export interface P2DeliveryRoute {id:string;workspaceId:string;senderDomainId:string;provider:string;providerRegion:string;providerIdentityReference?:string|null;configurationSetName?:string|null;mailFromDomain?:string|null;trackingMode:string;trackingHostname?:string|null;status:string;holdReason?:string|null;rateLimitPerSecond?:number|null;warmingDailyLimit?:number|null}
export interface P2Message {id:string;workspaceId:string;sourceType:string;sourceId:string;flowRunId?:string|null;nodeId?:string|null;profileId:string;emailVersionId:string;emailTestSnapshotId?:string|null;idempotencyKey:string;state:string;policyDecision?:unknown;scheduledFor:Date;renderedAt?:Date|null;submittedAt?:Date|null;finalAt?:Date|null;firstOpenedAt?:Date|null;lastOpenedAt?:Date|null;openCount:number;createdAt:Date}
export interface P2DeliveryAttempt {id:string;workspaceId:string;messageId:string;attemptNumber:number;provider:string;routeId?:string|null;requestFingerprint:string;providerMessageId?:string|null;state:string}
export interface P2Hold {id:string;workspaceId:string;scopeType:string;scopeId?:string|null;reason:string;state:string;createdAt:Date;releasedAt?:Date|null}
export interface P2TrackingLink {id:string;workspaceId:string;messageId:string;destination:string}
export interface P2AnalyticsPeriod {submitted:number;delivered:number;bounces:number;complaints:number;uniqueClicks:number;uniqueOpens:number;from:Date;to:Date;freshness:Date}

export interface Phase2Repository {
  transaction<T>(fn:(tx:Phase2Repository)=>Promise<T>):Promise<T>;
  memberRole(workspaceId:string,userId:string):Promise<string|null>;
  workspace(workspaceId:string):Promise<P2Workspace|null>;
  profile(workspaceId:string,profileId:string):Promise<P2Profile|null>;
  searchProfiles(workspaceId:string,query:string,limit:number):Promise<P2Profile[]>;
  eventSample(workspaceId:string,eventId:string,profileId:string):Promise<P2EventSample|null>;
  subscriptionStatus(workspaceId:string,profileId:string):Promise<string>;
  activeProtectedSuppression(workspaceId:string,profileId:string):Promise<boolean>;
  senderIdentity(workspaceId:string,id:string):Promise<P2SenderIdentity|null>;
  senderDomain(workspaceId:string,id:string):Promise<P2SenderDomain|null>;
  workspaceProviderConfig(workspaceId:string,provider:string):Promise<P2WorkspaceProviderConfig|null>;
  deliveryRoute?(workspaceId:string,senderDomainId:string):Promise<P2DeliveryRoute|null>;

  createEmail(input:{workspaceId:string;name:string;authoringMode:string;draftDocument:StructuredEmailDocument;plainText:string}):Promise<EmailDraft>;
  emailDraft(workspaceId:string,emailId:string):Promise<EmailDraft|null>;
  listEmails(workspaceId:string):Promise<EmailDraft[]>;
  updateEmailDraft(input:{workspaceId:string;emailId:string;expectedRowVersion:number;patch:Partial<EmailDraft>}):Promise<EmailDraft>;
  listEmailVersions(workspaceId:string,emailId:string):Promise<PublishedEmailVersion[]>;
  emailVersion(workspaceId:string,versionId:string):Promise<PublishedEmailVersion|null>;
  insertEmailVersion(version:PublishedEmailVersion):Promise<PublishedEmailVersion>;
  listEmailLibrary(workspaceId:string,input:{cursor?:string;limit:number;query?:string;sort?:"updated"|"name";archived?:boolean}):Promise<{items:any[];nextCursor:string|null}>;
  savePreflight(input:{workspaceId:string;emailId:string;result:unknown;fingerprint:string}):Promise<void>;
  archiveEmail(input:{workspaceId:string;emailId:string;actorId:string;archived:boolean}):Promise<EmailDraft>;
  createTestSnapshot(input:any):Promise<any>;
  testSnapshot(workspaceId:string,id:string):Promise<any|null>;
  emailDependencies(workspaceId:string,emailId:string):Promise<any[]>;
  listEmailTemplates(workspaceId:string,input:P2TemplateLibraryInput):Promise<P2TemplateLibraryPage>;
  emailTemplate(workspaceId:string,templateId:string,input?:{includeArchived?:boolean}):Promise<P2EmailTemplate|null>;
  createEmailTemplate(input:{workspaceId:string;name:string;category?:string;document:StructuredEmailDocument;subject:string;preheader:string;plainText:string;settings?:Record<string,unknown>;editorType?:"visual"|"html"|"text";sourceType?:string;actorId:string}):Promise<P2EmailTemplate>;
  createImportedEmailTemplate(input:{workspaceId:string;name:string;category?:string;document:StructuredEmailDocument;subject:string;preheader:string;plainText:string;settings?:Record<string,unknown>;actorId:string;templateType:string;importMethod:string;originalFilename:string|null;originalSourceHtml:string; sanitizedHtml:string;conversionStatus:string;importWarnings:P2EmailTemplate["importWarnings"];importedAt:Date;importedByUserId:string}):Promise<P2EmailTemplate>;
  updateEmailTemplate(input:{workspaceId:string;templateId:string;name?:string;category?:string|null;document?:StructuredEmailDocument;subject?:string;preheader?:string;plainText?:string;settings?:Record<string,unknown>|null;originalSourceHtml?:string|null;sanitizedHtml?:string|null;conversionStatus?:string;templateType?:string;importWarnings?:P2EmailTemplate["importWarnings"];actorId?:string}):Promise<P2EmailTemplate>;
  archiveEmailTemplate(input:{workspaceId:string;templateId:string;archived:boolean}):Promise<P2EmailTemplate>;
  deleteEmailTemplate(input:{workspaceId:string;templateId:string}):Promise<void>;
  listUniversalBlocks(workspaceId:string,input:{archived?:boolean}):Promise<P2UniversalBlock[]>;
  createUniversalBlock(input:{workspaceId:string;name:string;category?:string;blocks:StructuredEmailDocument["blocks"];actorId:string}):Promise<P2UniversalBlock>;
  updateUniversalBlock(input:{workspaceId:string;blockId:string;name?:string;category?:string|null;blocks?:StructuredEmailDocument["blocks"]}):Promise<P2UniversalBlock>;
  archiveUniversalBlock(input:{workspaceId:string;blockId:string;archived:boolean}):Promise<P2UniversalBlock>;
  listMediaAssets(workspaceId:string,input:{archived?:boolean}):Promise<P2MediaAsset[]>;
  createMediaAsset(input:{workspaceId:string;name:string;url:string;altText:string;mimeType:string;actorId:string;objectKey?:string;assetId?:string}):Promise<P2MediaAsset>;
  contentAssetObjectKey?(workspaceId:string,assetId:string):Promise<string|null>;
  archiveMediaAsset(input:{workspaceId:string;assetId:string;archived:boolean}):Promise<P2MediaAsset>;
  brandKit(workspaceId:string):Promise<P2BrandKit|null>;
  upsertBrandKit(input:{workspaceId:string;logoUrl:string|null;primaryColor:string;secondaryColor:string;fontFamily:string}):Promise<P2BrandKit>;
  listContentVariables(workspaceId:string,input:{archived?:boolean}):Promise<P2ContentVariable[]>;
  createContentVariable(input:{workspaceId:string;key:string;label:string;defaultValue:string;type:"text"|"url";actorId:string}):Promise<P2ContentVariable>;
  archiveContentVariable(input:{workspaceId:string;variableId:string;archived:boolean}):Promise<P2ContentVariable>;
  listTemplateVersions(workspaceId:string,templateId:string):Promise<P2TemplateVersion[]>;
  insertTemplateVersion(input:Omit<P2TemplateVersion,"id">):Promise<P2TemplateVersion>;
  recordTemplateUsage(input:{workspaceId:string;templateId:string;templateVersionId?:string;usageType:"email";referenceId:string;label:string}):Promise<void>;
  recordTemplateImportAudit(input:{workspaceId:string;userId:string;importMethod:string;filename:string|null;templateId:string;processingResult:string;warningCount:number}):Promise<void>;
  templateUsage(workspaceId:string,templateId:string):Promise<P2TemplateUsage[]>;
  audit(input:{workspaceId:string;actorId:string;action:string;objectType:string;objectId?:string;riskLevel:string;before?:unknown;after?:unknown}):Promise<void>;

  createMessage(input:{workspaceId:string;sourceType:string;sourceId:string;flowRunId?:string;nodeId?:string;profileId:string;emailVersionId?:string;emailTestSnapshotId?:string;idempotencyKey:string;scheduledFor:Date}):Promise<P2Message>;
  message(workspaceId:string,messageId:string):Promise<P2Message|null>;
  messageByIdempotency(workspaceId:string,key:string):Promise<P2Message|null>;
  updateMessage(input:{workspaceId:string;messageId:string;state:string;policyDecision?:MessagePolicyDecision;renderedHash?:string;renderedAt?:Date;submittedAt?:Date;finalAt?:Date}):Promise<P2Message>;
  trace(workspaceId:string,messageId:string):Promise<Array<{kind:string;occurredAt:Date;detail:unknown}>>;
  addTrace(input:{workspaceId:string;messageId:string;kind:string;detail:unknown}):Promise<void>;
  addFlowRunTrace?(input:{workspaceId:string;flowRunId:string;kind:string;detail:unknown}):Promise<void>;

  activeSendPolicy(workspaceId:string):Promise<SendPolicyConfig>;
  saveSendPolicy(workspaceId:string,actorId:string,config:SendPolicyConfig):Promise<void>;
  activeHolds(workspaceId:string):Promise<P2Hold[]>;
  createHold(input:{workspaceId:string;scopeType:string;scopeId?:string;reason:string;actorId:string}):Promise<P2Hold>;
  releaseHold(input:{workspaceId:string;holdId:string;reason:string}):Promise<void>;
  frequencyCount(workspaceId:string,profileId:string,since:Date):Promise<number>;
  reserveFrequency(input:{workspaceId:string;profileId:string;messageId:string;expiresAt:Date}):Promise<boolean>;
  consumeFrequency(workspaceId:string,messageId:string):Promise<void>;
  releaseFrequency(workspaceId:string,messageId:string):Promise<void>;
  submittedToday(workspaceId:string,since:Date):Promise<number>;
  feedbackSafetyCurrent(workspaceId:string,staleAfterSeconds:number,now:Date):Promise<boolean>;

  saveArtifact(input:{workspaceId:string;messageId:string;objectKey:string;contentHash:string;mimeHash:string;byteSize:number;compilerVersion:string;sanitizerVersion:string}):Promise<void>;
  artifact(workspaceId:string,messageId:string):Promise<{objectKey:string;mimeHash:string;contentHash:string}|null>;
  createAttempt(input:{workspaceId:string;messageId:string;attemptNumber:number;provider:string;routeId?:string;requestFingerprint:string}):Promise<P2DeliveryAttempt>;
  updateAttempt(input:{workspaceId:string;attemptId:string;state:string;providerMessageId?:string;errorCode?:string}):Promise<void>;
  attemptByProviderMessageId(providerMessageId:string):Promise<P2DeliveryAttempt|null>;
  feedbackAuthority?(provider:string,providerMessageId:string):Promise<{attempt:P2DeliveryAttempt;message:P2Message;route:P2DeliveryRoute|null}|null>;
  reserveDeliveryCapacity?(input:{workspaceId:string;route?:P2DeliveryRoute;messageId:string;now:Date}):Promise<boolean>;

  recordControlledSubmissionGate?(input:{workspaceId:string;messageId:string}):Promise<void>;
  recordDeliveryEvent(input:{workspaceId:string;messageId:string;provider:string;providerEventId:string;eventType:string;occurredAt:Date;payload:unknown}):Promise<boolean>;
  recordMessageOpen(input:{workspaceId:string;messageId:string;occurredAt:Date}):Promise<void>;
  createProtectedSuppression(input:{workspaceId:string;profileId:string;reason:"hard_bounce"|"complaint";sourceReference:string}):Promise<void>;
  createTrackingLink(input:{workspaceId:string;messageId:string;destination:string;destinationHash:string}):Promise<P2TrackingLink>;
  trackingLink(workspaceId:string,id:string):Promise<P2TrackingLink|null>;
  engagementFact(input:{workspaceId:string;messageId:string;kind:"click"|"open";classification:string;occurredAt:Date;metadata?:unknown}):Promise<void>;
  analyticsSummary(workspaceId:string,since:Date):Promise<Record<string,number>>;
  analyticsPeriod(workspaceId:string,from:Date,to:Date):Promise<P2AnalyticsPeriod>;
}
