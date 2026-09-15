# Omni Present

Omni Present is a workspace-based email operations platform for audiences, content, automation, deliverability, analytics, and governed sending.

## Local development

1. Copy [`.env.example`](.env.example) to `.env` and set your local database connection.
2. Start PostgreSQL and Redis.
3. Generate the client and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

4. Start the API and web app in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

The API listens on `http://localhost:4000`; the web app listens on `http://localhost:3000`.

## Sending-domain onboarding

Customers add a domain in **Deliverability → Domains**, publish the shown DNS records, then recheck it. Provider verification evidence is stored server-side. Customers create sender identities later in **Settings → Sender identities**.

The platform owns SES configuration, region, credentials, provider mappings, feedback ingestion, and send controls. Browser code never receives AWS credentials. `SES_FROM_EMAIL` and `SES_CONFIGURATION_SET` are optional local-proof fallbacks; production sends resolve persisted workspace sender identities.

## Checks

```bash
npm run typecheck
npm run web:typecheck
npm test
```
