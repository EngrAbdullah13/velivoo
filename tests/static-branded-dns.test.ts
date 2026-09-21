import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVISIONING_MODE_STATIC_BRANDED,
  SETUP_MODE_STATIC_BRANDED,
  V5_STATIC_BRANDED_KLAVIYO,
  customerDnsUsesProviderBranding,
  staticBrandedDkimApex,
  staticBrandedDkimHost,
  staticLifecycleState,
  velivooOwnershipValue,
} from "../packages/domain/src/phase1/branded-domain.js";
import {
  STATIC_DKIM_SELECTOR_PRIMARY,
  STATIC_DKIM_SELECTOR_STANDBY,
  staticBrandedDkimSelectorHost,
  staticBrandedMailFromDomain,
  staticBrandedMailFromRecords,
  staticBrandedSendRoutingHost,
  staticBrandedZoneApex,
  staticDkimCustomerHost,
  staticRootOwnershipRecord,
  staticSendCustomerHost,
} from "../packages/domain/src/phase1/static-branded-dns.js";
import {
  afterSelectorSwitch,
  canSwitchToStandby,
  normalizeStaticSelectors,
} from "../packages/domain/src/phase1/dkim-rotation.js";
import {
  containsPrivateKeyMaterial,
  dkimPrivateKeyForSes,
  dkimPublicKeyDnsTxt,
  encryptDkimPrivateKey,
  decryptDkimPrivateKey,
  generateDkimKeyPair,
  generateRoutingId,
  hashOwnershipToken,
} from "../packages/domain/src/phase1/dkim-key.js";
import { normalizeTxtContent, route53TxtValues } from "../packages/domain/src/phase1/dns.js";
import { InMemoryStaticDnsInfrastructure } from "../packages/provider-email/src/route53/route53-static-dns-infrastructure.js";
import { StaticBrandedProvisioner } from "../packages/application/src/phase1/static-branded-provisioner.js";
import { StaticDkimRotationService } from "../packages/application/src/phase1/static-dkim-rotation-service.js";

test("Klaviyo-style static DNS helpers generate Velivoo-branded hostnames", () => {
  const routingId = "d_8d42a932";
  assert.equal(staticBrandedDkimSelectorHost(routingId, "vm1", "velivoo.com"), "vm1.d_8d42a932.dkim.velivoo.com");
  assert.equal(staticBrandedDkimSelectorHost("d_3c1bd50c", "vm2", "dkim.velivoo.com"), "vm2.d_3c1bd50c.dkim.velivoo.com");
  assert.equal(staticBrandedDkimHost(routingId, "dkim.velivoo.com"), "vm1.d_8d42a932.dkim.velivoo.com");
  assert.equal(staticBrandedDkimApex("dkim.velivoo.com"), "velivoo.com");
  assert.equal(staticBrandedZoneApex("dkim.velivoo.com"), "velivoo.com");
  assert.equal(staticBrandedSendRoutingHost(routingId, "send.velivoo.com"), "d_8d42a932.send.velivoo.com");
  assert.equal(staticSendCustomerHost("example.com"), "send.example.com");
  assert.equal(staticSendCustomerHost("velivoo.com", "send.velivoo.com"), "links.velivoo.com");
  assert.equal(staticSendCustomerHost("example.com", "send.velivoo.com"), "send.example.com");
  assert.equal(staticBrandedMailFromDomain("example.com"), "bounce.example.com");
  assert.deepEqual(staticBrandedMailFromRecords("example.com", "eu-north-1"), [
    { type: "MX", name: "bounce.example.com", values: ["10 feedback-smtp.eu-north-1.amazonses.com"], ttl: 300, priority: 10, exchange: "feedback-smtp.eu-north-1.amazonses.com" },
    { type: "TXT", name: "bounce.example.com", values: ["v=spf1 include:amazonses.com ~all"], ttl: 300 },
  ]);
  assert.equal(staticDkimCustomerHost("example.com", "vm1"), "vm1._domainkey.example.com");
  assert.equal(staticDkimCustomerHost("example.com", "vm2"), "vm2._domainkey.example.com");
  assert.equal(staticRootOwnershipRecord("example.com", "abc123").name, "example.com");
  assert.match(velivooOwnershipValue("abc123"), /^velivoo-site-verification=abc123$/);
  assert.match(generateRoutingId(), /^d_[a-f0-9]{8}$/);
  assert.equal(customerDnsUsesProviderBranding({ name: "_amazonses.example.com", value: "token" }), true);
  assert.equal(customerDnsUsesProviderBranding({ name: "example.com", value: velivooOwnershipValue("abc") }), false);
});

