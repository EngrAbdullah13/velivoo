# Repository map

## Repository identity

Work from the inner folder containing root `package.json`, `packages/`, and `apps/`. The outer folder is only a container. No .git repository was found in either location or ancestors; commit history, diffs, branches and tags are UNKNOWN. Existing content was preserved.

Root package is `omni-present@1.0.0`; workspace packages use `@email-platform/*`; UI branding is Velivoo. Root uses Node 22.x, TypeScript 5.8.3, Prisma 6.0.0, BullMQ 6.1.2 and ioredis 6.0.0. Web uses Next 16.3.1 and React 19.2.8. Exact installed constraints are in package manifests/lockfile.

## Important directories and dependency direction

| Path | Purpose and entrypoints | Dependencies / caution |
|---|---|---|
| apps/web | Next App Router, client consoles, editors, global CSS; src/app and src/components | Fetches gateway; never import server env/provider credentials |
| apps/api/src | app-server gateway; platform-api, delivery-api, automation-api, governance-api | Composes services, Prisma and provider adapters; handwritten ordered routes |
| apps/public-api/src | real-server SNS/click/unsubscribe/events; server proof counterpart | Externally reachable 4001; not proxied by gateway |
| apps/worker/src | Domain verification, phase1 imports, phase2 delivery, phase3 flows; feedback in real-main | Different queues and schedules; dev:all does not start every worker |
| apps/scheduler/src | real-main feedback/legacy scheduling; real-phase3-main automation/outbox | Must not compete for domain actions; current Phase3 claim is overly broad |
| packages/domain/src | Pure policy, validation, graph/rule/document types; phase0–phase4 | No provider side effects; phase labels do not indicate current/obsolete |
| packages/application/src | Phase1Service, BrandedDomainProvisioningService, Phase2Service, Phase3Service/runtime; ports | Domain logic plus repository/provider abstractions |
| packages/persistence | Prisma schema/migrations and concrete repositories; proof/in-memory stores | PostgreSQL is canonical runtime state; SQL contains extra constraints |
| packages/provider-email/src | SES send/domain/configuration adapters; Route 53; CloudFront; fake adapters | Explicit enable flags can make proof runtime call AWS |
| packages/queue/src | BullMQ phase-specific queues and proof file queue | Installed BullMQ custom-ID restrictions matter |
| packages/config/src/env.ts | Shared env loading/parsing and runtime modes | Server-only; .env.local before .env unless process already populated |
| packages/observability | Trace/log support | Avoid payload/credential leakage |
| tests | 19 test files, 157 tests | Mostly in-memory and SDK mocks, not live integration |
| docs | Previous phase/design/release documents plus this handoff | Historical completion statements must be rechecked |
| tmp | Local investigation/support utilities | Not a production entrypoint |
| .local | Local object/proof artifacts when created | Sensitive local data; not a deployable shared object-store design |
| .cursor/rules | Concise scoped continuation rules added by this audit | No prior Cursor convention existed |
| dist, node_modules, apps/web/.next | Generated output/dependencies | Not the source of product behavior |

See the exact [file index](23-FILE-INDEX.md) for all inventoried application, package, migration and test files.

## Layer boundaries

Browser → HTTP route → application service → domain policy and repository/provider ports → Prisma/Redis/AWS. Some routes bypass services and query Prisma directly; that is the source of authorization and duplicate-routing debt, not a recommended pattern.

`package.json` scripts build root TypeScript separately from the frontend. `tsconfig.json` excludes certain real-runtime files as root inputs, although transitive imports can still compile excluded files. Do not equate a root tsc pass with complete standalone-worker coverage.

## Local command entrypoints

Run `npm run dev:web` for 3000; `npm run dev:api` for gateway 4000 and child APIs 4101–4104; `npm run dev:domain-worker` for domain verification; `npm run dev:worker` for Phase2 delivery. `npm run dev:all` starts a selected subset, including public API 4001. See [jobs](17-JOBS-QUEUES-WORKERS.md) before assuming full feedback/import/automation processing is active.

Prisma generation is `npm run db:generate`; migration deployment is `npm run db:migrate`. Migration deployment is a write operation and was NOT run during this audit. No root seed script is defined; development bootstrap is an explicit API/local-auth operation.

