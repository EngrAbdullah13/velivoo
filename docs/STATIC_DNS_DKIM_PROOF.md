# Static DNS DKIM Proof

## Goal

Verify whether Amazon SES BYODKIM accepts this chain:

```text
v1._domainkey.example.com  CNAME  v1.domainkey.<routingId>.velivoodns.com
v1.domainkey.<routingId>.velivoodns.com  TXT  p=<DKIM_PUBLIC_KEY>
```

If SES rejects CNAME indirection, use branded TXT fallback at the customer zone:

```text
v1._domainkey.example.com  TXT  p=<DKIM_PUBLIC_KEY>
```

## Status

**EXTERNAL BLOCKED in this workspace run**

This repository implements both code paths (`VELIVOO_STATIC_DKIM_DELIVERY_MODE=cname|txt`) and unit tests for record generation, encryption, and provisioning logic. A live SES proof was **not executed** here because it requires:

1. A real `velivoodns.com` (or configured) Route53 hosted zone.
2. AWS credentials with SES BYODKIM permissions in the target region.
3. A test domain where customer DNS can be published or simulated.

## How to run the proof manually

1. Set environment:

```bash
VELIVOO_STATIC_BRANDED_DNS_ENABLED=true
VELIVOO_STATIC_DNS_DOMAIN=velivoodns.com
VELIVOO_STATIC_DNS_ZONE_ID=ZXXXXXXXXXXXX
VELIVOO_DKIM_KEY_ENCRYPTION_SECRET=<strong-secret>
AWS_SES_REGION=us-east-1
ROUTE53_DNS_ENABLED=true
DNS_PROVIDER=route53
```

2. Create a static domain via API:

```http
POST /api/v1/workspaces/{id}/sender-domains
{ "domain": "your-test-domain.com", "setupMode": "STATIC_BRANDED" }
```

3. Publish customer DNS records from the response.
4. Call `POST .../recheck` until SES DKIM status is `SUCCESS`.
5. Send one test email and inspect headers for `DKIM-Signature` with `d=your-test-domain.com` and `s=v1`.

## If CNAME proof fails

Set:

```bash
VELIVOO_STATIC_DKIM_DELIVERY_MODE=txt
```

Retry provisioning (existing domains keep their routing id/key; only customer instruction mode changes for new prepares).

Document the SES error code and timestamp in this file when observed.

## Automated coverage in repo

`tests/static-branded-dns.test.ts` verifies:

- Velivoo-branded hostname generation
- Private key encryption + non-leakage in API-shaped payloads
- Static provisioner customer record generation without `amazonses.com`
