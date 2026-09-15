# Domain onboarding V3: five customer DNS records

## Contract

For `customer.com`, new rows use `V3_ROOT_SENDER_DELEGATED_EASY_DKIM`.

Customer-facing DNS is exactly five records:

1. NS `send.customer.com` → `ns1.velivoo.com`
2. NS `send.customer.com` → `ns2.velivoo.com`
3. NS `send.customer.com` → `ns3.velivoo.com`
4. NS `send.customer.com` → `ns4.velivoo.com`
5. TXT `_amazonses.customer.com` ownership verification

Customers do not see SES Easy DKIM CNAMEs, MAIL FROM, SPF, or tracking records.

The visible sender and SES identity remain `customer.com`. `send.customer.com` is delegated infrastructure only. After NS delegation, Velivoo owns records below that zone:

- SES Easy DKIM CNAMEs published as `{token}._domainkey.send.customer.com`;
- custom MAIL FROM: `bounce.send.customer.com`;
- tracking: `click.send.customer.com`.

Velivoo does not generate or store DKIM private keys. `EMAIL_PLATFORM_DKIM_KEY_ENCRYPTION_SECRET` is not required. MIME is submitted unsigned; SES Easy DKIM is the signer.

## Authentication

SES `CreateEmailIdentity` keeps Easy DKIM enabled. Velivoo also reads the SES v1 ownership token (`GetIdentityVerificationAttributes`, with `VerifyDomainIdentity` only if the token is missing) and shows `_amazonses.customer.com` to the customer. Easy DKIM is never disabled.

SES Easy DKIM CNAME *names* for identity `customer.com` are `{token}._domainkey.customer.com`. V3 rewrites those names into the delegated zone so Route 53 can host them after NS delegation. Recheck verifies public NS, SOA, the ownership TXT, the rewritten Easy DKIM CNAMEs, SES identity verification, and SES `dkimStatus === SUCCESS` before MAIL FROM, tracking, or the delivery route can become ready. The check is fail-closed: Velivoo never marks a domain ready without SES Easy DKIM SUCCESS.

## Monitoring and lifecycle

The branded-domain worker polls due work every 5 seconds. Create and pending recheck schedule the next check 5 seconds later until `READY`. Persisted V3 states are:

`CREATED`, `WAITING_FOR_DNS`, `DNS_VERIFIED`, `OWNERSHIP_VERIFIED`, `SES_VERIFYING`, `DKIM_VERIFYING`, `READY`, `FAILED`, `DELETING`, `DELETED`

Older V2 names such as `AWAITING_CUSTOMER_DNS` remain valid for existing V2 rows. Audit events are written for `domain.created`, `domain.dns.verified`, `domain.ses.verified`, `domain.dkim.verified`, and `domain.deleted`.

## Delete

After the user confirms the root domain name, Velivoo holds the route, sets `DELETING`, deletes the SES identity, removes MAIL FROM / Easy DKIM / tracking records from the child zone, deletes the Route 53 hosted zone, cancels verification jobs, and persists `DELETED`. Shared delegation sets and unrelated DNS are not deleted.

## Compatibility and migration

Leftover `V3_ROOT_SENDER_PLATFORM_DKIM` rows are treated as this Easy DKIM + ownership TXT path on prepare/recheck. Their platform-managed RSA keys are not used. Existing `V2_ROOT_SENDER_DELEGATED_INFRA` rows keep customer-published root Easy DKIM CNAMEs. V1 remains legacy compatibility. Recheck branches by `provisioningVersion`; V2 is not silently converted.

A future V2-to-V3 migration must be explicit. Changing only `provisioningVersion` is unsafe. Authored SQL drops `sender_domain_dkim_key`; unused `sender_domain` columns from the removed key path are left in place. Do not run migrations or AWS resource changes merely to inspect this change.

## DMARC

If SES Easy DKIM succeeds for the root identity, DKIM `d=` is `customer.com` and aligns with visible From `customer.com`, including `adkim=s`. SPF MAIL FROM remains `bounce.send.customer.com`. Velivoo does not create or overwrite root DMARC.
