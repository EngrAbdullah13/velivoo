import { randomUUID } from "node:crypto";
import {
  DKIM_MODE_BYODKIM,
  PROVISIONING_MODE_STATIC_BRANDED,
  SETUP_MODE_STATIC_BRANDED,
  V5_STATIC_BRANDED_KLAVIYO,
  byodkimIdentityReady,
  customerDnsUsesProviderBranding,
  infraDomain,
  mailFromIdentityReady,
  staticLifecycleState,
} from "../../../domain/src/phase1/branded-domain.js";
import { buildStaticProductionCustomerRecords } from "../../../domain/src/phase1/static-production-customer-dns.js";
import { staticProductionDnsRecordCount } from "../../../domain/src/phase1/static-branded-dns.js";
import { normalizeDomain, txtMatches } from "../../../domain/src/phase1/dns.js";
import {
  generateOwnershipToken,
  generateRoutingId,
  hashOwnershipToken,
} from "../../../domain/src/phase1/dkim-key.js";
import {
  STATIC_DKIM_SELECTORS,
  staticBrandedDkimSelectorHost,
  staticBrandedMailFromDomain,
  staticBrandedMailFromRecords,
  staticBrandedSendRoutingHost,
  staticDkimCustomerHost,
  staticDmarcAdvisoryRecord,
  staticRootOwnershipRecord,
  staticProductionDnsPurposes,
  staticSendCustomerHost,
  type StaticDkimSelector,
} from "../../../domain/src/phase1/static-branded-dns.js";
import type { DnsCheckEvidence, DnsProvider } from "../ports/dns-provider.js";
import type { DomainProvisioningRepository, ProvisioningDomain } from "../ports/domain-provisioning-repository.js";
import type { EmailDomainIdentityState, EmailDomainProvider } from "../ports/email-domain-provider.js";
import type { StaticDnsInfrastructure } from "../ports/static-dns-infrastructure.js";
import { StaticDkimRotationService } from "./static-dkim-rotation-service.js";

export interface StaticBrandedConfig {
  sesRegion: string;
  staticDnsDomain: string;
  staticSendDnsDomain: string;
  sendRoutingTarget: string;
  snsTopicArn?: string;
  dmarcPolicy: string;
  dmarcRequired: boolean;
  dkimKeyEncryptionSecret: string;
}

const TERMINAL = new Set(["DELETING", "DELETED", "deleted", "archived"]);
const success = (value?: string | null) => String(value ?? "").toUpperCase() === "SUCCESS";
const verified = (e: DnsCheckEvidence) => e.status === "verified";
const validDmarc = (value: string) => /^v=DMARC1\s*;/i.test(value.trim()) && /;\s*p=(none|quarantine|reject)(?:\s*;|$)/i.test(value.trim());

type DomainRecord = Record<string, unknown>;

export class StaticBrandedProvisioner {
  private readonly rotation: StaticDkimRotationService;

  constructor(
    private readonly repo: DomainProvisioningRepository,
    private readonly dns: DnsProvider | undefined,
    private readonly staticDns: StaticDnsInfrastructure | undefined,
    private readonly email: EmailDomainProvider | undefined,
    private readonly cfg: StaticBrandedConfig,
  ) {
    this.rotation = new StaticDkimRotationService(cfg.dkimKeyEncryptionSecret);
  }

  private assertInfrastructure() {
    if (!this.dns) throw new Error("DNS_PROVIDER_NOT_CONFIGURED");
    if (!this.staticDns) throw new Error("STATIC_DNS_INFRASTRUCTURE_NOT_CONFIGURED");
    if (!this.email?.ensureByodkimIdentity) throw new Error("EMAIL_DOMAIN_PROVIDER_NOT_CONFIGURED");
    if (!this.email?.configureMailFrom) throw new Error("EMAIL_DOMAIN_PROVIDER_NOT_CONFIGURED");
    if (!this.dns.checkMx) throw new Error("DNS_MX_CHECK_UNAVAILABLE");
    if (!this.cfg.dkimKeyEncryptionSecret.trim()) throw new Error("DKIM_KEY_ENCRYPTION_SECRET_MISSING");
    if (!this.cfg.sendRoutingTarget.trim()) throw new Error("STATIC_SEND_ROUTING_TARGET_MISSING");
  }

  private async upsertMailFromEvidence(
    workspaceId: string,
    domain: ProvisioningDomain,
    root: string,
    mailFromRecords: ReturnType<typeof staticBrandedMailFromRecords>,
  ) {
    const mx = mailFromRecords.find(record => record.type === "MX")!;
    const spf = mailFromRecords.find(record => record.type === "TXT")!;
    await this.repo.upsertDnsEvidence({
      workspaceId,
      senderDomainId: domain.id,
      purpose: "mail_from_mx",
      ownership: "customer",
      record: { type: mx.type, name: mx.name, values: mx.values, ttl: mx.ttl },
      verificationStatus: "pending",
      customerActionRequired: true,
    });
    await this.repo.upsertDnsEvidence({
      workspaceId,
      senderDomainId: domain.id,
      purpose: "mail_from_spf",
      ownership: "customer",
      record: { type: spf.type, name: spf.name, values: spf.values, ttl: spf.ttl },
      verificationStatus: "pending",
      customerActionRequired: true,
    });
  }

