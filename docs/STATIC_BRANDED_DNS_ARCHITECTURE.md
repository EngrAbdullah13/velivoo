# Static Branded DNS Architecture

## Overview

Velivoo supports two customer-facing DNS onboarding modes for sending domains:

| Mode | `setupMode` | `provisioningMode` | SES DKIM | Customer DNS |
|------|-------------|-------------------|----------|--------------|
| Managed / Delegated | `MANAGED_DELEGATION` | `branded_delegation` | Easy DKIM | 4 NS + ownership TXT |
| Static / Branded | `STATIC_BRANDED` | `static_branded` | BYODKIM | Velivoo-branded CNAME/TXT |

Existing managed domains are **not migrated automatically**.

## Managed mode (unchanged)

1. Customer delegates `send.customer.com` via four Velivoo NS records.
2. Velivoo creates a Route53 child zone on the reusable delegation set.
3. SES Easy DKIM is enabled on the **root** identity.
4. Velivoo publishes rewritten Easy DKIM CNAMEs, MAIL FROM, and tracking **inside** the delegated zone.
5. Customer never sees `amazonses.com` records in static mode; managed mode hides provider records after delegation.

## Static / Branded mode

### Architecture

```text
Customer DNS                         Velivoo DNS (hosted zone: VELIVOO_STATIC_DNS_DOMAIN)
────────────────                     ───────────────────────────────────────────────────
_velivoo.example.com TXT             d_<routingId>.dkim.<apex> TXT
  velivoo-site-verification=...        v=DKIM1; k=rsa; p=<public_key>
v1._domainkey.send.example.com CNAME
  → d_<routingId>.dkim.<apex>
        │                                      │
        └──────────── CNAME chain ─────────────┘
                              │
                    SES BYODKIM on send.example.com
```

Both setup modes share the **send.\<root\>** infrastructure subdomain. Managed mode delegates it via NS; static mode keeps authentication DNS at the registrar on `send.<root>` without NS delegation.

| Concept | Managed (V3) | Static branded |
|---------|--------------|----------------|
| SES identity | `<root>` | `send.<root>` |
| Infrastructure zone | `send.<root>` (delegated Route53) | `send.<root>` (customer DNS, no delegation) |
| Visible From | `user@<root>` | `user@<root>` |
| DKIM signing `d=` | `<root>` (Easy DKIM) | `send.<root>` (BYODKIM) |
| Customer DKIM hostname | `{token}._domainkey.send.<root>` (platform-managed in zone) | `v1._domainkey.send.<root>` CNAME → Velivoo |

`<apex>` is derived from `VELIVOO_STATIC_DNS_DOMAIN`: when the env value is a `dkim.*`
hosted zone (e.g. `dkim.velivoo.com`), customer targets still use `d_<id>.dkim.velivoo.com`,
not `d_<id>.dkim.dkim.velivoo.com`.

### Comparison with Klaviyo Static routing (audit)

| Klaviyo-style record | Velivoo static (Release 1) | Status | Technical purpose |
|---------------------|----------------------------|--------|-------------------|
| Sending / routing CNAME | **`send.<root>` CNAME → Velivoo send routing** | Implemented | Routes click/open tracking through Velivoo infrastructure. |
| Custom MAIL FROM MX + SPF | **`bounce.<root>` MX + TXT** | Implemented | Customer publishes SES return-path records at `bounce.<root>`; Velivoo configures SES with `BehaviorOnMxFailure=REJECT_MESSAGE`. |
| DKIM selector CNAME #1 (`s1._domainkey`) | **`v1._domainkey.send.<root>` CNAME → `d_<id>.dkim.<apex>`** | Implemented | Proves control of the sending subdomain; CNAME to Velivoo-hosted DKIM public key TXT for BYODKIM on the `send.<root>` SES identity. |
| DKIM selector CNAME #2 (`s2._domainkey`) | **Not published** | Not implemented | Second selector requires real key rotation (generate `v2`, dual-publish, SES selector switch, retire `v1`). Schema-ready only. |
| Ownership / verification TXT | **`_velivoo.<root>` TXT `velivoo-site-verification=<token>`** | Implemented | Proves the customer controls the registrable root before Velivoo activates sending. |
| Optional DMARC TXT | **Observed only; never written** | Implemented (read-only) | Recheck reads `_dmarc.<root>` if present. Velivoo never creates or overwrites customer DMARC. UI shows advisory when missing; `MANAGED_DMARC_REQUIRED=true` blocks READY without a valid policy. |

