# Email Templates rebuild — Checkpoint 1

This checkpoint establishes the data boundary for a replacement Content → Email Templates module. It does not switch the current editor or renderer to the new format.

## Repository audit

| Area | Current implementation | Decision |
| --- | --- | --- |
| Web | Next.js 16, React 19, App Router under `/w/[workspaceId]/content`; CSS based Velivoo controls; React local state in the template editor | Reuse routes, navigation, session API client, and visual tokens. Replace the template library/editor surfaces in later checkpoints. |
| Editing | Flat `StructuredEmailDocument` v1 (`blocks[]`), `DocumentBuilder`, imported HTML iframe, local undo stack and debounced saves | Keep the v1 path working during transition. A v2 section/column schema will become authoritative only when its renderer and autosave API are verified. |
| Dependencies | No installed drag/drop or rich text editor library | Select libraries only when their checkpoint is implemented; do not introduce a second state or design system. |
| API and authorization | `delivery-api.ts` authenticates; `Phase2Service.role()` checks workspace membership and `content.read`, `content.write`, or `content.publish`; repository template queries filter `workspaceId` | Reuse this boundary and add cross-workspace tests for each new endpoint. |
| Persistence | Prisma/PostgreSQL with `EmailTemplate`, `EmailTemplateVersion`, `TemplateImportAudit`, `UniversalBlock`, `MediaAsset`, `WorkspaceBrandKit`, `ContentVariable`, and `TemplateUsage` | Extend these models. No replacement table or destructive migration. |
| Starter content | Five code owned native starter definitions with a clone-into-workspace operation | Keep the registry and expand its metadata/preview behavior in Checkpoint 3. |
| Rendering and sending | `compileStructuredDraft` resolves variables and compliance for `EmailDefinition`; `EmailVersion` is the send snapshot; real test sends exist for email definitions | Build one template renderer that later feeds preview, test send, approved snapshots, campaigns, and flows. Keep send infrastructure unchanged. |
| Media | Workspace scoped `MediaAsset` and local object store exist; current template media creation is URL based | Extend the existing asset model and object store for real uploads in the media checkpoint. |

Reference behavior was checked against [Brevo's editor](https://help.brevo.com/hc/en-us/articles/360016831820-Overview-of-the-Drag-Drop-email-editor), [Mailchimp's new builder](https://mailchimp.com/help/design-an-email-new-builder/), and [Klaviyo's template editor](https://help.klaviyo.com/hc/en-us/articles/4407911841435). Their common pattern is a template gallery, content and layout controls, a live canvas, contextual styles, reusable content, device preview, and test/preview actions. Velivoo will implement those patterns with its own brand and content.

## Local data inventory (2026-09-21)

- 26 workspace templates: 14 native, 8 imported HTML, 4 previously converted imports.
- 17 approved template versions, all carrying v1 flat documents.
- 12 import audits, 22 template usage records, 1 media asset, and 0 reusable blocks.
- No orphan template versions, usage records, or referenced usage versions were found.
- The four converted imports comprise two `partial` and two `converted` records. Both retain original HTML and need human visual review before selecting their new editor mode.

## Data architecture

The additive migration `20260921000100_email_template_builder_foundation` adds nullable editor/source metadata and a nullable v2 design document to `email_template`. Null explicitly means the legacy row has not been promoted. The original `document_json`, imported HTML, settings, and metadata remain in place. `draft_revision` is nullable until the new autosave API owns its concurrency checks.

`email_template_version` gains nullable editor type, design schema/version, source HTML, and rendered HTML snapshot fields. Existing approved versions remain unchanged and the database's immutable-version trigger stays active. The new publisher will fill these fields only after the canonical renderer is implemented.

The v2 native document is `{ schemaVersion: 2, type: "email_template", settings, sections, compliance }`. A section owns one to four columns; columns own typed blocks. A platform compliance footer is represented once, outside editable content. Responsive and visibility fields live on sections and blocks. HTML templates keep their source HTML as their editable document; arbitrary HTML is never inferred into visual blocks.

## Safe migration path

1. Run `npm run audit:email-template-migration` against a database. It reads templates and prints only aggregate dispositions and reasons; it writes nothing.
2. Native v1 blocks can be wrapped in ordered v2 sections. Existing IDs and block payloads are preserved; equal-width legacy columns retain their content. The original v1 document remains stored until v2 output is visually and semantically compared.
3. Imported HTML stays in HTML mode with original source preserved. Previously converted imports remain in legacy review mode, because promoting them automatically could discard either source edits or converted block edits.
4. During later checkpoints, migrate one workspace draft at a time in a transaction, with a revision check and render comparison. Do not modify approved versions or historical campaign/flow snapshots. Switch reads only after the new renderer, preview, and test-send paths agree.
5. A rollback of application behavior reads the retained v1 columns. The additive columns can remain unused without affecting existing sends.

The local database migration was applied successfully. Source content across all 26 templates and 17 versions had the same SHA-256 fingerprint before and after migration: `10c66ec85734ae7598ee4f786e716334f03014c3d547fa23c376c6ed242d26ca`.

## Verification

- Root TypeScript typecheck: passed.
- Web TypeScript typecheck: passed.
- Next.js production build: passed.
- Content, template import, advanced content, and migration tests: 27 passed, 0 failed.
- Migration audit: 14 visual candidates, 8 HTML-mode candidates, and 4 converted imports held for review.
- Prisma migration status: all 30 migrations applied.
- Local web, API, delivery API, and worker health endpoints: HTTP 200.

The complete repository test command currently reports 230 passed and 5 failed. The failures reproduce in isolation in pre-existing Phase 3 automation and sender-domain provisioning tests; none are in Content, template migration, importing, rendering, tenant scoping, or immutable version coverage. They are intentionally not altered by this checkpoint.

## Checkpoint sequence

1. **Foundation (this checkpoint):** audit, schema boundary, read-only conversion plan, preservation checks.
2. Library/API, then creation workflow and starter templates.
3. Native builder core, then rich text/responsive styling, then remaining blocks and reusable content.
4. HTML editor/import, ZIP and URL security, canonical rendering, personalization, and compliance.
5. Preview/test, autosave/versioning, preflight/campaign/flow integration, and final migration/regression QA.

Each later checkpoint requires its own tests, UI/backend review, and human validation before the next one starts.