test("DKIM rotation domain rules normalize selectors and gate switching", () => {
  assert.deepEqual(normalizeStaticSelectors({ activeSelector: "vm1", standbySelector: "vm2" }), {
    activeSelector: STATIC_DKIM_SELECTOR_PRIMARY,
    standbySelector: STATIC_DKIM_SELECTOR_STANDBY,
  });
  const switched = afterSelectorSwitch(STATIC_DKIM_SELECTOR_PRIMARY);
  assert.equal(switched.activeSelector, STATIC_DKIM_SELECTOR_STANDBY);
  assert.equal(switched.rotationState, "grace_period");
  assert.equal(canSwitchToStandby({ rotationState: "standby_verifying", standbyVerified: true }), true);
  assert.equal(canSwitchToStandby({ rotationState: "standby_verifying", standbyVerified: false }), false);
});

test("Route53 TXT values split long DKIM records", () => {
  const pair = generateDkimKeyPair();
  const txt = dkimPublicKeyDnsTxt(pair.publicKey);
  assert.ok(txt.length > 255);
  const values = route53TxtValues(txt);
  assert.ok(values.length >= 2);
  assert.ok(values.every(value => value.length <= 257));
  assert.equal(normalizeTxtContent(values), txt);
});

test("normalizeTxtContent reorders split DKIM TXT chunks before joining", () => {
  const expected = "v=DKIM1; k=rsa; p=abc123";
  assert.equal(normalizeTxtContent(["abc123", "v=DKIM1; k=rsa; p="]), expected);
});

test("DKIM key vault encrypts and decrypts private keys", () => {
  const pair = generateDkimKeyPair();
  const secret = "test-local-secret-not-for-production";
  const encrypted = encryptDkimPrivateKey(pair.privateKey, secret);
  assert.notEqual(encrypted, pair.privateKey);
  assert.equal(decryptDkimPrivateKey(encrypted, secret), pair.privateKey);
  assert.match(dkimPublicKeyDnsTxt(pair.publicKey), /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]+$/);
  assert.match(dkimPrivateKeyForSes(pair.privateKey), /^[a-zA-Z0-9+/]+={0,2}$/);
  assert.equal(containsPrivateKeyMaterial(pair.privateKey), true);
});