Velivoo ships **six required customer DNS records** in static mode: ownership TXT, send routing CNAME, vm1/vm2 DKIM CNAMEs, and bounce MAIL FROM MX + SPF.

### Per-domain identifiers

- **`routingId`**: opaque public id (`d_<8 hex chars>`), stable for the life of the domain.
- **`selector`**: initial selector `v1` (rotation-ready schema; v2 not enabled in Release 1).
- **Ownership**: `_velivoo.<root>` TXT with `velivoo-site-verification=<token>`.

### What we intentionally omit in Release 1 static mode

- Second DKIM selector beyond vm1/vm2 rotation pair until additional rotation UX ships.

### DKIM delivery modes

Configured by `VELIVOO_STATIC_DKIM_DELIVERY_MODE`:

- **`cname`** (default): customer CNAME → Velivoo DNS TXT public key.
- **`txt`**: branded TXT fallback at `v1._domainkey.send.<root>` if CNAME indirection is rejected by SES verification.

See `docs/STATIC_DNS_DKIM_PROOF.md` for proof status.

## Secret handling

- DKIM **public key** stored in `sender_domain.dkim_public_key` (safe).
- DKIM **private key** encrypted with `VELIVOO_DKIM_KEY_ENCRYPTION_SECRET` (or KMS in production) in `dkim_private_key_secret_ref`.
- Private key is **never** returned in API responses, audit events, or frontend payloads.
- Production should prefer AWS KMS envelope encryption with a dedicated provisioning IAM role.

## Verification flow (static)

1. Resolve customer ownership TXT (`_velivoo`).
2. Resolve customer send routing CNAME and DKIM CNAME/TXT.
3. Resolve Velivoo DNS public-key target.
4. Query SES identity + BYODKIM status.
5. Configure SES Custom MAIL FROM at `bounce.<root>` with `REJECT_MESSAGE` on MX failure.
6. Resolve customer MAIL FROM MX + SPF at `bounce.<root>` from public DNS.
7. Require SES `MailFromDomainStatus=SUCCESS` before MAIL FROM is ready.
8. Observe root DMARC (advisory unless `MANAGED_DMARC_REQUIRED=true`).
9. Activate delivery route only when backend evidence passes.

## API

- `POST /sender-domains` `{ domain, setupMode: "MANAGED_DELEGATION" | "STATIC_BRANDED" }`
- `POST /sender-domains/:id/recheck`
- `POST /sender-domains/:id/retry-provisioning` (idempotent resume)

## Environment variables

| Variable | Purpose |
|----------|---------|
| `VELIVOO_STATIC_DNS_DOMAIN` | Velivoo DKIM hosted zone or apex (e.g. `velivoodns.com` or `dkim.velivoo.com`). Customer CNAME targets are always `d_<routingId>.dkim.<apex>`. |
| `VELIVOO_STATIC_DNS_ZONE_ID` | Route53 hosted zone id for static DNS |
| `VELIVOO_STATIC_BRANDED_DNS_ENABLED` | Enable static mode in API/UI |
| `VELIVOO_STATIC_DKIM_DELIVERY_MODE` | `cname` or `txt` |
| `VELIVOO_DKIM_KEY_ENCRYPTION_SECRET` | Local/proof encryption secret |

## AWS setup (manual, one-time)

1. Register/host `velivoodns.com` in Route53.
2. Grant provisioning role: `ses:CreateEmailIdentity`, `ses:PutEmailIdentityDkimSigningAttributes`, Route53 change permissions on static zone.
3. Grant KMS `Encrypt/Decrypt` to provisioning role only.
4. Keep existing reusable delegation set for managed mode.

## Failure handling

- Wrong/missing DNS → `MISMATCH` / `WAITING_FOR_DNS`, not `READY`.
- Retry provisioning reuses routing id + DKIM key when already created.
- SES throttling → rescheduled verification every 5 seconds.

## Future: key rotation

Schema supports `dkimSelector` changes and additional DNS evidence rows. Planned flow: generate `v2`, verify customer record, switch SES signing selector, retire `v1` after grace period.
