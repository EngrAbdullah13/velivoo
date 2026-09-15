import { canonicalDnsName } from "./dns.js";
import { infraDomain, velivooOwnershipValue } from "./branded-domain.js";

/** Velivoo Marketing DKIM selectors for static branded mode. */
export const STATIC_DKIM_SELECTOR_PRIMARY = "vm1" as const;
export const STATIC_DKIM_SELECTOR_STANDBY = "vm2" as const;
export const STATIC_DKIM_SELECTORS = [STATIC_DKIM_SELECTOR_PRIMARY, STATIC_DKIM_SELECTOR_STANDBY] as const;
export type StaticDkimSelector = typeof STATIC_DKIM_SELECTORS[number];

export const DKIM_ROTATION_STATES = [
  "stable",
  "standby_verifying",
  "switching",
  "grace_period",
] as const;
export type DkimRotationState = typeof DKIM_ROTATION_STATES[number];

export const DKIM_ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function staticBrandedZoneApex(configuredDomain: string, zonePrefix: "dkim." | "send." = "dkim.") {
  const canonical = canonicalDnsName(configuredDomain);
  if (!canonical) throw new Error("STATIC_DNS_DOMAIN_INVALID");
  return canonical.startsWith(zonePrefix) ? canonical.slice(zonePrefix.length) : canonical;
}

export function staticBrandedDkimSelectorHost(routingId: string, selector: string, staticDnsDomain: string) {
  return `${selector}.${routingId}.dkim.${staticBrandedZoneApex(staticDnsDomain, "dkim.")}`;
}

export function staticBrandedSendRoutingHost(routingId: string, staticSendDomain: string) {
  return `${routingId}.send.${staticBrandedZoneApex(staticSendDomain, "send.")}`;
}

/** Customer CNAME: send.<root> → <routingId>.send.<apex> */
export function staticSendCustomerHost(rootDomain: string) {
  return infraDomain(rootDomain);
}

/** Customer CNAME: vm1._domainkey.<root> → vm1.<routingId>.dkim.<apex> */
export function staticDkimCustomerHost(rootDomain: string, selector: string) {
  return `${selector}._domainkey.${canonicalDnsName(rootDomain)}`;
}

/** Root apex ownership TXT (registrar @ record). */
export function staticRootOwnershipRecord(rootDomain: string, token: string) {
  return {
    type: "TXT" as const,
    name: canonicalDnsName(rootDomain),
    values: [velivooOwnershipValue(token)],
    ttl: 300,
  };
}

export function staticDmarcAdvisoryRecord(rootDomain: string, policy = "v=DMARC1; p=none") {
  return {
    type: "TXT" as const,
    name: `_dmarc.${canonicalDnsName(rootDomain)}`,
    values: [policy],
    ttl: 300,
    advisory: true as const,
  };
}

/** Custom SES MAIL FROM at bounce.<root> — not bounce.send.<root>. */
export function staticBrandedMailFromDomain(rootDomain: string) {
  return `bounce.${canonicalDnsName(rootDomain)}`;
}

export function staticBrandedMailFromMxTarget(sesRegion: string) {
  const region = sesRegion.trim().toLowerCase();
  if (!region) throw new Error("SES_REGION_NOT_CONFIGURED");
  return `feedback-smtp.${region}.amazonses.com`;
}

export function staticBrandedMailFromRecords(rootDomain: string, sesRegion: string) {
  const name = staticBrandedMailFromDomain(rootDomain);
  const exchange = staticBrandedMailFromMxTarget(sesRegion);
  return [
    { type: "MX" as const, name, values: [`10 ${exchange}`], ttl: 300, priority: 10, exchange },
    { type: "TXT" as const, name, values: ["v=spf1 include:amazonses.com ~all"], ttl: 300 },
  ];
}

export function oppositeStaticSelector(selector: string): StaticDkimSelector {
  return selector === STATIC_DKIM_SELECTOR_STANDBY ? STATIC_DKIM_SELECTOR_PRIMARY : STATIC_DKIM_SELECTOR_STANDBY;
}

export function isStaticDkimSelector(value: string): value is StaticDkimSelector {
  return (STATIC_DKIM_SELECTORS as readonly string[]).includes(value);
}
