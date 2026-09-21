# Email Template Rebuild — Checkpoint 2

## Scope

Checkpoint 2 delivers the new tenant-scoped Email Template Library UI and its API-facing metadata. It intentionally does not replace the template editor; creation workflow and editor reconstruction continue in later checkpoints.

## Delivered

- Rebuilt `/w/:workspaceId/content/templates` as the Email Templates home.
- Added persisted starter and workspace templates to one searchable gallery.
- Added All, Starter templates, My templates, Recently used, Imported, and Archived collections.
- Added filters for category, industry, editor type, template type, status, creator, and last-modified range.
- Added sorting by recently updated, newest, oldest, name, and usage.
- Added deterministic rendered previews from native builder JSON and sandboxed previews for HTML templates.
- Added real create, import, preview, edit/use, favorite, rename, duplicate, archive, and restore flows.
- Added loading skeletons, request failure/retry, empty collection, and no-filter-results states.
- Protected system starters from direct editing; **Use template** clones a starter into the active workspace.
- Extended repository mappings and service responses with editor/source type, creator/updater identity, published state, version count, usage count, and last-used date.
- Kept every workspace-template lookup and mutation scoped by `workspaceId` and existing content permissions.

## API and persistence behavior

The existing Content template endpoints remain the single API surface. The application service enriches the list result from persisted template versions and usage records; the UI does not use mock template metadata. New and duplicated records persist editor/source provenance and the acting user where available.

## Verification

- `npm run typecheck` — passed.
- `npm run web:typecheck` — passed.
- `npm run web:build` — passed.
- `node --import tsx --test tests/delivery-workflows.test.ts tests/advanced-content.test.ts tests/template-migration.test.ts` — 27/27 passed.
- Browser QA against the authenticated local workspace — passed. The page loaded five rendered starter templates and four persisted workspace templates, with live summary counts and no console-visible render failure.

## Human validation path

1. Open **Marketing → Templates**.
2. Confirm the five starter templates show rendered email previews.
3. Open **Starter templates**, preview one, and choose **Use template**.
4. Confirm the cloned template appears under **My templates** and opens in the editor.
5. Test Favorite, Rename, Duplicate, Archive, and restore from **Archived**.
6. Open **Filters**, combine a category/editor/status filter, and confirm clearing it restores the gallery.

## Deferred by checkpoint plan

- The guided creation chooser belongs to Checkpoint 3.
- The new section/column visual builder belongs to Checkpoint 4.
- Publishing, renderer consolidation, autosave/version history, and campaign/flow integration remain in their later checkpoints.