test("static branded provisioner creates Klaviyo-style customer records without provider branding", async () => {
  const staticDnsDomain = "dkim.velivoo.com";
  const staticSendDomain = "send.velivoo.com";
  const routingTarget = "track.velivoo.com";
  const staticDns = new InMemoryStaticDnsInfrastructure(staticDnsDomain, staticSendDomain, routingTarget);
  const mailFromRecords = staticBrandedMailFromRecords("example.com", "us-east-1");
  const dns = {
    provider: "memory",
    resolveTxt: async (name: string) => ({
      status: name === "example.com" || name.startsWith("_dmarc.") || name === "bounce.example.com" ? "verified" as const : "pending" as const,
      expected: [],
      observed: name === "example.com" ? ['"velivoo-site-verification=token123"'] : name.startsWith("_dmarc.") ? ['"v=DMARC1; p=none"'] : name === "bounce.example.com" ? [mailFromRecords[1]!.values[0]!] : [],
      checkedAt: new Date(),
    }),
    checkCname: async ({ name }: { name: string }) => ({
      status: name.includes("send.example.com") || name.includes("_domainkey.example.com") ? "verified" as const : "pending" as const,
      expected: [],
      observed: [],
      checkedAt: new Date(),
    }),
    checkMx: async ({ name }: { name: string }) => ({
      status: name === "bounce.example.com" ? "verified" as const : "pending" as const,
      expected: mailFromRecords[0]!.values,
      observed: name === "bounce.example.com" ? mailFromRecords[0]!.values : [],
      checkedAt: new Date(),
    }),
  };
  let mailFromConfigured = false;
  const email = {
    provider: "ses",
    region: "us-east-1",
    ensureByodkimIdentity: async () => ({
      reference: "example.com",
      identityVerified: true,
      verifiedForSending: true,
      verificationStatus: "SUCCESS",
      dkimStatus: "SUCCESS",
      mailFromStatus: mailFromConfigured ? "SUCCESS" : "PENDING",
      dkimSigningOrigin: "EXTERNAL",
      dkimSigningSelector: "vm1",
      dkimTokens: [],
      dkimSigningHostedZone: null,
      dkimRecords: [],
    }),
    getIdentity: async () => ({
      reference: "example.com",
      identityVerified: true,
      verifiedForSending: true,
      verificationStatus: "SUCCESS",
      dkimStatus: "SUCCESS",
      mailFromStatus: mailFromConfigured ? "SUCCESS" : "PENDING",
      dkimSigningOrigin: "EXTERNAL",
      dkimSigningSelector: "vm1",
      dkimTokens: [],
      dkimSigningHostedZone: null,
      dkimRecords: [],
    }),
    configureMailFrom: async () => {
      mailFromConfigured = true;
      return mailFromRecords;
    },
    ensureWorkspaceConfigurationSet: async () => ({ name: "workspace-test", feedbackReady: true }),
    associateConfigurationSet: async () => undefined,
  };
  const secret = "local-test-secret";
  const updates: Record<string, unknown>[] = [];
  let storedDomain: any = null;
  const repo: any = {
    findProvisioningDomainOutsideWorkspace: async () => null,
    findWorkspacePrimaryProvisioningDomain: async () => null,
    findProvisioningDomainByRoot: async () => null,
    createBrandedDomain: async (input: any) => ({
      id: "domain-1",
      workspaceId: input.workspaceId,
      domain: input.rootDomain,
      rootDomain: input.rootDomain,
      delegatedSubdomain: input.delegatedSubdomain,
      provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
      provisioningVersion: input.provisioningVersion,
      lifecycleState: "CREATED",
      authenticationStatus: "pending",
      readinessStatus: "not_ready",
      readinessReasons: ["STATIC_DNS_PENDING"],
    }),
    claimDomainProvisioning: async () => true,
    releaseDomainProvisioning: async () => undefined,
    updateProvisioningDomain: async (input: any) => {
      updates.push(input.patch);
      storedDomain = {
        id: "domain-1",
        workspaceId: input.workspaceId,
        domain: "example.com",
        rootDomain: "example.com",
        delegatedSubdomain: "send.example.com",
        provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
        provisioningVersion: V5_STATIC_BRANDED_KLAVIYO,
        lifecycleState: input.patch.lifecycleState ?? "WAITING_FOR_DNS",
        authenticationStatus: "pending",
        readinessStatus: "not_ready",
        readinessReasons: input.patch.readinessReasons ?? [],
        routingId: input.patch.routingId ?? storedDomain?.routingId ?? "d_test1234",
        ...storedDomain,
        ...input.patch,
      };
      return storedDomain;
    },
    findProvisioningDomain: async () => storedDomain,
    retireCustomerDnsEvidence: async () => undefined,
    upsertDnsEvidence: async () => undefined,
    listDnsEvidence: async () => [
      { purpose: "ownership", ownership: "customer", recordType: "TXT", name: "example.com", expectedValue: velivooOwnershipValue("token123"), verificationStatus: "pending", customerActionRequired: true },
      { purpose: "send_routing", ownership: "customer", recordType: "CNAME", name: "send.example.com", expectedValue: "d_test1234.send.velivoo.com", verificationStatus: "pending", customerActionRequired: true },
      { purpose: "dkim_vm1", ownership: "customer", recordType: "CNAME", name: "vm1._domainkey.example.com", expectedValue: "vm1.d_test1234.dkim.velivoo.com", verificationStatus: "pending", customerActionRequired: true },
      { purpose: "dkim_vm2", ownership: "customer", recordType: "CNAME", name: "vm2._domainkey.example.com", expectedValue: "vm2.d_test1234.dkim.velivoo.com", verificationStatus: "pending", customerActionRequired: true },
    ],
    scheduleDomainVerification: async () => undefined,
    recordAudit: async () => undefined,
    upsertWorkspaceProviderConfig: async () => ({}),
    updateWorkspaceProviderConfigurationSet: async () => undefined,
    workspaceOperationalReadiness: async () => ({ businessReady: true, feedbackReady: true, unsubscribeReady: true, held: false }),
    upsertDeliveryRoute: async () => ({ id: "route-1", status: "active" }),
  };

  const service = new StaticBrandedProvisioner(repo, dns as any, staticDns, email as any, {
    sesRegion: "us-east-1",
    staticDnsDomain,
    staticSendDnsDomain: staticSendDomain,
    sendRoutingTarget: routingTarget,
    dmarcPolicy: "v=DMARC1; p=none",
    dmarcRequired: false,
    dkimKeyEncryptionSecret: secret,
  });

  const created = await service.create("ws-1", "example.com");
  assert.equal(created.setupMode, SETUP_MODE_STATIC_BRANDED);
  assert.equal(created.provisioningVersion, V5_STATIC_BRANDED_KLAVIYO);
  assert.equal(created.customerRecords.length, 5);
  assert.equal(created.productionDnsRecordCount, 5);
  assert.equal(created.mailFromDomain, "bounce.example.com");
  assert.ok(created.customerRecords.filter((record: any) => !["mail_from_mx", "mail_from_spf"].includes(String(record.purpose))).every((record: any) => !String(record.value).includes("amazonses.com")));
  assert.ok(created.customerRecords.some((record: any) => record.name === "example.com"));
  assert.ok(!created.customerRecords.some((record: any) => record.purpose === "send_routing"));
  assert.ok(created.customerRecords.some((record: any) => record.name === "vm1._domainkey.example.com"));
  assert.ok(created.customerRecords.some((record: any) => record.name === "vm2._domainkey.example.com"));
  assert.ok(!containsPrivateKeyMaterial(JSON.stringify(created)));
  assert.ok(updates.some(patch => patch.dkimPrivateKeySecretRef && patch.dkimStandbyPrivateKeySecretRef));
  assert.ok(updates.some(patch => patch.ownershipVerificationTokenHash === hashOwnershipToken(String(patch.ownershipVerificationToken))));

  storedDomain.routingId = "d_test1234";
  storedDomain.ownershipVerificationToken = "token123";
  storedDomain.dkimSelector = "vm1";
  storedDomain.dkimStandbySelector = "vm2";
  storedDomain.dkimRotationState = "stable";
  storedDomain.dkimPublicKey = updates.find(patch => patch.dkimPublicKey)?.dkimPublicKey;
  storedDomain.dkimStandbyPublicKey = updates.find(patch => patch.dkimStandbyPublicKey)?.dkimStandbyPublicKey;
  storedDomain.dkimPrivateKeySecretRef = updates.find(patch => patch.dkimPrivateKeySecretRef)?.dkimPrivateKeySecretRef;
  storedDomain.dkimStandbyPrivateKeySecretRef = updates.find(patch => patch.dkimStandbyPrivateKeySecretRef)?.dkimStandbyPrivateKeySecretRef;
  staticDns.seedDkim("d_test1234", "vm1", String(storedDomain.dkimPublicKey));
  staticDns.seedDkim("d_test1234", "vm2", String(storedDomain.dkimStandbyPublicKey));
  staticDns.seedSendRouting("d_test1234", routingTarget);

  const rechecked = await service.recheck("ws-1", "domain-1");
  assert.equal(rechecked.lifecycleState, "READY");
  assert.equal(rechecked.authenticationStatus, "verified");
  assert.equal(rechecked.checks.mailFrom, "verified");
});

