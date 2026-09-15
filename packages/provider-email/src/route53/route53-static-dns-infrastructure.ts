import {
  staticBrandedDkimSelectorHost,
  staticBrandedSendRoutingHost,
} from "../../../domain/src/phase1/static-branded-dns.js";
import { canonicalDnsName, normalizeTxtContent, route53TxtValues } from "../../../domain/src/phase1/dns.js";
import type { DnsProvider, ManagedDnsRecord } from "../../../application/src/ports/dns-provider.js";
import type { StaticDnsCheckResult, StaticDnsInfrastructure } from "../../../application/src/ports/static-dns-infrastructure.js";

function staticDnsStatus(status: string): StaticDnsCheckResult["status"] {
  return status === "verified" || status === "mismatch" ? status : "pending";
}

export class Route53StaticDnsInfrastructure implements StaticDnsInfrastructure {
  readonly provider = "route53";

  constructor(
    private readonly dns: DnsProvider,
    private readonly dkimZoneReference: string,
    private readonly staticDnsDomain: string,
    private readonly sendZoneReference: string,
    private readonly staticSendDomain: string,
    private readonly sendRoutingTarget: string,
  ) {}

  private dkimHost(routingId: string, selector: string) {
    return staticBrandedDkimSelectorHost(routingId, selector, this.staticDnsDomain);
  }

  private sendHost(routingId: string) {
    return staticBrandedSendRoutingHost(routingId, this.staticSendDomain);
  }

  async publishDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }) {
    const name = this.dkimHost(input.routingId, input.selector);
    const record: ManagedDnsRecord = { type: "TXT", name, values: route53TxtValues(input.publicKeyTxt), ttl: 300 };
    await this.dns.upsertRecord({ zoneReference: this.dkimZoneReference, record });
    return record;
  }

  async checkDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }) {
    const name = this.dkimHost(input.routingId, input.selector);
    const evidence = await this.dns.resolveTxt(name);
    const normalizedExpected = normalizeTxtContent(input.publicKeyTxt);
    const normalizedObserved = normalizeTxtContent(evidence.observed);
    const match = normalizedObserved === normalizedExpected
      || normalizedObserved.includes(normalizedExpected)
      || normalizedExpected.includes(normalizedObserved);
    return {
      status: match ? "verified" as const : evidence.status === "verified" ? "mismatch" as const : "pending" as const,
      observed: evidence.observed,
      checkedAt: evidence.checkedAt,
    };
  }

  async removeDkimPublicKey(input: { routingId: string; selector: string }) {
    if (!this.dns.deleteZoneSafely) return;
    const name = canonicalDnsName(this.dkimHost(input.routingId, input.selector));
    await this.dns.deleteZoneSafely({ zoneReference: this.dkimZoneReference, allowedRecords: [{ type: "TXT", name, values: ["*"], ttl: 300 }] }).catch(() => undefined);
  }

  async publishSendRouting(input: { routingId: string; target?: string }) {
    const name = this.sendHost(input.routingId);
    const target = canonicalDnsName(input.target ?? this.sendRoutingTarget);
    const record: ManagedDnsRecord = { type: "CNAME", name, values: [target], ttl: 300 };
    await this.dns.upsertRecord({ zoneReference: this.sendZoneReference, record });
    return record;
  }

  async checkSendRouting(input: { routingId: string; target?: string }) {
    const name = this.sendHost(input.routingId);
    const expected = canonicalDnsName(input.target ?? this.sendRoutingTarget);
    const evidence = await this.dns.checkCname({ name, expectedTarget: expected });
    return {
      status: staticDnsStatus(evidence.status),
      observed: evidence.observed,
      checkedAt: evidence.checkedAt,
    };
  }

  async removeSendRouting(input: { routingId: string }) {
    if (!this.dns.deleteZoneSafely) return;
    const name = canonicalDnsName(this.sendHost(input.routingId));
    await this.dns.deleteZoneSafely({ zoneReference: this.sendZoneReference, allowedRecords: [{ type: "CNAME", name, values: ["*"], ttl: 300 }] }).catch(() => undefined);
  }
}

export class InMemoryStaticDnsInfrastructure implements StaticDnsInfrastructure {
  readonly provider = "memory";
  private readonly dkimRecords = new Map<string, string>();
  private readonly sendRecords = new Map<string, string>();

  constructor(
    private readonly staticDnsDomain: string,
    private readonly staticSendDomain: string,
    private readonly sendRoutingTarget: string,
  ) {}

  private dkimKey(routingId: string, selector: string) {
    return staticBrandedDkimSelectorHost(routingId, selector, this.staticDnsDomain);
  }

  private sendKey(routingId: string) {
    return staticBrandedSendRoutingHost(routingId, this.staticSendDomain);
  }

  async publishDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }) {
    const name = this.dkimKey(input.routingId, input.selector);
    this.dkimRecords.set(name, input.publicKeyTxt);
    return { type: "TXT" as const, name, values: [input.publicKeyTxt], ttl: 300 };
  }

  async checkDkimPublicKey(input: { routingId: string; selector: string; publicKeyTxt: string }) {
    const name = this.dkimKey(input.routingId, input.selector);
    const observed = this.dkimRecords.get(name);
    return {
      status: observed === input.publicKeyTxt ? "verified" as const : observed ? "mismatch" as const : "pending" as const,
      observed: observed ? [observed] : [],
      checkedAt: new Date(),
    };
  }

  async publishSendRouting(input: { routingId: string; target?: string }) {
    const name = this.sendKey(input.routingId);
    const target = input.target ?? this.sendRoutingTarget;
    this.sendRecords.set(name, target);
    return { type: "CNAME" as const, name, values: [target], ttl: 300 };
  }

  async checkSendRouting(input: { routingId: string; target?: string }) {
    const name = this.sendKey(input.routingId);
    const observed = this.sendRecords.get(name);
    const expected = input.target ?? this.sendRoutingTarget;
    return {
      status: observed === expected ? "verified" as const : observed ? "mismatch" as const : "pending" as const,
      observed: observed ? [observed] : [],
      checkedAt: new Date(),
    };
  }

  seedDkim(routingId: string, selector: string, publicKeyTxt: string) {
    this.dkimRecords.set(this.dkimKey(routingId, selector), publicKeyTxt);
  }

  seedSendRouting(routingId: string, target?: string) {
    this.sendRecords.set(this.sendKey(routingId), target ?? this.sendRoutingTarget);
  }
}
