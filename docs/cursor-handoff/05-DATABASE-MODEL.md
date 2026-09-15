# Database model

## Persistence boundary

PostgreSQL through Prisma 6.0.0 is the real runtime source of truth. The schema defines **86 models** and string-valued status fields, not Prisma state enums. Phase0 JSON ProofStore and in-memory repositories are test/proof alternatives, not the deployed tenant database.

The exact model inventory below includes every field/constraint from the inspected schema, a purpose, tenant scope, relationships and lifecycle guidance. Scalar IDs often represent logical references; consult migration SQL for foreign keys not declared with Prisma @relation. There is no demonstrated blanket database RLS enforcement. workspaceId in a table is not sufficient without authorized query predicates.

## Core relationships

Workspace owns profiles, membership, consent, audience, content, domains, policies and runs. Profile connects identifiers/properties, ConsentRecord, SubscriptionState, Suppression and memberships. EmailDefinition publishes EmailVersion; Flow publishes FlowVersion and dependency indexes. FlowRun pins a profile/version; FlowNodeExecution and ScheduledAction drive work; email nodes create Message. Message connects rendered artifacts, DeliveryAttempt, DeliveryEvent and TrackingLink. InboxMessage deduplicates external events; OutboxEvent emits local consequences; AuditEvent and TraceEvent preserve decisions.

Global identities and gate/governance tables require an explicit platform-level access boundary. Nullable-workspace inbox rows are initially untrusted/unmatched, not safe tenant-owned events.

## Migration and database observations

The inspected local database reported 23 applied migrations and no failed/rolled-back entries. Latest is 20260903000100_scheduled_action_dedupe_constraint. The audit did not apply migrations.

That latest migration changes scheduled_action deduplication_key from partial unique indexing to a full unique constraint compatible with Prisma native upsert ON CONFLICT. PostgreSQL permits multiple NULLs under that full unique constraint, preserving optional dedupe behavior. This fixes the previously observed 42P10 failure.

SQL-only constraints include active workspace/domain claims and active protected-suppression uniqueness. In particular suppression_active_reason_unique covers workspace/profile/channel/reason only when revoked_at IS NULL. Sender-domain active-root uniqueness is case-normalized and archive-sensitive. outbox_event's deduplication index remains partial while Prisma declares @unique: future native upsert usage may encounter the same inference mismatch. Do not perform a broad schema push to “fix drift” without checking these intentional SQL rules.

## Lifecycle and deletion rules

Draft content is mutable; published content/flow/template snapshots are immutable. Consent/provider/audit facts are retained. Domain disconnect removes owned AWS resources and active identity/draft references but archives domain/route records; it does not erase delivery history. Privacy deletion must reconcile these retention boundaries deliberately.

BigInt row versions and some counters need API serialization; primary APIs use a BigInt replacer. Import rollback uses ImportChange, not destructive truncation. Event and intent dedupe constraints are necessary but do not serialize SES external calls. See chapters07,08 and20.

## Complete model reference

## Workspace

Tenant/business settings and common profile, content and policy ownership.

- Table: `workspace`; [schema source](../../packages/persistence/prisma/schema.prisma#L10).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`, `rowVersion`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
name            String
legalName       String   @map("legal_name")
businessAddress String   @map("business_address")
timezone        String
locale          String   @default("en")
status          String
rowVersion      BigInt   @default(1) @map("row_version")
sendingEnabled  Boolean  @default(false) @map("sending_enabled")
senderReady     Boolean  @default(false) @map("sender_ready")
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
profiles        Profile[]
emailDefinitions EmailDefinition[]
sendPolicies     SendPolicy[]
operationalHolds OperationalHold[]
```

## Profile

Customer identity and contact/location fields; soft deletion and merge-aware ownership.

- Table: `profile`; [schema source](../../packages/persistence/prisma/schema.prisma#L31).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `deletedAt`, `rowVersion`
- Declared Prisma relationships: `workspace       Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)`
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, normalizedEmail])`; `@@index([workspaceId, createdAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
normalizedEmail String   @map("normalized_email")
originalEmail   String   @map("original_email")
firstName       String?  @map("first_name")
lastName        String?  @map("last_name")
locale          String?
timezone        String?
countryCode     String?  @map("country_code")
region          String?
city            String?
source          String
sourceDetails   Json?    @map("source_details_json") @db.JsonB
firstSeenAt     DateTime @default(now()) @map("first_seen_at") @db.Timestamptz(6)
lastSeenAt      DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(6)
engagementSummary Json? @map("engagement_summary_json") @db.JsonB
eligibilityProjection Json? @map("eligibility_projection_json") @db.JsonB
deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
rowVersion      BigInt   @default(1) @map("row_version")
workspace       Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)
```

## ConsentRecord

Append-only channel/purpose permission evidence, independent of list membership.

