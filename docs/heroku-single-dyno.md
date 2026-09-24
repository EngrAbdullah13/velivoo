# Heroku: one web dyno for the frontend and API

The `web` process serves the Next.js application on Heroku's assigned `PORT` and starts the existing API gateway privately on `127.0.0.1:4100`. Browser API calls use same-origin `/api/...` URLs; Next.js rewrites them to the private gateway. The gateway continues routing requests to the existing Phase 1–4 services. No browser request should point at `localhost` in production.

## Deploy

1. Create a Heroku app and attach Heroku Postgres. Heroku supplies `DATABASE_URL`.
2. Deploy this repository from its root. `heroku-postbuild` generates Prisma Client, compiles the API, and builds Next.js. The `release` process runs Prisma migrations before the new web process starts.
3. Set the app's production identity/authentication configuration and required signing secrets. Do not enable development identity or passwordless development headers in a public deployment.
4. Configure a supported durable object store for uploaded/imported files. Heroku's local filesystem is ephemeral and must not be treated as persistent storage.
5. Run `web` on a dyno size with enough memory for Next.js plus the gateway and four API services. The application still has one externally exposed HTTP port.

The app's ordinary UI and workspace APIs share the Heroku origin. If production email feedback, click tracking, or unsubscribe links must also be public, configure `EMAIL_PLATFORM_PUBLIC_BASE_URL` to an HTTPS origin and expose the existing public callback service as part of the deployment/reverse-proxy setup. Queue-backed delivery and Flow execution also require Redis plus their worker/scheduler processes; those are background processes, not frontend/API HTTP listeners.

## Local production-start smoke test

After `npm run build` and `npm run web:build`, set `PORT` to an available external port and run `npm start`. The UI is served on that port, while the private gateway listens on port 4100. The default local development commands remain unchanged (`npm run dev:all`).
