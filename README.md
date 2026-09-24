# Omni Present

Omni Present is a workspace-based email operations platform for audiences, content, automation, deliverability, analytics, and governed sending.

## Project layout

```text
frontend/        Next.js web application
backend/api/     Main API gateway and API services
backend/public-api/  Public feedback, tracking, and unsubscribe endpoints
backend/worker/  Background workers
backend/scheduler/  Background schedulers
packages/        Shared domain, application, database, and queue code
scripts/         Local and deployment helpers
tests/           Automated tests
```

The folders are organized separately, but the production-style launcher can serve the web app and APIs from one public app address.

## Local development

1. Copy [`.env.example`](.env.example) to `.env` and set your local database connection.
2. Start PostgreSQL. Redis is needed only for queue workers and schedulers.
3. Generate the client and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

4. Start the local development stack from one terminal:

```bash
npm run dev:all
```

Open the web app at `http://localhost:3000`. The development command starts the web app and local API services; queue workers start only when Redis is configured and reachable.

### Test the combined production-style server locally

In Windows Command Prompt, build the app and start it on one public local port:

```bat
npm run heroku-postbuild
set PORT=3005 && npm start
```

Then open `http://localhost:3005`. This is the same `npm start` entry point used by the Heroku `web` process. It still requires a valid `.env`/`DATABASE_URL`; queue workers remain separate and need Redis.

## Sending-domain onboarding

Customers add a domain in **Deliverability → Domains**, publish the shown DNS records, then recheck it. Provider verification evidence is stored server-side. Customers create sender identities later in **Settings → Sender identities**.

The platform owns SES configuration, region, credentials, provider mappings, feedback ingestion, and send controls. Browser code never receives AWS credentials. `SES_FROM_EMAIL` and `SES_CONFIGURATION_SET` are optional local-proof fallbacks; production sends resolve persisted workspace sender identities.

## Checks

```bash
npm run typecheck
npm run web:typecheck
npm test
```