- Table: `consent_record`; [schema source](../../packages/persistence/prisma/schema.prisma#L59).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId`, `actorId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, profileId, channel, purpose, occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
workspaceId  String   @map("workspace_id") @db.Uuid
profileId    String   @map("profile_id") @db.Uuid
channel      String
purpose      String
status       String
occurredAt   DateTime @map("occurred_at") @db.Timestamptz(6)
recordedAt   DateTime @default(now()) @map("recorded_at") @db.Timestamptz(6)
source       String
sourceDetails Json?   @map("source_details_json") @db.JsonB
jurisdiction String?
evidenceObjectKey String? @map("evidence_object_key")
actorId      String?  @map("actor_id") @db.Uuid
```

## Suppression

Delivery/marketing blockers with scope, protected reason and revocation lifecycle.

- Table: `suppression`; [schema source](../../packages/persistence/prisma/schema.prisma#L77).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `expiresAt`, `revokedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, profileId, channel, revokedAt])`; `@@index([workspaceId, channel, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
profileId       String   @map("profile_id") @db.Uuid
channel         String
scope           String
reason          String
source          String
sourceReference String?  @map("source_reference")
protected       Boolean  @default(false)
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
revokedAt       DateTime? @map("revoked_at") @db.Timestamptz(6)
metadataJson    Json?    @map("metadata_json") @db.JsonB
```

## SenderDomain

Domain claim, V1/V2 discriminator, DNS/SES/tracking evidence, readiness, lease and archive lifecycle.

- Table: `sender_domain`; [schema source](../../packages/persistence/prisma/schema.prisma#L96).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`, `providerStatus`, `dkimStatus`, `mailFromStatus`, `dmarcStatus`, `verificationStatus`, `delegationStatus`, `soaStatus`, `lifecycleState`, `authenticationStatus`, `readinessStatus`, `trackingCertificateStatus`, `trackingHttpsStatus`, `disconnectStatus`, `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, domain])`; `@@index([workspaceId, status])`; `@@index([workspaceId, lifecycleState])`; `@@index([workspaceId, readinessStatus])`; `@@index([workspaceId, workspacePrimary])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                String   @id @default(uuid()) @db.Uuid
workspaceId       String   @map("workspace_id") @db.Uuid
workspacePrimary  Boolean  @default(false) @map("workspace_primary")
domain             String
status             String
expectedRecords    Json?    @map("expected_records_json") @db.JsonB
observedRecords    Json?    @map("observed_records_json") @db.JsonB
providerReference  String?  @map("provider_identity_reference")
providerRegion     String?  @map("provider_region")
providerStatus     String?  @map("provider_status")
providerEvidence   Json?    @map("provider_evidence_json") @db.JsonB
dkimStatus         String?  @map("dkim_status")
mailFromStatus     String?  @map("mail_from_status")
dmarcStatus        String?  @map("dmarc_status")
verificationStatus String? @map("verification_status")
delegationStatus String? @map("delegation_status")
soaStatus String? @map("soa_status")
dkimTokens Json? @map("dkim_tokens_json") @db.JsonB
dkimSigningHostedZone String? @map("dkim_signing_hosted_zone")
dmarcObservation Json? @map("dmarc_observation_json") @db.JsonB
rootDomain         String?  @map("root_domain")
delegatedSubdomain String?  @map("delegated_subdomain")
provisioningMode  String   @default("legacy_ses_records") @map("provisioning_mode")
provisioningVersion String @default("V1_LEGACY_SEND_SUBDOMAIN") @map("provisioning_version")
provisioningCallerReference String? @map("provisioning_caller_reference")
provisioningLeaseOwner String? @map("provisioning_lease_owner")
provisioningLeaseExpiresAt DateTime? @map("provisioning_lease_expires_at") @db.Timestamptz(6)
lifecycleState    String   @default("created") @map("lifecycle_state")
authenticationStatus String @default("pending") @map("authentication_status")
readinessStatus   String   @default("not_ready") @map("readiness_status")
readinessReasons  Json?    @map("readiness_reasons_json") @db.JsonB
dnsProvider       String?  @map("dns_provider")
hostedZoneReference String? @map("hosted_zone_reference")
delegationSetReference String? @map("delegation_set_reference")
mailFromDomain    String?  @map("mail_from_domain")
trackingDomain    String?  @map("tracking_domain")
trackingProvider  String?  @map("tracking_provider")
trackingTenantReference String? @map("tracking_tenant_reference")
trackingConnectionGroupReference String? @map("tracking_connection_group_reference")
trackingRoutingEndpoint String? @map("tracking_routing_endpoint")
trackingCertificateReference String? @map("tracking_certificate_reference")
trackingCertificateStatus String? @map("tracking_certificate_status")
trackingHttpsStatus String? @map("tracking_https_status")
trackingValidationMethod String? @map("tracking_validation_method")
lastErrorCode     String?  @map("last_error_code")
lastErrorMessage  String?  @map("last_error_message")
disconnectStatus String? @map("disconnect_status")
archivedAt        DateTime? @map("archived_at") @db.Timestamptz(6)
lastCheckedAt      DateTime? @map("last_checked_at") @db.Timestamptz(6)
verifiedAt         DateTime? @map("verified_at") @db.Timestamptz(6)
createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## SenderDomainTransfer

Cross-workspace domain transfer request/approval and expiry state; not full migration orchestration.

- Table: `sender_domain_transfer`; [schema source](../../packages/persistence/prisma/schema.prisma#L157).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`, `expiresAt`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `senderDomainId`, `fromWorkspaceId`, `toWorkspaceId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([senderDomainId, status])`; `@@index([toWorkspaceId, status])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
senderDomainId  String   @map("sender_domain_id") @db.Uuid
fromWorkspaceId String   @map("from_workspace_id") @db.Uuid
toWorkspaceId   String   @map("to_workspace_id") @db.Uuid
status          String   @default("pending")
challengeHash   String?  @map("challenge_hash")
expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
approvedAt      DateTime? @map("approved_at") @db.Timestamptz(6)
completedAt     DateTime? @map("completed_at") @db.Timestamptz(6)
createdBy       String   @map("created_by") @db.Uuid
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## SenderDomainDnsEvidence

Expected/observed managed and customer DNS records and verification evidence.

- Table: `sender_domain_dns_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L175).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `verificationStatus`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `senderDomainId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([senderDomainId, purpose, recordType, name, expectedValue])`; `@@index([workspaceId, senderDomainId, customerActionRequired])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                     String   @id @default(uuid()) @db.Uuid
workspaceId            String   @map("workspace_id") @db.Uuid
senderDomainId         String   @map("sender_domain_id") @db.Uuid
purpose                String
ownership              String
recordType             String   @map("record_type")
name                    String
expectedValue           String   @map("expected_value")
observedValues          Json?    @map("observed_values_json") @db.JsonB
verificationStatus     String   @map("verification_status")
customerActionRequired Boolean  @default(false) @map("customer_action_required")
validationMethod       String?  @map("validation_method")
lastCheckedAt          DateTime? @map("last_checked_at") @db.Timestamptz(6)
createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt              DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## EmailDeliveryRoute

Pinned provider/region/identity/configuration-set/tracking route authority and active/held/archive state.

- Table: `email_delivery_route`; [schema source](../../packages/persistence/prisma/schema.prisma#L196).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`, `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `senderDomainId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, senderDomainId, provider])`; `@@index([workspaceId, status])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                   String   @id @default(uuid()) @db.Uuid
workspaceId          String   @map("workspace_id") @db.Uuid
senderDomainId       String   @map("sender_domain_id") @db.Uuid
provider             String
providerRegion       String   @map("provider_region")
providerIdentityReference String? @map("provider_identity_reference")
configurationSetName String?  @map("configuration_set_name")
mailFromDomain       String?  @map("mail_from_domain")
trackingMode         String   @default("platform") @map("tracking_mode")
trackingHostname     String?  @map("tracking_hostname")
status               String   @default("provisioning")
holdReason            String?  @map("hold_reason")
rateLimitPerSecond    Int?     @map("rate_limit_per_second")
warmingDailyLimit     Int?     @map("warming_daily_limit")
createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt             DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
archivedAt            DateTime? @map("archived_at") @db.Timestamptz(6)
```

## DeliveryCapacityBucket

Atomic time-window capacity accounting for provider, workspace, domain and route limits.

- Table: `delivery_capacity_bucket`; [schema source](../../packages/persistence/prisma/schema.prisma#L219).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `scopeId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([scopeType, scopeId, windowStart, windowSeconds])`; `@@index([windowStart])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
scopeType     String   @map("scope_type")
scopeId       String   @map("scope_id")
windowStart   DateTime @map("window_start") @db.Timestamptz(6)
windowSeconds Int      @map("window_seconds")
capacityLimit Int      @map("capacity_limit")
used          Int      @default(0)
updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## ProviderQuotaSnapshot

Provider-region SES quota observation/cache with expiry; shared provider scope.

