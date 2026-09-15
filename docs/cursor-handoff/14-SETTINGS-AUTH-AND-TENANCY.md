# Settings, authentication and tenancy

## Identity paths

`packages/application/src/identity/development-provider.ts` accepts x-dev-user only outside NODE_ENV=production and when EMAIL_PLATFORM_ALLOW_DEV_IDENTITY=true. It synthesizes a development subject/email. This header is not production authentication.

`apps/api/src/local-session-auth.ts` implements development-only password signup/signin/session/logout. Passwords use scrypt with a random 16-byte salt and 64-byte derived key; input length is 12–256. Sessions use random tokens stored by hash, a seven-day expiry and HttpOnly SameSite=Lax cookies. Local password auth requires its flag and is refused in production. This is not a complete production password-reset/MFA/account-recovery system.

`packages/application/src/identity/oidc-jwt-provider.ts` validates OIDC RS256 tokens with issuer, audience, expiry/not-before, subject/email and discovery/JWKS caching. Current local issuer/audience env values are absent. A production browser login/redirect/token-refresh integration is not implemented by the development /login page.

## Workspace and authorization

UserIdentity is global; WorkspaceMember joins a user to a workspace and role/state. WorkspaceInvitation supports invited membership/token lifecycle. Roles owner/admin/marketer/analyst and permission mappings live in phase1/permissions.ts. Services generally require a current membership and permission for workspace operations.

Private route authentication does NOT automatically authorize the requested workspace. The gateway performs routing, not universal tenant enforcement. platform-api's actor helper obtains identity but several direct Prisma routes omit member checks. There is no demonstrated blanket database row-level-security policy covering every query.

### Confirmed static authorization defects

- GET /api/v1/workspaces/:workspaceId/home/search authenticates the user and queries the supplied workspace without checking membership.
- GET /api/v1/workspaces/:workspaceId/exports/:exportId directly looks up job metadata without the service membership gate.
- Infrastructure administrator checks accept owner/admin of a workspace while exposing global gate/inbox operational information.
- Governance endpoints authorize workspace.manage, but many repository models/actions are global rather than scoped to that workspace. A tenant administrator is not automatically a platform operator.

Thus Workspace B isolation is **not guaranteed**. No exploit against another user's records was performed in this audit. Add deny-by-default route authorization and cross-tenant HTTP regression tests before exposing the product.

## Settings views

General settings update workspace business/locale/timezone fields; members/users aliases render the same membership console; sender-identities use the sender manager; API keys cover scoped event ingestion; audit/audit-log are aliases; send-policies edit send policy; dangerous-actions expose hold/readiness controls. The /settings/launch page currently renders dangerous-actions instead of the old governance LaunchReadiness component.

The send-policy page is affected by gateway GET/PATCH dispatch to the delivery module that only accepts POST. Phase4Api is a separate legacy frontend client sending a development header rather than the shared stored Bearer token; do not treat it as production-ready auth UX.

## Security and secret handling

Current root .env contains credentials/signing material: **SECRET PRESENT, VALUES REDACTED**. .gitignore excludes env files, but absent Git metadata prevents confirming they were never committed. Use protected local storage/secret management and rotate if the checkout or archive was shared. Hard-coded local fallback signing secrets/pepper exist in config/API/worker code; production should fail closed when missing rather than relying on those values.

NEXT_PUBLIC variables currently cover public URL/dev identity aliases, not AWS credential variables. Never put AWS keys, database/Redis credentials, signing secrets or pepper in client env. API-key material is one-time secret output with hash/pepper verification and scope/expiry/revocation; keep raw tokens out of logs.

Error fallback can expose raw Prisma paths/SDK details. Sanitize customer output while retaining a server correlation code. Sensitive exports and object files need deployment access control/retention, and global governance requires a separate platform-operator boundary.

