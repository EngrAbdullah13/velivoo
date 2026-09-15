# Content, templates and email editor

## Existing data and lifecycle

Content is served primarily by delivery-api.ts through ContentService and Phase2Service. The frontend template-library.tsx, template-editor.tsx, email-editor.tsx and document-builder.tsx are real client editors, not screenshot-only placeholders.

EmailTemplate stores mutable library metadata/content; approval creates EmailTemplateVersion immutable snapshots; TemplateUsage records use. Library operations include create, duplicate, favorite, archive, preflight, approve, usage/version history, system-template use, and creating an email from an approved template. UniversalBlock, MediaAsset, WorkspaceBrandKit and ContentVariable support reuse. Media is a stored URL/reference workflow, not a completed managed asset-upload/CDN product.

**create-campaign creates EmailDefinition**, not a Campaign record or recipient-snapshot/broadcast schedule. The schema has no dedicated Campaign model. Preserve this useful content action but document its narrower meaning.

EmailDefinition is the mutable sending draft. Saving has rowVersion concurrency checks. Preflight validates its fingerprint and readiness/content requirements. Publishing writes an immutable EmailVersion; restore/duplicate create editable work without modifying the original version. Test sends use EmailTestSnapshot. Flow dependencies pin published versions, so editing a template or email must not mutate an active flow's historic messages.

## Builder and renderer

The supported document primitives in `packages/domain/src/phase2/content.ts` include heading, text, header, footer, image, button, divider, spacer, social, columns and locked compliance_footer. `packages/email-renderer/src/phase2-structured.ts` compiles sanitized HTML/plain text. MIME is built by mime-builder.ts with header safety and unsubscribe headers. Variable definitions/defaults are validated by phase2/variables.ts.

Some palette choices such as product-like cards, countdown or video are compositions of static image/text/link blocks. They do not imply a commerce catalog, running email timer, embedded playback integration or revenue tracking.

Structured document content is the supported publishable route. HTML-source editing is restricted by preflight; do not bypass that restriction to make arbitrary pasted HTML look supported. URLs and headers must preserve compiler/sanitizer policy. Locked compliance content must not be removed in the editor or silently omitted by the renderer.

## UI / API correspondence

| UI area | Backend suffix under workspace | Persistence |
|---|---|---|
| Template library/editor | /content/templates, /:id/content, /approve, /versions, /usage | EmailTemplate, EmailTemplateVersion, TemplateUsage |
| System starters | /content/system-templates/:id/use | New workspace template, not edit of global starter |
| Reusable assets | /content/universal-blocks, /media, /brand-kit, /variables | UniversalBlock, MediaAsset, WorkspaceBrandKit, ContentVariable |
| Email library/editor | /emails, /:id, /preflight, /preview, /publish, /restore | EmailDefinition, EmailVersion |
| Test send/trace | /emails/:id/test-sends, /messages/:id/trace | EmailTestSnapshot, Message, attempt/artifact/trace |
| Dependency/history tools | /emails/:id/versions, /versions/compare, /flow-dependencies | Immutable versions and flow dependency rows |

## Status and extension guidance

The structured editor/compiler and immutable content pipeline have substantial unit/workflow coverage, including advanced-content.test.ts and content.test.ts. Browser drag/drop, focus, responsive layout, and end-to-end send-from-editor tests are missing. Template media management and campaign orchestration remain partial.

Extend the existing document schema/compiler together; adding a palette item without renderer/preflight support is not a feature. Preserve version pinning, tenant scope, sanitization, variable defaults and sender snapshots. Connect a future campaign scheduler to canonical Message creation instead of direct SES calls.