- Table: `provider_quota_snapshot`; [schema source](../../packages/persistence/prisma/schema.prisma#L233).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `expiresAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([provider, region])`; `@@index([expiresAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
provider      String
region        String
max24Hour     Decimal? @map("max_24_hour") @db.Decimal(20, 4)
maxSendRate   Decimal? @map("max_send_rate") @db.Decimal(20, 4)
sentLast24Hours Decimal? @map("sent_last_24_hours") @db.Decimal(20, 4)
fetchedAt     DateTime @map("fetched_at") @db.Timestamptz(6)
expiresAt     DateTime @map("expires_at") @db.Timestamptz(6)
```

## WorkspaceProviderConfig

Workspace SES configuration-set/provider status, not a separate AWS account.

- Table: `workspace_provider_config`; [schema source](../../packages/persistence/prisma/schema.prisma#L247).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `providerStatus`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, provider])`; `@@index([workspaceId, providerStatus])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                   String   @id @default(uuid()) @db.Uuid
workspaceId          String   @map("workspace_id") @db.Uuid
provider             String
region               String
sesTenantName        String?  @map("ses_tenant_name")
configurationSetName String?  @map("configuration_set_name")
providerStatus       String   @default("active") @map("provider_status")
createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## SenderIdentity

Workspace From name/address/Reply-To tied to a sender domain; removed/reset on disconnect.

- Table: `sender_identity`; [schema source](../../packages/persistence/prisma/schema.prisma#L262).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `domainId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, fromEmail])`; `@@index([workspaceId, domainId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
workspaceId   String   @map("workspace_id") @db.Uuid
domainId      String   @map("domain_id") @db.Uuid
fromName      String   @map("from_name")
fromEmail     String   @map("from_email")
replyTo       String   @map("reply_to")
purpose       String   @default("marketing")
status        String   @default("pending")
createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## EmailDefinition

Mutable draft with optimistic version/preflight state and published-version pointer.

- Table: `email_definition`; [schema source](../../packages/persistence/prisma/schema.prisma#L278).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `rowVersion`, `archivedAt`
- Declared Prisma relationships: `workspace           Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)`
- Logical/reference-ID fields: `draftSenderIdentityId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, updatedAt, id])`; `@@index([workspaceId, archivedAt, updatedAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                  String   @id @default(uuid()) @db.Uuid
workspaceId         String   @map("workspace_id") @db.Uuid
name                String
authoringMode       String   @default("structured") @map("authoring_mode")
draftDocumentJson   Json     @map("draft_document_json") @db.JsonB
draftHtmlSource     String?  @map("draft_html_source")
draftSubject        String   @default("") @map("draft_subject")
draftPreheader      String   @default("") @map("draft_preheader")
draftSenderIdentityId String? @map("draft_sender_identity_id") @db.Uuid
draftReplyTo        String   @default("") @map("draft_reply_to")
draftPlainText      String   @default("") @map("draft_plain_text")
plainTextMode       String   @default("manual") @map("plain_text_mode")
plainTextStale      Boolean  @default(false) @map("plain_text_stale")
trackingEnabled     Boolean  @default(true) @map("tracking_enabled")
openTrackingEnabled Boolean  @default(false) @map("open_tracking_enabled")
rowVersion          BigInt   @default(1) @map("row_version")
lastPreflightJson   Json?    @map("last_preflight_json") @db.JsonB
lastPreflightFingerprint String? @map("last_preflight_fingerprint")
lastPreflightAt     DateTime? @map("last_preflight_at") @db.Timestamptz(6)
archivedAt          DateTime? @map("archived_at") @db.Timestamptz(6)
archivedBy          String?  @map("archived_by") @db.Uuid
createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
workspace           Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)
versions            EmailVersion[]
```

## EmailTemplate

Reusable editable template and library metadata; archive/favorite/approval lifecycle.

- Table: `email_template`; [schema source](../../packages/persistence/prisma/schema.prisma#L311).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, archivedAt, updatedAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                String   @id @default(uuid()) @db.Uuid
workspaceId       String   @map("workspace_id") @db.Uuid
name              String
category          String?  @map("category")
documentJson      Json     @map("document_json") @db.JsonB
subjectTemplate   String   @default("") @map("subject_template")
preheaderTemplate String   @default("") @map("preheader_template")
plainText         String   @default("") @map("plain_text")
settingsJson      Json?    @map("settings_json") @db.JsonB
createdBy         String?  @map("created_by") @db.Uuid
archivedAt        DateTime? @map("archived_at") @db.Timestamptz(6)
createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## UniversalBlock

Reusable structured content fragments with version/archive metadata.

- Table: `universal_block`; [schema source](../../packages/persistence/prisma/schema.prisma#L329).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, archivedAt, updatedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
name String
category String?
blocksJson Json @map("blocks_json") @db.JsonB
createdBy String? @map("created_by") @db.Uuid
archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## MediaAsset

Workspace media URL/reference metadata; not proof of managed binary upload/CDN storage.

- Table: `media_asset`; [schema source](../../packages/persistence/prisma/schema.prisma#L343).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, archivedAt, updatedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
name String
url String
altText String @default("") @map("alt_text")
mimeType String @default("image/*") @map("mime_type")
createdBy String? @map("created_by") @db.Uuid
archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## WorkspaceBrandKit

Workspace visual defaults for email editing.

- Table: `workspace_brand_kit`; [schema source](../../packages/persistence/prisma/schema.prisma#L358).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
workspaceId String @id @map("workspace_id") @db.Uuid
logoUrl String? @map("logo_url")
primaryColor String @default("#6846ed") @map("primary_color")
secondaryColor String @default("#17131c") @map("secondary_color")
fontFamily String @default("Arial, sans-serif") @map("font_family")
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## ContentVariable

Workspace variable definitions/defaults for safe content interpolation.

- Table: `content_variable`; [schema source](../../packages/persistence/prisma/schema.prisma#L368).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, key])`; `@@index([workspaceId, archivedAt, label])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
key String
label String
defaultValue String @default("") @map("default_value")
type String @default("text")
createdBy String? @map("created_by") @db.Uuid
archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## EmailTemplateVersion

Immutable approved template snapshot and content/compiler evidence.

- Table: `email_template_version`; [schema source](../../packages/persistence/prisma/schema.prisma#L384).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `templateId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([templateId, versionNumber])`; `@@index([workspaceId, templateId, versionNumber])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
templateId String @map("template_id") @db.Uuid
versionNumber Int @map("version_number")
documentJson Json @map("document_json") @db.JsonB
subjectTemplate String @map("subject_template")
preheaderTemplate String @map("preheader_template")
plainText String @map("plain_text")
settingsJson Json? @map("settings_json") @db.JsonB
contentHash String @map("content_hash")
approvedAt DateTime @default(now()) @map("approved_at") @db.Timestamptz(6)
approvedBy String @map("approved_by") @db.Uuid
```

## TemplateUsage

Links template use to created content/version records.

- Table: `template_usage`; [schema source](../../packages/persistence/prisma/schema.prisma#L402).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `templateId`, `templateVersionId`, `referenceId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, templateId, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
templateId String @map("template_id") @db.Uuid
templateVersionId String? @map("template_version_id") @db.Uuid
usageType String @map("usage_type")
referenceId String @map("reference_id") @db.Uuid
label String
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## EmailVersion

Immutable published email document/render metadata and sender authority snapshot.

- Table: `email_version`; [schema source](../../packages/persistence/prisma/schema.prisma#L415).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `publishedAt`
- Declared Prisma relationships: `definition            EmailDefinition @relation(fields:[emailDefinitionId], references:[id], onDelete:Restrict)`
- Logical/reference-ID fields: `emailDefinitionId`, `senderIdentityId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([emailDefinitionId, versionNumber])`; `@@index([workspaceId, id])`; `@@index([workspaceId, emailDefinitionId, versionNumber])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                    String   @id @default(uuid()) @db.Uuid
workspaceId           String   @map("workspace_id") @db.Uuid
emailDefinitionId     String   @map("email_definition_id") @db.Uuid
versionNumber         Int      @map("version_number")
authoringMode         String   @default("structured") @map("authoring_mode")
authoringSchemaVersion Int     @default(1) @map("authoring_schema_version")
sourceDocumentJson    Json?    @map("source_document_json") @db.JsonB
sanitizedSource       String?  @map("sanitized_source")
subjectTemplate       String   @map("subject_template")
preheaderTemplate     String   @default("") @map("preheader_template")
compiledHtml          String   @map("compiled_html")
compiledText          String   @map("compiled_text")
senderIdentityId      String   @map("sender_identity_id") @db.Uuid
replyTo               String   @default("") @map("reply_to")
trackingEnabled       Boolean  @default(true) @map("tracking_enabled")
openTrackingEnabled   Boolean  @default(false) @map("open_tracking_enabled")
senderSnapshotJson    Json?    @map("sender_snapshot_json") @db.JsonB
contentHash           String   @map("content_hash")
compilerVersion       String   @default("phase2-structured-v1") @map("compiler_version")
sanitizerVersion      String   @default("phase2-conservative-v1") @map("sanitizer_version")
preflightJson         Json?    @map("preflight_json") @db.JsonB
publishedAt           DateTime @map("published_at") @db.Timestamptz(6)
publishedBy           String?  @map("published_by") @db.Uuid
definition            EmailDefinition @relation(fields:[emailDefinitionId], references:[id], onDelete:Restrict)
```

## EmailTestSnapshot

Immutable draft snapshot for test sends independent of published version.

- Table: `email_test_snapshot`; [schema source](../../packages/persistence/prisma/schema.prisma#L446).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `emailDefinitionId`, `senderIdentityId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, emailDefinitionId, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                 String   @id @default(uuid()) @db.Uuid
workspaceId        String   @map("workspace_id") @db.Uuid
emailDefinitionId  String   @map("email_definition_id") @db.Uuid
draftRowVersion    BigInt   @map("draft_row_version")
sourceDocumentJson Json     @map("source_document_json") @db.JsonB
subjectTemplate    String   @map("subject_template")
preheaderTemplate  String   @default("") @map("preheader_template")
compiledHtml       String   @map("compiled_html")
compiledText       String   @map("compiled_text")
senderIdentityId   String   @map("sender_identity_id") @db.Uuid
replyTo            String   @map("reply_to")
senderSnapshotJson Json     @map("sender_snapshot_json") @db.JsonB
trackingEnabled    Boolean  @default(true) @map("tracking_enabled")
contentHash        String   @map("content_hash")
compilerVersion    String   @map("compiler_version")
preflightJson      Json     @map("preflight_json") @db.JsonB
createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## FlowVersion

Immutable published automation graph used by pinned runs.

- Table: `flow_version`; [schema source](../../packages/persistence/prisma/schema.prisma#L468).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `publishedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowId, versionNumber])`; `@@index([workspaceId, flowId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String   @map("workspace_id") @db.Uuid
flowId         String   @map("flow_id") @db.Uuid
versionNumber  Int      @map("version_number")
graphJson      Json     @map("graph_json") @db.JsonB
graphSchemaVersion Int  @default(1) @map("graph_schema_version")
graphHash      String   @map("graph_hash")
publishedAt    DateTime @map("published_at") @db.Timestamptz(6)
entryPolicyJson Json? @map("entry_policy_json") @db.JsonB
exitRulesJson Json? @map("exit_rules_json") @db.JsonB
publishedBy String? @map("published_by") @db.Uuid
```

## EmailFlowDependency

Published flow-to-email-version dependency; protects immutable referenced content.

- Table: `email_flow_dependency`; [schema source](../../packages/persistence/prisma/schema.prisma#L485).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `emailDefinitionId`, `emailVersionId`, `flowId`, `flowVersionId`, `nodeId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowVersionId, nodeId])`; `@@index([workspaceId, emailDefinitionId])`; `@@index([workspaceId, emailVersionId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                String   @id @default(uuid()) @db.Uuid
workspaceId       String   @map("workspace_id") @db.Uuid
emailDefinitionId String   @map("email_definition_id") @db.Uuid
emailVersionId    String   @map("email_version_id") @db.Uuid
flowId            String   @map("flow_id") @db.Uuid
flowVersionId     String   @map("flow_version_id") @db.Uuid
nodeId            String   @map("node_id")
createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## FlowTriggerDependency

Published trigger reference index for event/list/segment/date routing.

- Table: `flow_trigger_dependency`; [schema source](../../packages/persistence/prisma/schema.prisma#L500).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowId`, `flowVersionId`, `referenceId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowVersionId, triggerType])`; `@@index([workspaceId, triggerType, referenceId])`; `@@index([workspaceId, triggerType, eventName, schemaVersion])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
workspaceId   String   @map("workspace_id") @db.Uuid
flowId        String   @map("flow_id") @db.Uuid
flowVersionId String   @map("flow_version_id") @db.Uuid
triggerType   String   @map("trigger_type")
referenceId   String?  @map("reference_id") @db.Uuid
eventName     String?  @map("event_name")
schemaVersion Int?     @map("schema_version")
dateField     String?  @map("date_field")
createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## FlowDateTriggerSchedule

Per-profile date-trigger due time and dispatch lease lifecycle.

- Table: `flow_date_trigger_schedule`; [schema source](../../packages/persistence/prisma/schema.prisma#L519).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `dueAt`, `state`, `leaseOwner`, `leaseExpiresAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowId`, `flowVersionId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowVersionId, profileId])`; `@@index([workspaceId, state, dueAt])`; `@@index([workspaceId, flowId, flowVersionId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String    @id @default(uuid()) @db.Uuid
workspaceId   String    @map("workspace_id") @db.Uuid
flowId        String    @map("flow_id") @db.Uuid
flowVersionId String    @map("flow_version_id") @db.Uuid
profileId     String    @map("profile_id") @db.Uuid
dateField     String    @map("date_field")
sourceDate    DateTime  @map("source_date") @db.Timestamptz(6)
dueAt         DateTime  @map("due_at") @db.Timestamptz(6)
state         String    @default("pending")
leaseOwner    String?   @map("lease_owner")
leaseExpiresAt DateTime? @map("lease_expires_at") @db.Timestamptz(6)
dispatchedAt  DateTime? @map("dispatched_at") @db.Timestamptz(6)
createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
```

## FlowValidationResult

Graph validation/preflight evidence associated with flow/version.

- Table: `flow_validation_result`; [schema source](../../packages/persistence/prisma/schema.prisma#L539).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `rowVersion`, `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowId, rowVersion])`; `@@index([workspaceId, flowId, checkedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
flowId      String   @map("flow_id") @db.Uuid
rowVersion  BigInt   @map("row_version")
fingerprint String
state       String
issuesJson  Json     @map("issues_json") @db.JsonB
checkedAt   DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## FlowRun

Profile's pinned automation execution, trigger/entry key, lifecycle and exit state.

- Table: `flow_run`; [schema source](../../packages/persistence/prisma/schema.prisma#L553).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `rowVersion`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowId`, `flowVersionId`, `profileId`, `triggerEventId`, `currentNodeId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, flowVersionId, deduplicationKey])`; `@@index([workspaceId, state, nextActionAt])`; `@@index([workspaceId, flowId, enteredAt])`; `@@index([workspaceId, flowId, endedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String   @map("workspace_id") @db.Uuid
flowId         String   @map("flow_id") @db.Uuid
flowVersionId  String   @map("flow_version_id") @db.Uuid
profileId      String   @map("profile_id") @db.Uuid
triggerEventId String? @map("trigger_event_id") @db.Uuid
deduplicationKey String @map("deduplication_key")
state          String
currentNodeId  String   @map("current_node_id")
enteredAt      DateTime @map("entered_at") @db.Timestamptz(6)
nextActionAt   DateTime? @map("next_action_at") @db.Timestamptz(6)
endedAt        DateTime? @map("ended_at") @db.Timestamptz(6)
exitReason     String?  @map("exit_reason")
rowVersion     BigInt   @default(1) @map("row_version")
```

## FlowNodeExecution

Per-node execution status/result/evidence and attempt history within a run.

- Table: `flow_node_execution`; [schema source](../../packages/persistence/prisma/schema.prisma#L575).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `flowRunId`, `nodeId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([flowRunId, nodeId, attemptSequence])`; `@@index([workspaceId, flowRunId])`; `@@index([workspaceId, completedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String   @map("workspace_id") @db.Uuid
flowRunId      String   @map("flow_run_id") @db.Uuid
nodeId         String   @map("node_id")
attemptSequence Int     @map("attempt_sequence")
state          String
scheduledAt    DateTime? @map("scheduled_at") @db.Timestamptz(6)
startedAt      DateTime? @map("started_at") @db.Timestamptz(6)
completedAt    DateTime? @map("completed_at") @db.Timestamptz(6)
inputSnapshot  Json?    @map("input_snapshot_json") @db.JsonB
evaluationResult Json?  @map("evaluation_result_json") @db.JsonB
errorJson      Json?    @map("error_json") @db.JsonB
```

## ScheduledAction

Durable due work, type, dedupe key, lease, retries and terminal state across workers.

- Table: `scheduled_action`; [schema source](../../packages/persistence/prisma/schema.prisma#L594).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `dueAt`, `state`, `leaseOwner`, `leaseExpiresAt`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `aggregateId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([state, dueAt])`; `@@index([workspaceId, aggregateId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String   @map("workspace_id") @db.Uuid
actionType     String   @map("action_type")
aggregateType  String   @map("aggregate_type")
aggregateId    String   @map("aggregate_id") @db.Uuid
dueAt          DateTime @map("due_at") @db.Timestamptz(6)
state          String
leaseOwner     String?  @map("lease_owner")
leaseExpiresAt DateTime? @map("lease_expires_at") @db.Timestamptz(6)
attemptCount   Int      @default(0) @map("attempt_count")
payloadVersion Int      @default(1) @map("payload_version")
payloadJson    Json     @map("payload_json") @db.JsonB
deduplicationKey String? @unique @map("deduplication_key")
createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
completedAt    DateTime? @map("completed_at") @db.Timestamptz(6)
```

## Message

Idempotent intent, source/profile/version/route references and sending lifecycle; not delivery proof.

- Table: `message`; [schema source](../../packages/persistence/prisma/schema.prisma#L615).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `sourceId`, `flowRunId`, `nodeId`, `profileId`, `emailVersionId`, `emailTestSnapshotId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, idempotencyKey])`; `@@index([workspaceId, profileId, createdAt])`; `@@index([workspaceId, sourceType, submittedAt])`; `@@index([workspaceId, sourceType, createdAt])`; `@@index([workspaceId, emailVersionId])`; `@@index([workspaceId, emailTestSnapshotId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
sourceType      String   @map("source_type")
sourceId        String   @map("source_id") @db.Uuid
flowRunId       String?  @map("flow_run_id") @db.Uuid
nodeId          String?  @map("node_id")
profileId       String   @map("profile_id") @db.Uuid
emailVersionId  String?  @map("email_version_id") @db.Uuid
emailTestSnapshotId String? @map("email_test_snapshot_id") @db.Uuid
idempotencyKey  String   @map("idempotency_key")
state           String
policyDecision  Json?    @map("policy_decision_json") @db.JsonB
renderedHash    String?  @map("rendered_hash")
scheduledFor    DateTime @map("scheduled_for") @db.Timestamptz(6)
renderedAt      DateTime? @map("rendered_at") @db.Timestamptz(6)
submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
finalAt         DateTime? @map("final_at") @db.Timestamptz(6)
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## DeliveryAttempt

Provider submission attempt, fingerprint, provider ID, unknown/failure/outcome state.

- Table: `delivery_attempt`; [schema source](../../packages/persistence/prisma/schema.prisma#L643).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `messageId`, `routeId`, `providerMessageId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([messageId, attemptNumber])`; `@@unique([provider, providerMessageId])`; `@@index([workspaceId, providerMessageId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                String   @id @default(uuid()) @db.Uuid
workspaceId       String   @map("workspace_id") @db.Uuid
messageId         String   @map("message_id") @db.Uuid
attemptNumber     Int      @map("attempt_number")
provider          String
routeId           String?  @map("route_id") @db.Uuid
requestFingerprint String  @map("request_fingerprint")
providerMessageId String?  @map("provider_message_id")
state             String
submittedAt       DateTime? @map("submitted_at") @db.Timestamptz(6)
responseAt        DateTime? @map("response_at") @db.Timestamptz(6)
errorClass        String?  @map("error_class")
errorCode         String?  @map("error_code")
```

## DeliveryEvent

Deduplicated normalized provider feedback linked to message/attempt.

- Table: `delivery_event`; [schema source](../../packages/persistence/prisma/schema.prisma#L663).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `messageId`, `providerEventId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([provider, providerEventId])`; `@@index([workspaceId, messageId, occurredAt])`; `@@index([workspaceId, eventType, occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id               String   @id @default(uuid()) @db.Uuid
workspaceId      String   @map("workspace_id") @db.Uuid
messageId        String   @map("message_id") @db.Uuid
provider         String
providerEventId  String   @map("provider_event_id")
eventType        String   @map("event_type")
occurredAt       DateTime @map("occurred_at") @db.Timestamptz(6)
receivedAt       DateTime @map("received_at") @db.Timestamptz(6)
normalizedPayload Json?   @map("normalized_payload_json") @db.JsonB
```

## OutboxEvent

Durable local consequences awaiting dispatcher publication; aggregate references.

- Table: `outbox_event`; [schema source](../../packages/persistence/prisma/schema.prisma#L679).
- Tenant scope: nullable workspaceId; receipt/global rows require correlation before tenant processing.
- Lifecycle fields: `publishedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `aggregateId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([publishedAt, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String?  @map("workspace_id") @db.Uuid
aggregateType  String   @map("aggregate_type")
aggregateId    String   @map("aggregate_id") @db.Uuid
eventType      String   @map("event_type")
eventVersion   Int      @default(1) @map("event_version")
payloadJson    Json     @map("payload_json") @db.JsonB
deduplicationKey String? @unique @map("deduplication_key")
createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
publishedAt    DateTime? @map("published_at") @db.Timestamptz(6)
attemptCount   Int      @default(0) @map("attempt_count")
lastError      String?  @map("last_error")
```

## InboxMessage

Durable external receipt, source/external-ID dedupe, correlation and processing status.

- Table: `inbox_message`; [schema source](../../packages/persistence/prisma/schema.prisma#L696).
- Tenant scope: nullable workspaceId; receipt/global rows require correlation before tenant processing.
- Lifecycle fields: `processedAt`, `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `externalId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([source, externalId])`; `@@index([workspaceId, source, status, receivedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
source        String
workspaceId   String?  @map("workspace_id") @db.Uuid
externalId    String   @map("external_id")
payloadHash   String   @map("payload_hash")
payloadJson   Json?    @map("payload_json") @db.JsonB
receivedAt    DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
processedAt   DateTime? @map("processed_at") @db.Timestamptz(6)
status        String
errorCode     String?  @map("error_code")
```

## TraceEvent

Append-only operational and engagement evidence for a referenced aggregate.

- Table: `trace_event`; [schema source](../../packages/persistence/prisma/schema.prisma#L712).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `aggregateId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, aggregateId, occurredAt])`; `@@index([workspaceId, kind, occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
workspaceId   String   @map("workspace_id") @db.Uuid
aggregateType String   @map("aggregate_type")
aggregateId   String   @map("aggregate_id") @db.Uuid
kind          String
detailJson    Json     @map("detail_json") @db.JsonB
occurredAt    DateTime @default(now()) @map("occurred_at") @db.Timestamptz(6)
```

## Phase0GateEvidence

Global named proof/real infrastructure evidence; status is not an independent live probe.

- Table: `phase0_gate_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L725).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
checkKey    String   @unique @map("check_key")
status      String
evidenceJson Json    @map("evidence_json") @db.JsonB
checkedAt   DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## UserIdentity

Global external/development identity mapped to local users and memberships.

- Table: `user_identity`; [schema source](../../packages/persistence/prisma/schema.prisma#L736).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([provider, providerSubject])`; `@@index([email])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
provider        String
providerSubject String   @map("provider_subject")
email           String
displayName     String?  @map("display_name")
status          String   @default("active")
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## LocalPasswordCredential

Development-only scrypt password credential; never return digest/salt as API data.

- Table: `local_password_credential`; [schema source](../../packages/persistence/prisma/schema.prisma#L753).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `userId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
userId            String   @id @map("user_id") @db.Uuid
passwordHash      String   @map("password_hash")
createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## LocalSession

Development session token hash, expiry and revocation state.

- Table: `local_session`; [schema source](../../packages/persistence/prisma/schema.prisma#L761).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `expiresAt`, `revokedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `userId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([userId, expiresAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id        String    @id @default(uuid()) @db.Uuid
userId    String    @map("user_id") @db.Uuid
tokenHash String    @unique @map("token_hash")
expiresAt DateTime  @map("expires_at") @db.Timestamptz(6)
revokedAt DateTime? @map("revoked_at") @db.Timestamptz(6)
createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
```

## WorkspaceMember

User-to-workspace role and membership state; primary application authorization join.

- Table: `workspace_member`; [schema source](../../packages/persistence/prisma/schema.prisma#L772).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `userId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, userId])`; `@@index([workspaceId, role, status])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
userId      String   @map("user_id") @db.Uuid
role        String
status      String
invitedBy   String?  @map("invited_by") @db.Uuid
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## WorkspaceInvitation

Workspace invitation role/email/token-hash and accepted/revoked/expiry lifecycle.

- Table: `workspace_invitation`; [schema source](../../packages/persistence/prisma/schema.prisma#L786).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `expiresAt`, `revokedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, tokenHash])`; `@@index([workspaceId, email, expiresAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
email       String
role        String
tokenHash   String   @map("token_hash")
invitedBy   String   @map("invited_by") @db.Uuid
expiresAt   DateTime @map("expires_at") @db.Timestamptz(6)
acceptedAt  DateTime? @map("accepted_at") @db.Timestamptz(6)
revokedAt   DateTime? @map("revoked_at") @db.Timestamptz(6)
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## ProfileIdentifier

Additional normalized profile identifier with workspace uniqueness.

- Table: `profile_identifier`; [schema source](../../packages/persistence/prisma/schema.prisma#L802).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, kind, normalizedValue])`; `@@index([workspaceId, profileId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
profileId       String   @map("profile_id") @db.Uuid
kind            String
normalizedValue String   @map("normalized_value")
originalValue   String   @map("original_value")
source          String
verifiedAt      DateTime? @map("verified_at") @db.Timestamptz(6)
isPrimary       Boolean  @default(false) @map("is_primary")
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## ProfilePropertyDefinition

Workspace custom field name/type/schema/archive metadata.

- Table: `profile_property_definition`; [schema source](../../packages/persistence/prisma/schema.prisma#L818).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, key])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id             String   @id @default(uuid()) @db.Uuid
workspaceId    String   @map("workspace_id") @db.Uuid
key            String
displayName    String   @map("display_name")
dataType       String   @map("data_type")
isArray        Boolean  @default(false) @map("is_array")
validationJson Json?    @map("validation_json") @db.JsonB
status         String   @default("active")
createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## ProfilePropertyValue

Typed custom property value associated with profile and field definition.

- Table: `profile_property_value`; [schema source](../../packages/persistence/prisma/schema.prisma#L832).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `rowVersion`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId`, `definitionId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, profileId, definitionId])`; `@@index([workspaceId, definitionId, profileId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
workspaceId  String   @map("workspace_id") @db.Uuid
profileId    String   @map("profile_id") @db.Uuid
definitionId String   @map("definition_id") @db.Uuid
textValue    String?  @map("text_value")
numberValue  Decimal? @map("number_value") @db.Decimal(30,10)
booleanValue Boolean? @map("boolean_value")
datetimeValue DateTime? @map("datetime_value") @db.Timestamptz(6)
jsonValue    Json?    @map("json_value") @db.JsonB
source       String
updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
rowVersion   BigInt   @default(1) @map("row_version")
```

## ProfileMerge

Evidence of source/target profile consolidation; preserve audit trail.

- Table: `profile_merge`; [schema source](../../packages/persistence/prisma/schema.prisma#L850).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `canonicalProfileId`, `sourceProfileId`, `actorId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, canonicalProfileId, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                 String   @id @default(uuid()) @db.Uuid
workspaceId        String   @map("workspace_id") @db.Uuid
canonicalProfileId String   @map("canonical_profile_id") @db.Uuid
sourceProfileId    String   @map("source_profile_id") @db.Uuid
policyJson         Json     @map("policy_json") @db.JsonB
actorId            String?  @map("actor_id") @db.Uuid
createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## AudienceList

Static workspace audience container with archive state.

- Table: `audience_list`; [schema source](../../packages/persistence/prisma/schema.prisma#L862).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`, `archivedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, status, updatedAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
name        String
description String?
status      String   @default("active")
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
archivedAt  DateTime? @map("archived_at") @db.Timestamptz(6)
```

## ListMembership

Profile-list membership and join/leave/source provenance; not consent.

- Table: `list_membership`; [schema source](../../packages/persistence/prisma/schema.prisma#L875).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `listId`, `profileId`, `sourceId`, `actorId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, listId, profileId])`; `@@index([workspaceId, profileId, state])`; `@@index([workspaceId, listId, state, joinedAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
listId      String   @map("list_id") @db.Uuid
profileId   String   @map("profile_id") @db.Uuid
state       String
joinedAt    DateTime @map("joined_at") @db.Timestamptz(6)
leftAt      DateTime? @map("left_at") @db.Timestamptz(6)
sourceType  String   @map("source_type")
sourceId    String?  @map("source_id")
actorId     String?  @map("actor_id") @db.Uuid
```

## SubscriptionState

Current projected channel/purpose consent summary; distinct from original evidence.

- Table: `subscription_state`; [schema source](../../packages/persistence/prisma/schema.prisma#L892).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `currentStatus`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId`, `sourceConsentRecordId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@id([workspaceId, profileId, channel, purpose])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
workspaceId          String   @map("workspace_id") @db.Uuid
profileId            String   @map("profile_id") @db.Uuid
channel              String
purpose              String
currentStatus        String   @map("current_status")
effectiveAt          DateTime @map("effective_at") @db.Timestamptz(6)
sourceConsentRecordId String  @map("source_consent_record_id") @db.Uuid
revision             BigInt   @default(1)
```

## ImportJob

Upload/mapping/policy/validation/commit/rollback progress and object references.

- Table: `import_job`; [schema source](../../packages/persistence/prisma/schema.prisma#L905).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, createdAt, id])`; `@@index([workspaceId, contentHash, state])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
objectKey       String   @map("object_key")
originalName    String?  @map("original_name")
checksum        String?
contentHash     String?  @map("content_hash")
state           String
mappingJson     Json?    @map("mapping_json") @db.JsonB
policyJson      Json?    @map("policy_json") @db.JsonB
totalsJson      Json?    @map("totals_json") @db.JsonB
errorObjectKey  String?  @map("error_object_key")
createdBy       String?  @map("created_by") @db.Uuid
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
completedAt     DateTime? @map("completed_at") @db.Timestamptz(6)
```

## ImportChunk

Import processing partition state/lease/counters.

- Table: `import_chunk`; [schema source](../../packages/persistence/prisma/schema.prisma#L925).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `importJobId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([importJobId, chunkIndex])`; `@@index([workspaceId, importJobId, state])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
importJobId String   @map("import_job_id") @db.Uuid
chunkIndex  Int      @map("chunk_index")
state       String
rowStart    Int      @map("row_start")
rowEnd      Int      @map("row_end")
attemptCount Int     @default(0) @map("attempt_count")
completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
```

## ImportRowResult

Per-row validation/commit outcome and diagnostic evidence.

- Table: `import_row_result`; [schema source](../../packages/persistence/prisma/schema.prisma#L940).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `importJobId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([importJobId, rowNumber])`; `@@index([workspaceId, importJobId, state])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
importJobId String   @map("import_job_id") @db.Uuid
rowNumber   Int      @map("row_number")
state       String
profileId   String?  @map("profile_id") @db.Uuid
errorsJson  Json?    @map("errors_json") @db.JsonB
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## ImportChange

Applied before/after changes used for import rollback/audit.

- Table: `import_change`; [schema source](../../packages/persistence/prisma/schema.prisma#L954).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `importJobId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, importJobId, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
importJobId String   @map("import_job_id") @db.Uuid
profileId   String?  @map("profile_id") @db.Uuid
changeType  String   @map("change_type")
fieldKey    String?  @map("field_key")
beforeJson  Json?    @map("before_json") @db.JsonB
afterJson   Json?    @map("after_json") @db.JsonB
revision    BigInt?
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## ExportJob

Scoped export request, object reference, completion and token-hash/expiry metadata.

- Table: `export_job`; [schema source](../../packages/persistence/prisma/schema.prisma#L969).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `expiresAt`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, createdAt, id])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
state       String
scopeJson   Json     @map("scope_json") @db.JsonB
fieldsJson  Json     @map("fields_json") @db.JsonB
purpose     String?
objectKey   String?  @map("object_key")
tokenHash   String?  @map("token_hash")
recordCount Int?     @map("record_count")
createdBy   String   @map("created_by") @db.Uuid
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
expiresAt   DateTime? @map("expires_at") @db.Timestamptz(6)
completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
```

## AuditEvent

Append-only actor/action/resource audit record.

- Table: `audit_event`; [schema source](../../packages/persistence/prisma/schema.prisma#L987).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `actorId`, `objectId`, `requestId`, `correlationId`, `supportAccessGrantId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, occurredAt, id])`; `@@index([workspaceId, action, occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                   String   @id @default(uuid()) @db.Uuid
workspaceId          String   @map("workspace_id") @db.Uuid
actorType            String   @map("actor_type")
actorId              String?  @map("actor_id") @db.Uuid
action               String
objectType           String   @map("object_type")
objectId             String?  @map("object_id")
riskLevel            String   @map("risk_level")
beforeJson           Json?    @map("before_json") @db.JsonB
afterJson            Json?    @map("after_json") @db.JsonB
requestId            String?  @map("request_id")
correlationId        String?  @map("correlation_id")
occurredAt           DateTime @default(now()) @map("occurred_at") @db.Timestamptz(6)
supportAccessGrantId String?  @map("support_access_grant_id") @db.Uuid
```

## WorkspaceReadinessCheck

Stored per-workspace readiness check outcome.

- Table: `workspace_readiness_check`; [schema source](../../packages/persistence/prisma/schema.prisma#L1008).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, checkKey])`; `@@index([workspaceId, status])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
checkKey    String   @map("check_key")
status      String
evidenceJson Json?   @map("evidence_json") @db.JsonB
checkedAt   DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## Phase1GateEvidence

Global Phase1 evidence/check records.

- Table: `phase1_gate_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1020).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
checkKey     String   @unique @map("check_key")
status       String
evidenceJson Json     @map("evidence_json") @db.JsonB
checkedAt    DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## SendPolicy

Workspace marketing eligibility, frequency, quiet-hours/warming policy configuration.

- Table: `send_policy`; [schema source](../../packages/persistence/prisma/schema.prisma#L1031).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: `workspace             Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)`
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, policyVersion])`; `@@index([workspaceId, active, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                    String   @id @default(uuid()) @db.Uuid
workspaceId           String   @map("workspace_id") @db.Uuid
policyVersion         Int      @map("policy_version")
frequencyWindowSeconds Int     @default(86400) @map("frequency_window_seconds")
frequencyMax          Int      @default(3) @map("frequency_max")
quietHoursJson        Json?    @map("quiet_hours_json") @db.JsonB
timezoneFallback      String   @default("workspace") @map("timezone_fallback")
warmingJson           Json?    @map("warming_json") @db.JsonB
createdBy             String?  @map("created_by") @db.Uuid
createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
active                Boolean  @default(true)
workspace             Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)
```

## OperationalHold

Active/released workspace/domain/route sending stop with reason and scope.

- Table: `operational_hold`; [schema source](../../packages/persistence/prisma/schema.prisma#L1049).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: `workspace    Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)`
- Logical/reference-ID fields: `scopeId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, state, scopeType, createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
workspaceId  String   @map("workspace_id") @db.Uuid
scopeType    String   @map("scope_type")
scopeId      String?  @map("scope_id")
reason       String
state        String
createdBy    String?  @map("created_by") @db.Uuid
createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
releasedAt   DateTime? @map("released_at") @db.Timestamptz(6)
releaseReason String? @map("release_reason")
workspace    Workspace @relation(fields:[workspaceId], references:[id], onDelete:Restrict)
```

## FrequencyReservation

Profile/policy send reservation used in frequency enforcement.

- Table: `frequency_reservation`; [schema source](../../packages/persistence/prisma/schema.prisma#L1065).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `expiresAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId`, `messageId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, messageId])`; `@@index([workspaceId, profileId, purpose, reservedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String   @map("workspace_id") @db.Uuid
profileId   String   @map("profile_id") @db.Uuid
messageId   String   @map("message_id") @db.Uuid
purpose     String   @default("marketing")
reservedAt  DateTime @default(now()) @map("reserved_at") @db.Timestamptz(6)
expiresAt   DateTime @map("expires_at") @db.Timestamptz(6)
consumedAt  DateTime? @map("consumed_at") @db.Timestamptz(6)
releasedAt  DateTime? @map("released_at") @db.Timestamptz(6)
```

## RenderedMessageArtifact

Immutable MIME/HTML/text object and content hash metadata for a Message.

- Table: `rendered_message_artifact`; [schema source](../../packages/persistence/prisma/schema.prisma#L1080).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `messageId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId, messageId])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id              String   @id @default(uuid()) @db.Uuid
workspaceId     String   @map("workspace_id") @db.Uuid
messageId       String   @map("message_id") @db.Uuid
objectKey       String   @map("object_key")
contentHash     String   @map("content_hash")
mimeHash        String   @map("mime_hash")
byteSize        Int      @map("byte_size")
compilerVersion String   @map("compiler_version")
sanitizerVersion String  @map("sanitizer_version")
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## TrackingLink

Stored click destination and message association used by signed redirects.

- Table: `tracking_link`; [schema source](../../packages/persistence/prisma/schema.prisma#L1095).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `messageId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, messageId])`; `@@unique([workspaceId, messageId, destinationHash])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
workspaceId   String   @map("workspace_id") @db.Uuid
messageId     String   @map("message_id") @db.Uuid
destination   String
destinationHash String @map("destination_hash")
tokenVersion  Int      @default(1) @map("token_version")
createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## Phase2GateEvidence

Global delivery-phase proof/external evidence checks.

- Table: `phase2_gate_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1108).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
checkKey     String   @unique @map("check_key")
status       String
evidenceJson Json     @map("evidence_json") @db.JsonB
checkedAt    DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## Segment

Editable audience rule container with published version and archive state.

- Table: `segment`; [schema source](../../packages/persistence/prisma/schema.prisma#L1117).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`, `rowVersion`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,status,updatedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
name String
description String @default("")
status String @default("draft")
draftRuleJson Json @map("draft_rule_json") @db.JsonB
rowVersion BigInt @default(1) @map("row_version")
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## SegmentVersion

Immutable segment rule version.

- Table: `segment_version`; [schema source](../../packages/persistence/prisma/schema.prisma#L1130).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `publishedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `segmentId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([segmentId,versionNumber])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
segmentId String @map("segment_id") @db.Uuid
versionNumber Int @map("version_number")
ruleAstJson Json @map("rule_ast_json") @db.JsonB
ruleSchemaVersion Int @default(1) @map("rule_schema_version")
publishedAt DateTime @default(now()) @map("published_at") @db.Timestamptz(6)
publishedBy String? @map("published_by") @db.Uuid
```

## SegmentMembershipProjection

Computed profile membership against a version with freshness evidence.

- Table: `segment_membership_projection`; [schema source](../../packages/persistence/prisma/schema.prisma#L1142).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `segmentId`, `segmentVersionId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@id([segmentVersionId,profileId])`; `@@index([workspaceId,segmentId,isMember,evaluatedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
workspaceId String @map("workspace_id") @db.Uuid
segmentId String @map("segment_id") @db.Uuid
segmentVersionId String @map("segment_version_id") @db.Uuid
profileId String @map("profile_id") @db.Uuid
isMember Boolean @map("is_member")
evaluatedAt DateTime @map("evaluated_at") @db.Timestamptz(6)
evaluationRevision BigInt @default(1) @map("evaluation_revision")
```

## EventSchema

Versioned workspace generic-event schema/validation contract.

- Table: `event_schema`; [schema source](../../packages/persistence/prisma/schema.prisma#L1154).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId,eventName,schemaVersion])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
eventName String @map("event_name")
schemaVersion Int @map("schema_version")
propertySchemaJson Json @map("property_schema_json") @db.JsonB
status String @default("active")
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
```

## Event

Profile-associated customer event with source/schema version/idempotency and occurrence time.

- Table: `event`; [schema source](../../packages/persistence/prisma/schema.prisma#L1165).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `processingStatus`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `externalEventId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@unique([workspaceId,source,idempotencyKey])`; `@@index([workspaceId,eventName,occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
eventName String @map("event_name")
externalEventId String @map("external_event_id")
profileId String? @map("profile_id") @db.Uuid
source String
sourceVersion String? @map("source_version")
occurredAt DateTime @map("occurred_at") @db.Timestamptz(6)
receivedAt DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
propertiesJson Json @map("properties_json") @db.JsonB
schemaVersion Int @map("schema_version")
idempotencyKey String @map("idempotency_key")
processingStatus String @default("accepted") @map("processing_status")
```

## ApiCredential

Scoped API key metadata and digest/pepper-based verification; raw secret returned only at creation.

- Table: `api_credential`; [schema source](../../packages/persistence/prisma/schema.prisma#L1183).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `expiresAt`, `revokedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,revokedAt,expiresAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
name String
prefix String
secretHash String @map("secret_hash")
scopesJson Json @map("scopes_json") @db.JsonB
createdBy String? @map("created_by") @db.Uuid
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
expiresAt DateTime? @map("expires_at") @db.Timestamptz(6)
revokedAt DateTime? @map("revoked_at") @db.Timestamptz(6)
```

## Flow

Editable flow metadata/graph and active immutable version pointer.

- Table: `flow`; [schema source](../../packages/persistence/prisma/schema.prisma#L1198).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `status`, `activeVersionId`, `rowVersion`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `activeVersionId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,status,updatedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
name String
status String @default("draft")
draftGraphJson Json @map("draft_graph_json") @db.JsonB
activeVersionId String? @map("active_version_id") @db.Uuid
activeVersionActivatedAt DateTime? @map("active_version_activated_at") @db.Timestamptz(6)
entryState String @default("open") @map("entry_state")
executionState String @default("running") @map("execution_state")
pausedAt DateTime? @map("paused_at") @db.Timestamptz(6)
rowVersion BigInt @default(1) @map("row_version")
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## Phase3GateEvidence

Global automation-phase evidence checks.

- Table: `phase3_gate_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1215).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
checkKey String @unique @map("check_key")
status String
evidenceJson Json @map("evidence_json") @db.JsonB
checkedAt DateTime @default(now()) @map("checked_at") @db.Timestamptz(6)
```

## SegmentMembershipTransition

Persisted entered/exited transition produced by segment evaluation.

- Table: `segment_membership_transition`; [schema source](../../packages/persistence/prisma/schema.prisma#L1224).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `segmentId`, `segmentVersionId`, `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,segmentId,occurredAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
segmentId String @map("segment_id") @db.Uuid
segmentVersionId String @map("segment_version_id") @db.Uuid
profileId String @map("profile_id") @db.Uuid
transition String
transitionKey String @unique @map("transition_key")
occurredAt DateTime @default(now()) @map("occurred_at") @db.Timestamptz(6)
```

## SegmentEvaluationRun

Projection run counters, state, timestamps and freshness evidence.

- Table: `segment_evaluation_run`; [schema source](../../packages/persistence/prisma/schema.prisma#L1240).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `segmentId`, `segmentVersionId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId, segmentId, segmentVersionId, startedAt])`; `@@index([workspaceId, segmentId, state, completedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id               String    @id @default(uuid()) @db.Uuid
workspaceId      String    @map("workspace_id") @db.Uuid
segmentId        String    @map("segment_id") @db.Uuid
segmentVersionId String    @map("segment_version_id") @db.Uuid
state            String
trigger          String
startedAt        DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
completedAt      DateTime? @map("completed_at") @db.Timestamptz(6)
evaluatedAt      DateTime? @map("evaluated_at") @db.Timestamptz(6)
memberCount      Int?      @map("member_count")
errorCode        String?   @map("error_code")
```

## DeadLetterItem

Failed event/action metadata and explicit replay lifecycle.

- Table: `dead_letter_item`; [schema source](../../packages/persistence/prisma/schema.prisma#L1257).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `resourceId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,state,createdAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id String @id @default(uuid()) @db.Uuid
workspaceId String @map("workspace_id") @db.Uuid
resourceType String @map("resource_type")
resourceId String @map("resource_id") @db.Uuid
jobType String @map("job_type")
businessKey String @map("business_key")
errorJson Json @map("error_json") @db.JsonB
state String @default("open")
createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
replayedAt DateTime? @map("replayed_at") @db.Timestamptz(6)
```

## Phase4SecurityFinding

Severity/owner/review/remediation record; may optionally refer to workspace.

- Table: `phase4_security_finding`; [schema source](../../packages/persistence/prisma/schema.prisma#L1273).
- Tenant scope: nullable workspaceId; receipt/global rows require correlation before tenant processing.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([status,severity,createdAt])`; `@@index([workspaceId,status])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
workspaceId String?  @map("workspace_id") @db.Uuid
title       String
severity    String
status      String   @default("open")
owner       String?
reviewAt    DateTime? @map("review_at") @db.Timestamptz(6)
createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
closedAt    DateTime? @map("closed_at") @db.Timestamptz(6)
```

## Phase4LaunchEvidence

Global release prerequisite evidence.

- Table: `phase4_launch_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1288).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([area,status,recordedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
area        String
status      String
summary     String
approver    String?
recordedAt  DateTime @default(now()) @map("recorded_at") @db.Timestamptz(6)
```

## Phase4PilotStopSignal

Active/cleared operational stop condition for pilot/release.

- Table: `phase4_pilot_stop_signal`; [schema source](../../packages/persistence/prisma/schema.prisma#L1299).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([active,observedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
code        String
detail      String
active      Boolean  @default(true)
observedAt  DateTime @default(now()) @map("observed_at") @db.Timestamptz(6)
clearedAt   DateTime? @map("cleared_at") @db.Timestamptz(6)
```

## Phase4PilotState

Global pilot stage/state and approvals.

- Table: `phase4_pilot_state`; [schema source](../../packages/persistence/prisma/schema.prisma#L1310).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `state`, `completedAt`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id
stage       Int      @default(0)
state       String   @default("locked")
startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
holdReason  String?  @map("hold_reason")
updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## Phase4CapacityEvidence

Measured capacity/rehearsal evidence, not live provider quota.

- Table: `phase4_capacity_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1321).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([scenario,finishedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
scenario    String
startedAt   DateTime @map("started_at") @db.Timestamptz(6)
finishedAt  DateTime @map("finished_at") @db.Timestamptz(6)
target      Float
achieved    Float
errorRate   Float    @map("error_rate")
safeCeiling Float    @map("safe_ceiling")
passed      Boolean
notes       String?
```

## Phase4RecoveryExercise

Recorded recovery/restore exercise evidence.

- Table: `phase4_recovery_exercise`; [schema source](../../packages/persistence/prisma/schema.prisma#L1336).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([scenario,status,finishedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id          String   @id @default(uuid()) @db.Uuid
scenario    String
status      String
startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
finishedAt  DateTime? @map("finished_at") @db.Timestamptz(6)
rpoMinutes  Int?     @map("rpo_minutes")
rtoMinutes  Int?     @map("rto_minutes")
evidenceJson Json    @map("evidence_json") @db.JsonB
```

## Phase4PrivacyDeletionJob

Staged profile privacy-deletion workflow/evidence; needs retention and actual-erasure validation.

- Table: `phase4_privacy_deletion_job`; [schema source](../../packages/persistence/prisma/schema.prisma#L1349).
- Tenant scope: workspaceId column; repository queries and mutation authorization must enforce it.
- Lifecycle fields: `state`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: `profileId` These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([workspaceId,profileId,state])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id            String   @id @default(uuid()) @db.Uuid
workspaceId   String   @map("workspace_id") @db.Uuid
profileId     String   @map("profile_id") @db.Uuid
state         String
requestedAt   DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
tombstoneHash String?  @map("tombstone_hash")
error         String?
```

## Phase4HardeningEvidence

Recorded hardening prerequisite evidence and review metadata.

- Table: `phase4_hardening_evidence`; [schema source](../../packages/persistence/prisma/schema.prisma#L1362).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([status,recordedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
checkKey     String   @unique @map("check_key")
status       String
summary      String
owner        String?
evidenceJson Json     @map("evidence_json") @db.JsonB
recordedAt   DateTime @default(now()) @map("recorded_at") @db.Timestamptz(6)
reviewAt     DateTime? @map("review_at") @db.Timestamptz(6)
```

## Phase4PilotObservation

Pilot-stage metric/observation evidence.

- Table: `phase4_pilot_observation`; [schema source](../../packages/persistence/prisma/schema.prisma#L1375).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([healthPassed,recordedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                     String   @id @default(uuid()) @db.Uuid
stage                  Int      @unique
audience               String
startedAt              DateTime @map("started_at") @db.Timestamptz(6)
finishedAt             DateTime @map("finished_at") @db.Timestamptz(6)
healthPassed           Boolean  @map("health_passed")
unresolvedAlerts       Int      @map("unresolved_alerts")
expectedEventsReceived Boolean? @map("expected_events_received")
enoughFeedback         Boolean? @map("enough_feedback")
withinWarmingCeiling   Boolean? @map("within_warming_ceiling")
completeFlowCycle      Boolean? @map("complete_flow_cycle")
approvedBy             String   @map("approved_by")
evidenceJson           Json     @map("evidence_json") @db.JsonB
recordedAt             DateTime @default(now()) @map("recorded_at") @db.Timestamptz(6)
```

## Phase4ReleaseState

Global release locked/approved state.

- Table: `phase4_release_state`; [schema source](../../packages/persistence/prisma/schema.prisma#L1394).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: `status`
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: primary/unique field annotations below only.

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id         String   @id
status     String   @default("locked")
approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
approvedBy String?  @map("approved_by")
notes      String?
updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
```

## Phase4SloObservation

Observed SLO window/objective and evidence.

- Table: `phase4_slo_observation`; [schema source](../../packages/persistence/prisma/schema.prisma#L1404).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([indicator,recordedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id           String   @id @default(uuid()) @db.Uuid
indicator    String
windowStart  DateTime @map("window_start") @db.Timestamptz(6)
windowEnd    DateTime @map("window_end") @db.Timestamptz(6)
observedJson Json     @map("observed_json") @db.JsonB
objective    String
passed       Boolean
evidenceJson Json     @map("evidence_json") @db.JsonB
recordedAt   DateTime @default(now()) @map("recorded_at") @db.Timestamptz(6)
```

## Phase4MigrationRehearsal

Import/migration reconciliation counts and source-of-truth rehearsal plan.

- Table: `phase4_migration_rehearsal`; [schema source](../../packages/persistence/prisma/schema.prisma#L1418).
- Tenant scope: no direct workspaceId column; scope is global or inherited through the referenced parent. Never assume tenant isolation from the model name.
- Lifecycle fields: no dedicated state/soft-delete field; creation/history semantics come from the owning service.
- Declared Prisma relationships: none. Logical scalar references and migration SQL may still enforce relationships.
- Logical/reference-ID fields: none beyond tenant/key fields. These names are a navigation aid, not a claim that every scalar is a foreign key.
- Constraints/indexes: `@@index([reconciled,finishedAt])`

Exact field contract (names, mapped columns, nullability, defaults and field-level uniqueness):

```prisma
id                String   @id @default(uuid()) @db.Uuid
sourceLabel       String   @map("source_label")
sourceRows        Int      @map("source_rows")
acceptedRows      Int      @map("accepted_rows")
rejectedRows      Int      @map("rejected_rows")
duplicateRows     Int      @map("duplicate_rows")
invalidRows       Int      @map("invalid_rows")
missingConsentRows Int     @map("missing_consent_rows")
suppressedRows    Int      @map("suppressed_rows")
acceptedProfiles  Int      @map("accepted_profiles")
listMemberships   Int      @map("list_memberships")
consentGranted    Int      @map("consent_granted")
exclusions        Int
reconciled        Boolean
sourceOfTruthPlan String   @map("source_of_truth_plan")
evidenceJson      Json     @map("evidence_json") @db.JsonB
startedAt         DateTime @map("started_at") @db.Timestamptz(6)
finishedAt        DateTime @map("finished_at") @db.Timestamptz(6)
owner             String
```