test("static branded recheck marks authentication verified before operational readiness", async () => {
  const staticDnsDomain = "dkim.velivoo.com";
  const staticSendDomain = "send.velivoo.com";
  const routingTarget = "track.velivoo.com";
  const staticDns = new InMemoryStaticDnsInfrastructure(staticDnsDomain, staticSendDomain, routingTarget);
  const mailFromRecords = staticBrandedMailFromRecords("example.com", "us-east-1");
  const dns = {
    provider: "memory",
    resolveTxt: async (name: string) => ({
      status: name === "example.com" || name.startsWith("_dmarc.") || name === "bounce.example.com" ? "verified" as const : "pending" as const,
      expected: [],
      observed: name === "example.com" ? ['"velivoo-site-verification=token123"'] : name.startsWith("_dmarc.") ? ['"v=DMARC1; p=none"'] : name === "bounce.example.com" ? [mailFromRecords[1]!.values[0]!] : [],
      checkedAt: new Date(),
    }),
    checkCname: async ({ name }: { name: string }) => ({
      status: name.includes("send.example.com") || name.includes("_domainkey.example.com") ? "verified" as const : "pending" as const,
      expected: [],
      observed: [],
      checkedAt: new Date(),
    }),
    checkMx: async ({ name }: { name: string }) => ({
      status: name === "bounce.example.com" ? "verified" as const : "pending" as const,
      expected: mailFromRecords[0]!.values,
      observed: name === "bounce.example.com" ? mailFromRecords[0]!.values : [],
      checkedAt: new Date(),
    }),
  };
  let mailFromConfigured = false;
  const email = {
    provider: "ses",
    region: "us-east-1",
    ensureByodkimIdentity: async () => ({
      reference: "example.com",
      identityVerified: true,
      verifiedForSending: true,
      verificationStatus: "SUCCESS",
      dkimStatus: "SUCCESS",
      mailFromStatus: mailFromConfigured ? "SUCCESS" : "PENDING",
      dkimSigningOrigin: "EXTERNAL",
      dkimSigningSelector: "vm1",
      dkimTokens: [],
      dkimSigningHostedZone: null,
      dkimRecords: [],
    }),
    getIdentity: async () => ({
      reference: "example.com",
      identityVerified: true,
      verifiedForSending: true,
      verificationStatus: "SUCCESS",
      dkimStatus: "SUCCESS",
      mailFromStatus: mailFromConfigured ? "SUCCESS" : "PENDING",
      dkimSigningOrigin: "EXTERNAL",
      dkimSigningSelector: "vm1",
      dkimTokens: [],
      dkimSigningHostedZone: null,
      dkimRecords: [],
    }),
    configureMailFrom: async () => {
      mailFromConfigured = true;
      return mailFromRecords;
    },
    ensureWorkspaceConfigurationSet: async () => ({ name: "workspace-test", feedbackReady: false }),
    associateConfigurationSet: async () => undefined,
  };
  let storedDomain: any = {
    id: "domain-1",
    workspaceId: "ws-1",
    domain: "example.com",
    rootDomain: "example.com",
    delegatedSubdomain: "send.example.com",
    provisioningMode: PROVISIONING_MODE_STATIC_BRANDED,
    provisioningVersion: V5_STATIC_BRANDED_KLAVIYO,
    lifecycleState: "WAITING_FOR_DNS",
    authenticationStatus: "pending",
    readinessStatus: "not_ready",
    routingId: "d_test1234",
    ownershipVerificationToken: "token123",
    dkimSelector: "vm1",
    dkimStandbySelector: "vm2",
    dkimRotationState: "stable",
    dkimPublicKey: dkimPublicKeyDnsTxt(generateDkimKeyPair().publicKey),
    dkimStandbyPublicKey: dkimPublicKeyDnsTxt(generateDkimKeyPair().publicKey),
    dkimPrivateKeySecretRef: "ref-a",
    dkimStandbyPrivateKeySecretRef: "ref-b",
  };
  staticDns.seedDkim("d_test1234", "vm1", String(storedDomain.dkimPublicKey));
  staticDns.seedDkim("d_test1234", "vm2", String(storedDomain.dkimStandbyPublicKey));
  staticDns.seedSendRouting("d_test1234", routingTarget);
  const repo: any = {
    findProvisioningDomain: async () => storedDomain,
    claimDomainProvisioning: async () => true,
    releaseDomainProvisioning: async () => undefined,
    updateProvisioningDomain: async (input: any) => {
      storedDomain = { ...storedDomain, ...input.patch };
      return storedDomain;
    },
    retireLegacyStaticDnsEvidence: async () => undefined,
    upsertDnsEvidence: async () => undefined,
    listDnsEvidence: async () => [
      { purpose: "ownership", ownership: "customer", recordType: "TXT", name: "example.com", expectedValue: velivooOwnershipValue("token123"), verificationStatus: "verified", customerActionRequired: true },
      { purpose: "send_routing", ownership: "customer", recordType: "CNAME", name: "send.example.com", expectedValue: "d_test1234.send.velivoo.com", verificationStatus: "verified", customerActionRequired: true },
      { purpose: "dkim_vm1", ownership: "customer", recordType: "CNAME", name: "vm1._domainkey.example.com", expectedValue: "vm1.d_test1234.dkim.velivoo.com", verificationStatus: "verified", customerActionRequired: true },
      { purpose: "dkim_vm2", ownership: "customer", recordType: "CNAME", name: "vm2._domainkey.example.com", expectedValue: "vm2.d_test1234.dkim.velivoo.com", verificationStatus: "verified", customerActionRequired: true },
    ],
    upsertWorkspaceProviderConfig: async () => ({}),
    updateWorkspaceProviderConfigurationSet: async () => undefined,
    workspaceOperationalReadiness: async () => ({ businessReady: true, feedbackReady: false, unsubscribeReady: false, held: false }),
    upsertDeliveryRoute: async () => ({ id: "route-1", status: "held" }),
  };
  const service = new StaticBrandedProvisioner(repo, dns as any, staticDns, email as any, {
    sesRegion: "us-east-1",
    staticDnsDomain,
    staticSendDnsDomain: staticSendDomain,
    sendRoutingTarget: routingTarget,
    dmarcPolicy: "v=DMARC1; p=none",
    dmarcRequired: false,
    dkimKeyEncryptionSecret: "local-test-secret",
  });

  const rechecked = await service.recheck("ws-1", "domain-1");
  assert.equal(rechecked.authenticationStatus, "verified");
  assert.equal(rechecked.readinessStatus, "not_ready");
  assert.ok(rechecked.readinessReasons?.includes("FEEDBACK_NOT_READY"));
  assert.equal(rechecked.lifecycleState, "authentication_verifying");
});