  private async verifyMailFromDns(root: string, mailFromRecords: ReturnType<typeof staticBrandedMailFromRecords>) {
    const mx = mailFromRecords.find(record => record.type === "MX")!;
    const spf = mailFromRecords.find(record => record.type === "TXT")!;
    const mxCheck = await this.dns!.checkMx!({
      name: mx.name,
      expectedPriority: mx.priority,
      expectedExchange: mx.exchange,
    });
    const spfCheck = await this.dns!.resolveTxt(spf.name);
    const spfVerified = verified(spfCheck) && txtMatches(spfCheck.observed, spf.values[0]!);
    return {
      mxCheck,
      spfCheck,
      mailFromDnsVerified: verified(mxCheck) && spfVerified,
      spfVerified,
    };
  }

  private async withLock<T>(domain: ProvisioningDomain, run: () => Promise<T>) {
    const owner = `static:${randomUUID()}`;
    const claimed = await this.repo.claimDomainProvisioning({
      workspaceId: domain.workspaceId,
      senderDomainId: domain.id,
      owner,
      leaseUntil: new Date(Date.now() + 120_000),
    });
    if (!claimed) throw new Error("DOMAIN_PROVISIONING_IN_PROGRESS");
    try {
      return await run();
    } finally {
      await this.repo.releaseDomainProvisioning({ workspaceId: domain.workspaceId, senderDomainId: domain.id, owner });
    }
  }

  private asRecord(domain: ProvisioningDomain): DomainRecord {
    return domain as unknown as DomainRecord;
  }

  private async publishVelivooInfrastructure(domain: ProvisioningDomain, routingId: string) {
    const keys = this.rotation.readKeys(this.asRecord(domain));
    await this.staticDns!.publishSendRouting({ routingId, target: this.cfg.sendRoutingTarget });
    for (const selector of STATIC_DKIM_SELECTORS) {
      const publicKeyTxt = selector === keys.activeSelector ? keys.activePublicKey : keys.standbyPublicKey;
      await this.staticDns!.publishDkimPublicKey({ routingId, selector, publicKeyTxt });
    }
  }

