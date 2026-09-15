# Audience

## Profiles and consent

`apps/web/src/components/profile-manager.tsx` implements the Profiles page: search, list/segment/source/eligibility filters, pagination, selectable rows, configurable columns, create-profile drawer and import entry. Detail is profile-detail-panel.tsx. The Audiences menu's Contacts entry routes to /profiles; it is not a second CRM database.

`packages/application/src/phase1/phase1-service.ts` and `packages/persistence/src/prisma/phase1-repository.ts` handle profile CRUD, identifiers, properties, merge, consent, lists and import/export workflows. Normalization validates email and lowercases the domain while preserving local-part case. ProfilePropertyDefinition/Value supply typed workspace fields. A profile's locale/timezone/country/region/city are data fields; a list is separate membership.

ConsentRecord is append-only evidence. SubscriptionState is the derived channel/purpose summary. Suppression is a separate blocking fact, including protected provider/unsubscribe outcomes. List membership and a CSV upload never themselves establish marketing permission. A granted import policy requires source and evidence note. Merge must preserve identities, evidence, history and correct tenant boundaries, not just delete a duplicate row.

## Lists

AudienceList and ListMembership persist membership state, source and join/leave provenance. Lists support create/edit/archive and membership add/remove plus reachable counts; “reachable” is eligibility, not merely row count. The archive dependency check inspects flow usage; immutable active dependencies need careful review rather than trusting only editable graphs.

UI: list-manager.tsx, list-detail-panel.tsx, audience-overview.tsx. APIs live in platform-api.ts under /lists and /profiles. Detail panes requesting profile messages/flow-runs have gateway routing defects documented in chapter 16.

## CSV import and export

ImportJob → ImportChunk / ImportRowResult → ImportChange provides upload, preview, mapping, validation, commit progress and rollback evidence. LocalObjectStore holds uploaded/exported data. The optional Phase1JobQueue and real-phase1 worker process background operations; without an enabled queue the API runs selected work inline.

Exact ImportMapping fields are email, firstName, lastName, locale, timezone, countryCode, region, city, and properties mapping CSV headers to already-defined workspace property keys. ImportPolicy controls source, upsert, blankPolicy ignore/clear, destinationListId and optional consent status/source/evidenceNote.

Phone, tags, segment, created_at and per-row consent are not native mapping fields. Do not advertise historical sample-column names as supported. Custom data may be mapped only through defined supported properties.

`packages/domain/src/phase1/csv.ts` handles quoted commas/escaped quotes per line, BOM, duplicate headers, email selection, duplicate-in-file and oversized fields. It splits physical lines, so multiline quoted CSV values are unsupported. The upload preview also includes a simpler split-based path. Real imports read complete files, despite a streaming CSV utility in packages/testkit. Large request/file allowances create memory/backpressure risk.

Rollback uses recorded changes; it is not a general database rewind. Exports are workspace/permission-scoped, written to object storage and downloaded via an expiring token hash. Treat tokens as credentials, prevent spreadsheet formula injection, and test tenant access. The direct GET export-status route is currently missing an explicit membership guard.

## Segments and events

Phase3Service, SegmentProjectionService3 and PrismaPhase3Repository manage rule drafts, validation, publish, estimate, preview, per-profile explanation, refresh, projection freshness and membership transitions. Segment rules compile a typed AST to parameterized SQL. SegmentVersion pins published rules; SegmentEvaluationRun records freshness/state; SegmentMembershipProjection/Transition power current membership and entered triggers.

EventSchema versions validate generic event payloads. Event rows have idempotency and profile association; scoped ApiCredential keys authorize public ingestion. The /segments/rule-registry route is shadowed by generic segment detail, and audience-transition BullMQ IDs are invalid in the installed dependency. UI presence does not prove scheduled refresh/flow entry executes.

Sources: `packages/domain/src/phase3/segment-rules.ts`, `packages/domain/src/phase3/generic-events.ts`, `apps/api/src/automation-api.ts`, `apps/worker/src/real-phase3-main.ts`. See chapter 17 before running projections or event-driven flows.