test("rotation service can initiate standby key replacement", () => {
  const rotation = new StaticDkimRotationService("local-test-secret");
  const pair = generateDkimKeyPair();
  const domain = {
    dkimSelector: "vm1",
    dkimStandbySelector: "vm2",
    dkimRotationState: "stable",
    dkimPublicKey: dkimPublicKeyDnsTxt(pair.publicKey),
    dkimPrivateKeySecretRef: encryptDkimPrivateKey(pair.privateKey, "local-test-secret"),
    dkimStandbyPublicKey: "v=DKIM1; k=rsa; p=old",
    dkimStandbyPrivateKeySecretRef: encryptDkimPrivateKey(generateDkimKeyPair().privateKey, "local-test-secret"),
  };
  const patch = rotation.initiateRotation(domain);
  assert.equal(patch.dkimRotationState, "standby_verifying");
  assert.notEqual(patch.dkimStandbyPublicKey, domain.dkimStandbyPublicKey);
});

test("static lifecycle skips delegation states", () => {
  assert.equal(
    staticLifecycleState({ ownershipVerified: false, sendRoutingVerified: false, dkimDnsVerified: false, sesIdentitySuccess: false, dkimSuccess: false, ready: false }),
    "WAITING_FOR_DNS",
  );
  assert.equal(
    staticLifecycleState({ ownershipVerified: true, sendRoutingVerified: true, dkimDnsVerified: true, sesIdentitySuccess: false, dkimSuccess: false, ready: false }),
    "SES_VERIFYING",
  );
  assert.equal(
    staticLifecycleState({ ownershipVerified: true, dkimDnsVerified: true, sesIdentitySuccess: true, dkimSuccess: true, ready: true }),
    "READY",
  );
  assert.equal(
    staticLifecycleState({ ownershipVerified: true, sendRoutingVerified: true, dkimDnsVerified: true, sesIdentitySuccess: true, dkimSuccess: true, mailFromVerified: false, ready: false }),
    "MAIL_FROM_CONFIGURING",
  );
  assert.equal(
    staticLifecycleState({ ownershipVerified: true, sendRoutingVerified: true, dkimDnsVerified: true, sesIdentitySuccess: true, dkimSuccess: true, ready: false }),
    "authentication_verifying",
  );
});