  private async prepareUnlocked(domain: ProvisioningDomain) {
    this.assertInfrastructure();
    const root = domain.rootDomain ?? domain.domain;
    const routingId = this.asRecord(domain).routingId as string | undefined ?? generateRoutingId();
    let ownershipToken = domain.ownershipVerificationToken ?? null;
    let tokenHash = this.asRecord(domain).ownershipVerificationTokenHash as string | null | undefined;
    if (!ownershipToken) {
      ownershipToken = generateOwnershipToken();
      tokenHash = hashOwnershipToken(ownershipToken);
    }

    const keyPatch = this.rotation.ensureInitialDualKeys(this.asRecord(domain));
    const selectors = this.rotation.defaultSelectors();

    await this.repo.updateProvisioningDomain({
      workspaceId: domain.workspaceId,
      domainId: domain.id,
      patch: {
        lifecycleState: "CREATED",
        provisioningVersion: V5_STATIC_BRANDED_KLAVIYO,
        provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
        setupMode: SETUP_MODE_STATIC_BRANDED,
        routingId,
        dkimSelector: selectors.activeSelector,
        dkimStandbySelector: selectors.standbySelector,
        dkimSigningMode: DKIM_MODE_BYODKIM,
        dkimSigningDomain: root,
        ownershipVerificationToken: ownershipToken,
        ownershipVerificationTokenHash: tokenHash,
        ownershipVerificationStatus: "pending",
        dnsStatus: "pending",
        delegatedSubdomain: staticSendCustomerHost(root, this.cfg.staticSendDnsDomain),
        lastErrorCode: null,
        lastErrorMessage: null,
        ...keyPatch,
      },
    });

    domain = (await this.repo.findProvisioningDomain(domain.workspaceId, domain.id))!;
    await this.repo.retireCustomerDnsEvidence(domain.workspaceId, domain.id);
    await this.publishVelivooInfrastructure(domain, routingId);

    const ownership = staticRootOwnershipRecord(root, ownershipToken);
    await this.repo.upsertDnsEvidence({
      workspaceId: domain.workspaceId,
      senderDomainId: domain.id,
      purpose: "ownership",
      ownership: "customer",
      record: ownership,
      verificationStatus: "pending",
      customerActionRequired: true,
    });

    const sendTarget = staticBrandedSendRoutingHost(routingId, this.cfg.staticSendDnsDomain);
    const sendHost = staticSendCustomerHost(root, this.cfg.staticSendDnsDomain);
    if (this.repo.purgeDnsEvidenceExceptName) await this.repo.purgeDnsEvidenceExceptName(domain.workspaceId, domain.id, "send_routing", sendHost);
    else if (this.repo.retireDnsEvidenceExceptName) await this.repo.retireDnsEvidenceExceptName(domain.workspaceId, domain.id, "send_routing", sendHost);
    await this.repo.upsertDnsEvidence({
      workspaceId: domain.workspaceId,
      senderDomainId: domain.id,
      purpose: "send_routing",
      ownership: "customer",
      record: { type: "CNAME", name: sendHost, values: [sendTarget], ttl: 300 },
      verificationStatus: "pending",
      customerActionRequired: false,
    });

    const keys = this.rotation.readKeys(this.asRecord(domain));
    const customerRecords = STATIC_DKIM_SELECTORS.map(selector => {
      const host = staticDkimCustomerHost(root, selector);
      const target = staticBrandedDkimSelectorHost(routingId, selector, this.cfg.staticDnsDomain);
      return { selector, host, target, publicKeyTxt: selector === keys.activeSelector ? keys.activePublicKey : keys.standbyPublicKey };
    });

    for (const record of customerRecords) {
      await this.repo.upsertDnsEvidence({
        workspaceId: domain.workspaceId,
        senderDomainId: domain.id,
        purpose: selectorPurpose(record.selector),
        ownership: "customer",
        record: { type: "CNAME", name: record.host, values: [record.target], ttl: 300 },
        verificationStatus: "pending",
        customerActionRequired: true,
      });
    }

    const dmarcAdvisory = staticDmarcAdvisoryRecord(root, this.cfg.dmarcPolicy);
    await this.repo.upsertDnsEvidence({
      workspaceId: domain.workspaceId,
      senderDomainId: domain.id,
      purpose: "dmarc_advisory",
      ownership: "customer",
      record: { type: dmarcAdvisory.type, name: dmarcAdvisory.name, values: dmarcAdvisory.values, ttl: dmarcAdvisory.ttl },
      verificationStatus: this.cfg.dmarcRequired ? "pending" : "advisory",
      customerActionRequired: this.cfg.dmarcRequired,
    });

    const mailFromDomain = staticBrandedMailFromDomain(root);
    const mailFromRecords = staticBrandedMailFromRecords(root, this.email!.region);
    await this.upsertMailFromEvidence(domain.workspaceId, domain, root, mailFromRecords);

    let identityPatch: Record<string, unknown> = {
      providerRegion: this.email!.region,
      providerStatus: "pending",
      verificationStatus: "PENDING",
      dkimStatus: "PENDING",
      mailFromStatus: "PENDING",
    };
    let readinessReasons = ["OWNERSHIP_VERIFICATION_PENDING", "STATIC_DKIM_DNS_PENDING", "STATIC_DKIM_VM2_PENDING", "MAIL_FROM_PENDING"];
    try {
      const privateKey = this.rotation.activePrivateKey(this.asRecord(domain));
      const identity = await this.email!.ensureByodkimIdentity!({
        domain: root,
        selector: keys.activeSelector,
        privateKeyPem: privateKey,
        existingReference: domain.providerReference,
        workspaceId: domain.workspaceId,
        senderDomainId: domain.id,
      });
      identityPatch = {
        providerReference: root,
        providerRegion: this.email!.region,
        providerStatus: identity.identityVerified ? "verified" : "pending",
        verificationStatus: identity.verificationStatus,
        dkimStatus: identity.dkimStatus,
        mailFromStatus: identity.mailFromStatus,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "BYODKIM_PENDING";
      identityPatch.lastErrorCode = code;
      identityPatch.lastErrorMessage = error instanceof Error ? error.message : String(error);
      readinessReasons = [...readinessReasons, code === "EMAIL_BYODKIM_CONFIGURE_FAILED" ? "BYODKIM_PENDING" : code];
    }

    domain = await this.repo.updateProvisioningDomain({
      workspaceId: domain.workspaceId,
      domainId: domain.id,
      patch: {
        ...identityPatch,
        expectedRecords: [
          { type: ownership.type, host: ownership.name, value: ownership.values[0], required: true },
          { type: "CNAME", host: staticSendCustomerHost(root, this.cfg.staticSendDnsDomain), value: sendTarget, required: true },
          ...customerRecords.map(record => ({ type: "CNAME", host: record.host, value: record.target, required: true })),
          { type: "MX", host: mailFromRecords[0]!.name, value: mailFromRecords[0]!.values[0], required: true },
          { type: "TXT", host: mailFromRecords[1]!.name, value: mailFromRecords[1]!.values[0], required: true },
        ],
        mailFromDomain,
        lifecycleState: "WAITING_FOR_DNS",
        readinessStatus: "not_ready",
        readinessReasons,
        dnsStatus: "waiting_for_dns",
      },
    });

    if (this.repo.recordAudit) {
      await this.repo.recordAudit({
        workspaceId: domain.workspaceId,
        action: "domain.dkim_key.created",
        objectId: domain.id,
        riskLevel: "high",
        after: { routingId, selectors: STATIC_DKIM_SELECTORS, dkimMode: DKIM_MODE_BYODKIM },
      });
    }
    return domain;
  }

  private async verifySelector(
    workspaceId: string,
    domain: ProvisioningDomain,
    routingId: string,
    root: string,
    selector: StaticDkimSelector,
    publicKeyTxt: string,
  ) {
    const customerHost = staticDkimCustomerHost(root, selector);
    const brandedTarget = staticBrandedDkimSelectorHost(routingId, selector, this.cfg.staticDnsDomain);
    const cname = await this.dns!.checkCname({ name: customerHost, expectedTarget: brandedTarget });
    const velivooTarget = await this.staticDns!.checkDkimPublicKey({ routingId, selector, publicKeyTxt });
    const dkimDnsVerified = verified(cname) && velivooTarget.status === "verified";
    const verificationStatus = dkimDnsVerified
      ? "verified"
      : verified(cname) && velivooTarget.status === "pending"
        ? "verifying"
        : verified(cname) && velivooTarget.status === "mismatch"
          ? "mismatch"
          : cname.status;
    await this.repo.upsertDnsEvidence({
      workspaceId,
      senderDomainId: domain.id,
      purpose: selectorPurpose(selector),
      ownership: "customer",
      record: { type: "CNAME", name: customerHost, values: [brandedTarget], ttl: 300 },
      verificationStatus,
      customerActionRequired: true,
      observedValues: cname.observed,
      lastCheckedAt: cname.checkedAt,
    });
    return { dkimDnsVerified, velivooTargetReady: velivooTarget.status === "verified" };
  }

  private async advanceRotation(domain: ProvisioningDomain, routingId: string, root: string) {
    const record = this.asRecord(domain);
    const keys = this.rotation.readKeys(record);
    let patch: Record<string, unknown> = {};

    if (keys.rotationState === "grace_period" && this.rotation.graceExpired(keys.rotationGraceUntil)) {
      const retired = keys.standbySelector;
      if (this.staticDns!.removeDkimPublicKey) await this.staticDns!.removeDkimPublicKey({ routingId, selector: retired }).catch(() => undefined);
      patch = this.rotation.completeGracePeriod(record, retired);
      domain = await this.repo.updateProvisioningDomain({ workspaceId: domain.workspaceId, domainId: domain.id, patch });
      await this.staticDns!.publishDkimPublicKey({ routingId, selector: retired, publicKeyTxt: this.rotation.readKeys(this.asRecord(domain)).standbyPublicKey });
      return domain;
    }

    if (keys.rotationState === "standby_verifying") {
      const standbyCheck = await this.verifySelector(domain.workspaceId, domain, routingId, root, keys.standbySelector, keys.standbyPublicKey);
      if (this.rotation.canSwitch(keys.rotationState, standbyCheck.dkimDnsVerified, keys.rotationGraceUntil)) {
        await this.email!.ensureByodkimIdentity!({
          domain: root,
          selector: keys.standbySelector,
          privateKeyPem: this.rotation.standbyPrivateKey(record),
          existingReference: domain.providerReference,
          workspaceId: domain.workspaceId,
          senderDomainId: domain.id,
        });
        patch = this.rotation.afterSuccessfulSwitch(keys.activeSelector);
        domain = await this.repo.updateProvisioningDomain({ workspaceId: domain.workspaceId, domainId: domain.id, patch });
        if (this.repo.recordAudit) {
          await this.repo.recordAudit({
            workspaceId: domain.workspaceId,
            action: "domain.dkim_rotation.switched",
            objectId: domain.id,
            riskLevel: "high",
            after: { activeSelector: patch.dkimSelector, standbySelector: patch.dkimStandbySelector },
          });
        }
      }
    }

    return domain;
  }

  async create(workspaceId: string, rootInput: string) {
    const rootDomain = normalizeDomain(rootInput);
    const foreign = await this.repo.findProvisioningDomainOutsideWorkspace(workspaceId, rootDomain);
    if (foreign) throw new Error("DOMAIN_ALREADY_CLAIMED");
    const primary = await this.repo.findWorkspacePrimaryProvisioningDomain(workspaceId);
    let domain = await this.repo.findProvisioningDomainByRoot(workspaceId, rootDomain);
    if (primary && primary.id !== domain?.id) throw new Error("WORKSPACE_SENDING_DOMAIN_EXISTS");
    if (domain && domain.provisioningMode !== PROVISIONING_MODE_STATIC_BRANDED) throw new Error("DOMAIN_SETUP_MODE_CONFLICT");
    if (!domain) {
      domain = await this.repo.createBrandedDomain({
        workspaceId,
        rootDomain,
        delegatedSubdomain: staticSendCustomerHost(rootDomain, this.cfg.staticSendDnsDomain),
        region: this.cfg.sesRegion,
        provisioningVersion: V5_STATIC_BRANDED_KLAVIYO,
        provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
        setupMode: SETUP_MODE_STATIC_BRANDED,
      });
    }
    const lifecycle = String(domain.lifecycleState ?? "").toUpperCase();
    if (lifecycle === "DELETING") throw new Error("DOMAIN_PROVISIONING_IN_PROGRESS");
    if (lifecycle === "DELETED" || lifecycle === "FAILED") {
      domain = await this.repo.updateProvisioningDomain({
        workspaceId: domain.workspaceId,
        domainId: domain.id,
        patch: {
          lifecycleState: "CREATED",
          status: "pending",
          authenticationStatus: "pending",
          readinessStatus: "not_ready",
          readinessReasons: ["STATIC_DNS_PENDING"],
          provisioningVersion: V5_STATIC_BRANDED_KLAVIYO,
          provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
          setupMode: SETUP_MODE_STATIC_BRANDED,
          disconnectStatus: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }
    return this.withLock(domain, async () => this.enrichCustomerView(domain!, this.customerView(await this.prepareUnlocked(domain!))));
  }

  async recheck(workspaceId: string, domainId: string) {
    let domain = await this.repo.findProvisioningDomain(workspaceId, domainId);
    if (!domain) throw new Error("NOT_FOUND");
    if (TERMINAL.has(String(domain.lifecycleState ?? ""))) return this.enrichCustomerView(domain, this.customerView(domain));
    if (domain.provisioningMode !== PROVISIONING_MODE_STATIC_BRANDED) throw new Error("DOMAIN_STATIC_RECHECK_REQUIRED");

    return this.withLock(domain, async () => {
      const previous = domain!;
      const root = domain!.rootDomain ?? domain!.domain;
      if (this.repo.retireLegacyStaticDnsEvidence) await this.repo.retireLegacyStaticDnsEvidence(workspaceId, domain!.id);
      let routingId = this.asRecord(domain!).routingId as string;
      if (!routingId || !this.asRecord(domain!).dkimPrivateKeySecretRef) {
        domain = await this.prepareUnlocked(domain!);
        routingId = this.asRecord(domain!).routingId as string;
      } else if (domain!.provisioningVersion !== V5_STATIC_BRANDED_KLAVIYO) {
        domain = await this.prepareUnlocked(domain!);
        routingId = this.asRecord(domain!).routingId as string;
      } else {
        await this.publishVelivooInfrastructure(domain!, routingId);
      }

      domain = await this.advanceRotation(domain!, routingId, root);
      const keys = this.rotation.readKeys(this.asRecord(domain!));

      const ownership = staticRootOwnershipRecord(root, domain!.ownershipVerificationToken!);
      const ownershipTxt = await this.dns!.resolveTxt(ownership.name);
      const ownershipVerified = verified(ownershipTxt) && txtMatches(ownershipTxt.observed, ownership.values[0]!);
      await this.repo.upsertDnsEvidence({
        workspaceId,
        senderDomainId: domain!.id,
        purpose: "ownership",
        ownership: "customer",
        record: ownership,
        verificationStatus: ownershipVerified ? "verified" : ownershipTxt.status === "verified" ? "mismatch" : ownershipTxt.status,
        customerActionRequired: true,
        observedValues: ownershipTxt.observed,
        lastCheckedAt: ownershipTxt.checkedAt,
      });

      const sendHost = staticSendCustomerHost(root, this.cfg.staticSendDnsDomain);
      if (this.repo.purgeDnsEvidenceExceptName) await this.repo.purgeDnsEvidenceExceptName(workspaceId, domain!.id, "send_routing", sendHost);
      else if (this.repo.retireDnsEvidenceExceptName) await this.repo.retireDnsEvidenceExceptName(workspaceId, domain!.id, "send_routing", sendHost);
      const sendTarget = staticBrandedSendRoutingHost(routingId, this.cfg.staticSendDnsDomain);
      const sendCname = await this.dns!.checkCname({ name: sendHost, expectedTarget: sendTarget });
      const velivooSend = await this.staticDns!.checkSendRouting({ routingId, target: this.cfg.sendRoutingTarget });
      const sendRoutingVerified = verified(sendCname) && velivooSend.status === "verified";
      await this.repo.upsertDnsEvidence({
        workspaceId,
        senderDomainId: domain!.id,
        purpose: "send_routing",
        ownership: "customer",
        record: { type: "CNAME", name: sendHost, values: [sendTarget], ttl: 300 },
        verificationStatus: sendRoutingVerified ? "verified" : verified(sendCname) ? "verifying" : sendCname.status,
        customerActionRequired: false,
        observedValues: sendCname.observed,
        lastCheckedAt: sendCname.checkedAt,
      });

      const publicKeyFor = (selector: StaticDkimSelector) =>
        selector === keys.activeSelector ? keys.activePublicKey : keys.standbyPublicKey;
      const vm1 = await this.verifySelector(workspaceId, domain!, routingId, root, "vm1", publicKeyFor("vm1"));
      const vm2 = await this.verifySelector(workspaceId, domain!, routingId, root, "vm2", publicKeyFor("vm2"));
      const dkimDnsVerified = vm1.dkimDnsVerified && vm2.dkimDnsVerified;

      let identity: EmailDomainIdentityState | undefined;
      const privateKey = this.rotation.activePrivateKey(this.asRecord(domain!));
      const syncByodkim = async () => {
        await this.email!.ensureByodkimIdentity!({
          domain: root,
          selector: keys.activeSelector,
          privateKeyPem: privateKey,
          existingReference: root,
          workspaceId,
          senderDomainId: domain!.id,
        });
        identity = await this.email!.getIdentity({ domain: root, reference: root });
      };
      if (dkimDnsVerified) {
        await syncByodkim();
      } else {
        try {
          identity = await this.email!.getIdentity({ domain: root, reference: root });
        } catch {
          await syncByodkim();
        }
        if (identity && !byodkimIdentityReady(identity, keys.activeSelector)) {
          await syncByodkim();
        } else if (!identity) {
          await syncByodkim();
        }
      }
      if (!identity) {
        identity = await this.email!.getIdentity({ domain: root, reference: root });
      }

      const dmarc = await this.dns!.resolveTxt(`_dmarc.${root}`);
      const dmarcValue = dmarc.observed.find(validDmarc) ?? null;
      const dmarcAdvisory = staticDmarcAdvisoryRecord(root, this.cfg.dmarcPolicy);
      const dmarcExpected = dmarcValue ?? dmarcAdvisory.values[0]!;
      if (this.repo.retireDnsEvidenceExceptExpected) {
        await this.repo.retireDnsEvidenceExceptExpected(workspaceId, domain!.id, "dmarc_advisory", dmarcAdvisory.name, dmarcExpected);
      }
      await this.repo.upsertDnsEvidence({
        workspaceId,
        senderDomainId: domain!.id,
        purpose: "dmarc_advisory",
        ownership: "customer",
        record: { type: dmarcAdvisory.type, name: dmarcAdvisory.name, values: [dmarcExpected], ttl: dmarcAdvisory.ttl },
        verificationStatus: dmarcValue ? "verified" : this.cfg.dmarcRequired ? "pending" : "advisory",
        customerActionRequired: this.cfg.dmarcRequired,
        observedValues: dmarc.observed,
        lastCheckedAt: dmarc.checkedAt,
      });

      const sesIdentitySuccess = success(identity.verificationStatus);
      const dkimReady = byodkimIdentityReady(identity, keys.activeSelector) && dkimDnsVerified;
      const dnsReady = ownershipVerified && dkimDnsVerified;
      const mailFromDomain = staticBrandedMailFromDomain(root);
      const mailFromRecords = staticBrandedMailFromRecords(root, this.email!.region);
      await this.upsertMailFromEvidence(workspaceId, domain!, root, mailFromRecords);

      let mailFromDnsVerified = false;
      let mailFromSesSuccess = false;
      if (sesIdentitySuccess && dkimReady) {
        const mailFromChecks = await this.verifyMailFromDns(root, mailFromRecords);
        mailFromDnsVerified = mailFromChecks.mailFromDnsVerified;
        await this.email!.configureMailFrom({
          domain: root,
          mailFromDomain,
          behaviorOnMxFailure: mailFromDnsVerified ? "REJECT_MESSAGE" : "USE_DEFAULT_VALUE",
        });
        const mx = mailFromRecords.find(record => record.type === "MX")!;
        const spf = mailFromRecords.find(record => record.type === "TXT")!;
        await this.repo.upsertDnsEvidence({
          workspaceId,
          senderDomainId: domain!.id,
          purpose: "mail_from_mx",
          ownership: "customer",
          record: { type: mx.type, name: mx.name, values: mx.values, ttl: mx.ttl },
          verificationStatus: verified(mailFromChecks.mxCheck) ? "verified" : mailFromChecks.mxCheck.status === "verified" ? "mismatch" : mailFromChecks.mxCheck.status,
          customerActionRequired: true,
          observedValues: mailFromChecks.mxCheck.observed,
          lastCheckedAt: mailFromChecks.mxCheck.checkedAt,
        });
        await this.repo.upsertDnsEvidence({
          workspaceId,
          senderDomainId: domain!.id,
          purpose: "mail_from_spf",
          ownership: "customer",
          record: { type: spf.type, name: spf.name, values: spf.values, ttl: spf.ttl },
          verificationStatus: mailFromChecks.spfVerified ? "verified" : mailFromChecks.spfCheck.status === "verified" ? "mismatch" : mailFromChecks.spfCheck.status,
          customerActionRequired: true,
          observedValues: mailFromChecks.spfCheck.observed,
          lastCheckedAt: mailFromChecks.spfCheck.checkedAt,
        });
        identity = await this.email!.getIdentity({ domain: root, reference: root });
        mailFromSesSuccess = mailFromIdentityReady(identity);
      }

      const mailFromReady = mailFromDnsVerified && mailFromSesSuccess;

      const reasons: string[] = [];
      if (!ownershipVerified) reasons.push("OWNERSHIP_VERIFICATION_PENDING");
      if (!vm1.dkimDnsVerified) reasons.push("STATIC_DKIM_DNS_PENDING");
      if (!vm2.dkimDnsVerified) reasons.push("STATIC_DKIM_VM2_PENDING");
      if (keys.rotationState === "standby_verifying" || keys.rotationState === "switching") reasons.push("DKIM_ROTATION_PENDING");
      if (!sesIdentitySuccess) reasons.push(identity.verificationStatus === "FAILED" ? "SES_VERIFICATION_FAILED" : "SES_VERIFICATION_PENDING");
      if (!dkimReady) reasons.push(byodkimIdentityReady(identity, keys.activeSelector) ? "STATIC_DKIM_DNS_PENDING" : "BYODKIM_PENDING");
      if (sesIdentitySuccess && dkimReady && !mailFromReady) reasons.push("MAIL_FROM_PENDING");

      const mapping = await this.repo.upsertWorkspaceProviderConfig({ workspaceId, provider: this.email!.provider, region: this.email!.region });
      const configuration = await this.email!.ensureWorkspaceConfigurationSet({
        workspaceId,
        existingName: mapping.configurationSetName,
        snsTopicArn: this.cfg.snsTopicArn,
      });
      await this.repo.updateWorkspaceProviderConfigurationSet(workspaceId, this.email!.provider, configuration.name);
      if (this.email!.associateConfigurationSet) {
        await this.email!.associateConfigurationSet({ domain: root, configurationSetName: configuration.name });
      }
      const operational = await this.repo.workspaceOperationalReadiness(workspaceId);
      if (!configuration.feedbackReady || !operational.feedbackReady) reasons.push("FEEDBACK_NOT_READY");
      if (!operational.unsubscribeReady) reasons.push("UNSUBSCRIBE_NOT_READY");
      if (!operational.businessReady) reasons.push("BUSINESS_INFORMATION_MISSING");
      if (operational.held) reasons.push("WORKSPACE_HELD");
      if (this.cfg.dmarcRequired && !dmarcValue) reasons.push("DMARC_WARNING");

      const authenticationVerified =
        dnsReady &&
        dkimReady &&
        sesIdentitySuccess &&
        mailFromReady &&
        keys.rotationState !== "standby_verifying" &&
        keys.rotationState !== "switching";

      const productionReady =
        authenticationVerified &&
        configuration.feedbackReady &&
        operational.feedbackReady &&
        operational.unsubscribeReady &&
        operational.businessReady &&
        !operational.held &&
        (!this.cfg.dmarcRequired || Boolean(dmarcValue));
      const routeActive = authenticationVerified;

      const lifecycle = productionReady
        ? "READY"
        : staticLifecycleState({
            ownershipVerified,
            dkimDnsVerified,
            sesIdentitySuccess,
            dkimSuccess: dkimReady,
            mailFromVerified: mailFromReady ? true : sesIdentitySuccess && dkimReady ? false : undefined,
            ready: productionReady,
            previous: previous.lifecycleState,
          });

      const trackingHostname = sendRoutingVerified ? infraDomain(root) : undefined;
      await this.repo.upsertDeliveryRoute({
        workspaceId,
        senderDomainId: domain!.id,
        provider: this.email!.provider,
        providerRegion: this.email!.region,
        providerIdentityReference: root,
        configurationSetName: configuration.name,
        mailFromDomain,
        trackingMode: sendRoutingVerified ? "branded" : "platform",
        trackingHostname,
        status: routeActive ? "active" : "held",
        holdReason: productionReady ? null : routeActive ? "PRODUCTION_GATES_PENDING" : "DOMAIN_NOT_READY",
      });

      if (this.repo.purgeDnsEvidenceDuplicatesForPurposes) {
        await this.repo.purgeDnsEvidenceDuplicatesForPurposes(
          workspaceId,
          domain!.id,
          [...staticProductionDnsPurposes(this.cfg.dmarcRequired)],
        );
      }

      domain = await this.repo.updateProvisioningDomain({
        workspaceId,
        domainId: domain!.id,
        patch: {
          providerReference: root,
          providerRegion: this.email!.region,
          providerStatus: identity.identityVerified ? "verified" : "pending",
          verificationStatus: identity.verificationStatus,
          dkimStatus: identity.dkimStatus,
          mailFromStatus: identity.mailFromStatus,
          mailFromDomain,
          authenticationStatus: authenticationVerified ? "verified" : "pending",
          status: routeActive ? "verified" : "pending",
          lifecycleState: lifecycle,
          readinessStatus: productionReady ? "ready" : routeActive ? "warning" : "not_ready",
          readinessReasons: [...new Set(reasons)],
          ownershipVerificationStatus: ownershipVerified ? "verified" : "pending",
          ownershipVerifiedAt: ownershipVerified ? new Date() : null,
          dnsStatus: routeActive ? "verified" : dnsReady ? "verifying" : "waiting_for_dns",
          trackingDomain: trackingHostname ?? null,
          dmarcStatus: dmarcValue ? "verified" : this.cfg.dmarcRequired ? "pending" : "warning",
          dmarcObservation: {
            status: dmarcValue ? "observed" : dmarc.status,
            value: dmarcValue,
            recommended: dmarcValue ? null : this.cfg.dmarcPolicy,
            observedValues: dmarc.observed,
            checkedAt: dmarc.checkedAt.toISOString(),
            dkimAlignment: "byodkim",
            spfAlignment: mailFromReady ? "mail_from" : "default",
          },
          delegatedSubdomain: staticSendCustomerHost(root, this.cfg.staticSendDnsDomain),
          lastCheckedAt: new Date(),
          verifiedAt: routeActive ? new Date() : null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      return this.enrichCustomerView(domain, this.customerView(domain));
    });
  }

  async initiateDkimRotation(workspaceId: string, domainId: string) {
    let domain = await this.repo.findProvisioningDomain(workspaceId, domainId);
    if (!domain) throw new Error("NOT_FOUND");
    if (domain.provisioningMode !== PROVISIONING_MODE_STATIC_BRANDED) throw new Error("DOMAIN_STATIC_ROTATION_REQUIRED");
    return this.withLock(domain, async () => {
      const routingId = this.asRecord(domain!).routingId as string;
      const patch = this.rotation.initiateRotation(this.asRecord(domain!));
      domain = await this.repo.updateProvisioningDomain({ workspaceId, domainId, patch });
      await this.staticDns!.publishDkimPublicKey({
        routingId,
        selector: this.rotation.readKeys(this.asRecord(domain)).standbySelector,
        publicKeyTxt: String(patch.dkimStandbyPublicKey),
      });
      return this.recheck(workspaceId, domainId);
    });
  }

  async retryProvisioning(workspaceId: string, domainId: string) {
    const domain = await this.repo.findProvisioningDomain(workspaceId, domainId);
    if (!domain) throw new Error("NOT_FOUND");
    if (domain.provisioningMode !== PROVISIONING_MODE_STATIC_BRANDED) throw new Error("DOMAIN_STATIC_RETRY_REQUIRED");
    const lifecycle = String(domain.lifecycleState ?? "").toUpperCase();
    if (lifecycle === "CREATED" || !this.asRecord(domain).routingId || !this.asRecord(domain).dkimPrivateKeySecretRef || domain.provisioningVersion !== V5_STATIC_BRANDED_KLAVIYO) {
      return this.withLock(domain, async () => this.enrichCustomerView(domain, this.customerView(await this.prepareUnlocked(domain))));
    }
    return this.recheck(workspaceId, domainId);
  }

  customerView(domain: ProvisioningDomain) {
    const root = domain.rootDomain ?? domain.domain;
    return {
      id: domain.id,
      workspaceId: domain.workspaceId,
      domain: root,
      rootDomain: root,
      infraDomain: domain.delegatedSubdomain ?? infraDomain(root),
      sendingDomain: root,
      mailFromDomain: domain.mailFromDomain ?? staticBrandedMailFromDomain(root),
      setupMode: this.asRecord(domain).setupMode ?? SETUP_MODE_STATIC_BRANDED,
      routingId: this.asRecord(domain).routingId ?? null,
      dkimRotationState: this.asRecord(domain).dkimRotationState ?? "stable",
      activeDkimSelector: this.asRecord(domain).dkimSelector ?? "vm1",
      provisioningMode: domain.provisioningMode,
      provisioningVersion: domain.provisioningVersion,
      lifecycleState: domain.lifecycleState,
      authenticationStatus: domain.authenticationStatus,
      readinessStatus: domain.readinessStatus,
      readinessReasons: Array.isArray(domain.readinessReasons) ? domain.readinessReasons : [],
      lastCheckedAt: this.asRecord(domain).lastCheckedAt ?? null,
      checks: {
        delegation: "not_applicable",
        soa: "not_applicable",
        ownership: this.asRecord(domain).ownershipVerificationStatus ?? "pending",
        sendRouting: this.asRecord(domain).dnsStatus ?? "pending",
        sesIdentity: domain.verificationStatus ?? "pending",
        dkim: domain.dkimStatus ?? "pending",
        mailFrom: success(domain.mailFromStatus) ? "verified" : domain.mailFromStatus ?? "pending",
        dmarc: (domain.dmarcObservation as any)?.status ?? "not_observed",
        velivooDns: this.asRecord(domain).dnsStatus ?? "pending",
      },
      nextAction: Array.isArray(domain.readinessReasons) && domain.readinessReasons.length ? domain.readinessReasons[0] : domain.readinessStatus === "ready" ? "Domain is ready." : "Add the DNS records shown below, then recheck.",
      customerRecords: [] as any[],
      staticDnsDomain: this.cfg.staticDnsDomain,
      staticSendDnsDomain: this.cfg.staticSendDnsDomain,
    };
  }

  async enrichCustomerView(domain: ProvisioningDomain, base: ReturnType<StaticBrandedProvisioner["customerView"]>) {
    const root = domain.rootDomain ?? domain.domain;
    const records = await this.repo.listDnsEvidence(domain.workspaceId, domain.id, false);
    const productionEvidence = records.filter(
      (record) =>
        (staticProductionDnsPurposes(this.cfg.dmarcRequired) as readonly string[]).includes(record.purpose) &&
        !customerDnsUsesProviderBranding({ name: record.name, value: record.expectedValue, purpose: record.purpose }),
    );
    const customerRecords = buildStaticProductionCustomerRecords({
      rootDomain: root,
      dmarcRequired: this.cfg.dmarcRequired,
      evidence: productionEvidence.map((record) => ({
        purpose: record.purpose,
        recordType: record.recordType,
        name: record.name,
        expectedValue: record.expectedValue,
        verificationStatus: record.verificationStatus,
        observedValues: record.observedValues,
        lastCheckedAt: record.lastCheckedAt,
      })),
    });
    return {
      ...base,
      productionDnsRecordCount: staticProductionDnsRecordCount(this.cfg.dmarcRequired),
      customerRecords,
      dmarcAdvisory: productionEvidence.find((record) => record.purpose === "dmarc_advisory") ?? null,
    };
  }

  async archive(workspaceId: string, domainId: string) {
    const domain = await this.repo.findProvisioningDomain(workspaceId, domainId);
    if (!domain) throw new Error("NOT_FOUND");
    await this.repo.holdDomainRoute(workspaceId, domainId, "DOMAIN_DISCONNECTING");
    if (await this.repo.hasActiveDeliveryAttempts(workspaceId, domainId)) throw new Error("DOMAIN_HAS_ACTIVE_SENDS");
    await this.repo.updateProvisioningDomain({ workspaceId, domainId, patch: { disconnectStatus: "in_progress", lifecycleState: "DELETING" } });
    const root = domain.rootDomain ?? domain.domain;
    if (this.email && domain.providerReference) await this.email.removeIdentity({ domain: root, reference: domain.providerReference });
    const routingId = this.asRecord(domain).routingId as string | undefined;
    if (routingId && this.staticDns) {
      for (const selector of STATIC_DKIM_SELECTORS) {
        await this.staticDns.removeDkimPublicKey?.({ routingId, selector }).catch(() => undefined);
      }
      await this.staticDns.removeSendRouting?.({ routingId }).catch(() => undefined);
    }
    await this.repo.archiveProvisioningDomain(workspaceId, domainId, new Date());
    return { ok: true, archived: true };
  }
}

function selectorPurpose(selector: StaticDkimSelector) {
  return selector === "vm1" ? "dkim_vm1" : "dkim_vm2";
}
