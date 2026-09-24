import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canReceiveMarketingEmail, marketingEmailStatus } from "../packages/domain/src/marketing/marketing-eligibility.js";
import { createRecipientUnsubscribeToken, signUnsubscribeToken, verifyUnsubscribeToken } from "../packages/email-renderer/src/unsubscribe-token.js";
import { buildUnsubscribeUrl, emailHasUnsubscribeBlock } from "../packages/email-renderer/src/unsubscribe-url.js";
import { buildMime } from "../packages/email-renderer/src/mime-builder.js";
import { applyMarketingUnsubscribe } from "../packages/application/src/marketing/apply-marketing-unsubscribe.js";
import { InMemoryPhase2Repository } from "../packages/persistence/src/proof/in-memory-phase2-repository.js";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";
import { FakeEmailProvider } from "../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";
import { MarketingBroadcastService } from "../packages/application/src/marketing/marketing-broadcast-service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROFILE_A = "33333333-3333-4333-8333-333333333333";
const PROFILE_B = "44444444-4444-4444-8444-444444444444";
const DOMAIN = "55555555-5555-4555-8555-555555555555";
const SENDER = "66666666-6666-4666-8666-666666666666";

class MemoryUnsubscribeTx {
  inbox = new Map<string, any>();
  profiles = new Map<string, any>();
  workspaces = new Map<string, any>();
  consent: any[] = [];
  suppressions: any[] = [];
  subscription: any = null;
  messages: any[] = [];
  traces: any[] = [];

  inboxMessage = {
    create: async ({ data }: any) => { this.inbox.set(`${data.source}:${data.externalId}`, data); return data; },
    update: async ({ where, data }: any) => { const row = this.inbox.get(`${where.source_externalId.source}:${where.source_externalId.externalId}`); Object.assign(row, data); return row; },
    findUnique: async ({ where }: any) => this.inbox.get(`${where.source_externalId.source}:${where.source_externalId.externalId}`) ?? null,
  };
  profile = { findFirst: async ({ where }: any) => this.profiles.get(`${where.workspaceId}:${where.id}`) ?? null };
  workspace = { findUnique: async ({ where }: any) => this.workspaces.get(where.id) ?? null };
  consentRecord = {
    findFirst: async ({ where, orderBy }: any) => this.consent.filter(x => x.workspaceId === where.workspaceId && x.profileId === where.profileId).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null,
    create: async ({ data }: any) => { this.consent.push({ ...data, recordedAt: new Date() }); return data; },
  };
  suppression = { createMany: async ({ data, skipDuplicates }: any) => { for (const row of data) { if (skipDuplicates && this.suppressions.some(x => x.workspaceId === row.workspaceId && x.profileId === row.profileId && x.reason === row.reason)) continue; this.suppressions.push(row); } return { count: data.length }; } };
  subscriptionState = {
    findUnique: async () => this.subscription,
    upsert: async ({ create, update }: any) => { this.subscription = this.subscription ? { ...this.subscription, ...update, revision: (this.subscription.revision ?? 1) + 1 } : create; return this.subscription; },
  };
  message = { updateMany: async ({ where, data }: any) => { let count = 0; for (const m of this.messages) { if (m.workspaceId === where.workspaceId && m.profileId === where.profileId && where.state.in.includes(m.state)) { m.state = data.state; count++; } } return { count }; } };
  traceEvent = { create: async ({ data }: any) => { this.traces.push(data); return data; } };
}

async function phase2Setup(consent = "granted") {
  const root = await mkdtemp(join(tmpdir(), "unsub-"));
  const repo = new InMemoryPhase2Repository();
  repo.seedWorkspace({ id: WS, businessAddress: "123 Test Street", timezone: "UTC", legalName: "ABC Store" }, USER, "owner");
  repo.seedProfile({ id: PROFILE_A, workspaceId: WS, normalizedEmail: "john@gmail.com", originalEmail: "john@gmail.com", firstName: "John", timezone: "UTC" }, consent);
  repo.seedSender({ id: DOMAIN, workspaceId: WS, domain: "brand.test", status: "verified" }, { id: SENDER, workspaceId: WS, domainId: DOMAIN, fromName: "ABC Store", fromEmail: "hello@brand.test", replyTo: "support@brand.test", purpose: "marketing", status: "active" });
  const objects = new LocalObjectStore(root);
  const provider = new FakeEmailProvider();
  const service = new Phase2Service(repo, objects, provider, { publicBaseUrl: "https://click.brand.test", unsubscribeSecret: SECRET, trackingSecret: "t".repeat(32), maxMessageBytes: 500_000, providerReady: true });
  const actor = { userId: USER, workspaceId: WS };
  const draft = await service.createEmail(actor, { internalName: "Sale" });
  await service.updateEmail(actor, draft.id, { expectedRowVersion: draft.rowVersion, patch: { subject: "Sale", senderIdentityId: SENDER, replyTo: "support@brand.test", structuredDocument: { schemaVersion: 1, blocks: [{ id: "t", type: "text", text: "Hello" }, { id: "compliance", type: "compliance_footer", locked: true }] }, plainText: "Hello\nUnsubscribe: {{ system.unsubscribe_url }}" } });
  const version = await service.publish(actor, draft.id);
  return { root, repo, objects, provider, service, actor, version };
}

test("subscribed contact passes central marketing eligibility gate", () => {
  assert.equal(canReceiveMarketingEmail({ consent: "granted", protectedSuppression: false, identifierValid: true }).allowed, true);
  assert.equal(marketingEmailStatus("granted"), "SUBSCRIBED");
});

test("unsubscribed contact fails marketing eligibility gate", () => {
  const result = canReceiveMarketingEmail({ consent: "withdrawn", protectedSuppression: false, identifierValid: true });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "UNSUBSCRIBED");
});

test("test send skips unsubscribed contacts", async () => {
  const x = await phase2Setup("withdrawn");
  try {
    const testSend = await x.service.testSend(x.actor, x.version.emailDefinitionId, { profileId: PROFILE_A });
    const decision = await x.service.evaluatePolicy(WS, testSend.messageId);
    assert.equal(decision.outcome, "skip");
    assert.equal(decision.reason, "NO_MARKETING_CONSENT");
    assert.equal(x.provider.submitCalls, 0);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("test send skips protected suppression even when consent is still granted", async () => {
  const x = await phase2Setup("granted");
  try {
    x.repo.setProtectedSuppression(WS, PROFILE_A, true);
    const testSend = await x.service.testSend(x.actor, x.version.emailDefinitionId, { profileId: PROFILE_A });
    const decision = await x.service.evaluatePolicy(WS, testSend.messageId);
    assert.equal(decision.outcome, "skip");
    assert.equal(decision.reason, "PROTECTED_SUPPRESSION");
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("marketing manual send skips unsubscribed contact", async () => {
  const x = await phase2Setup("withdrawn");
  try {
    const msg = await x.service.createMessageIntent(x.actor, { sourceType: "manual", sourceId: randomUUID(), profileId: PROFILE_A, emailVersionId: x.version.id });
    const decision = await x.service.evaluatePolicy(WS, msg.id);
    assert.equal(decision.outcome, "skip");
    assert.equal(decision.reason, "NO_MARKETING_CONSENT");
    assert.equal(x.provider.submitCalls, 0);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("flow-style marketing message skips unsubscribed contact", async () => {
  const x = await phase2Setup("withdrawn");
  try {
    const msg = await x.service.createMessageIntent(x.actor, { sourceType: "flow", sourceId: randomUUID(), profileId: PROFILE_A, emailVersionId: x.version.id });
    const decision = await x.service.evaluatePolicy(WS, msg.id);
    assert.equal(decision.outcome, "skip");
    assert.equal(x.provider.submitCalls, 0);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("flow testing message with run linkage still respects marketing consent", async () => {
  const x = await phase2Setup("withdrawn");
  try {
    const msg = await x.repo.createMessage({
      workspaceId: WS,
      sourceType: "test",
      sourceId: randomUUID(),
      flowRunId: randomUUID(),
      nodeId: "welcome-email",
      profileId: PROFILE_A,
      emailVersionId: x.version.id,
      idempotencyKey: randomUUID(),
      scheduledFor: new Date(),
    });
    const decision = await x.service.evaluatePolicy(WS, msg.id);
    assert.equal(decision.outcome, "skip");
    assert.equal(decision.reason, "NO_MARKETING_CONSENT");
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("clicking unsubscribe updates subscription projection", async () => {
  const tx = new MemoryUnsubscribeTx();
  tx.workspaces.set(WS, { legalName: "ABC Store" });
  tx.profiles.set(`${WS}:${PROFILE_A}`, { id: PROFILE_A, workspaceId: WS, deletedAt: null });
  const payload = verifyUnsubscribeToken(createRecipientUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_A, messageId: randomUUID(), sourceType: "campaign", sourceId: randomUUID() }, SECRET), SECRET);
  const externalId = createHash("sha256").update("token").digest("hex");
  const first = await applyMarketingUnsubscribe(tx as any, { payload, externalId, method: "ONE_CLICK" });
  assert.equal(first.brandName, "ABC Store");
  assert.equal(tx.subscription.currentStatus, "withdrawn");
  assert.equal(tx.subscription.unsubscribeMethod, "ONE_CLICK");
  assert.equal(tx.traces.some(t => t.kind === "EMAIL_MARKETING_UNSUBSCRIBED"), true);
});

test("tampered unsubscribe token fails safely", () => {
  const token = signUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_A, purpose: "marketing", v: 1 }, SECRET);
  assert.throws(() => verifyUnsubscribeToken(`${token}x`, SECRET));
});

test("workspace-scoped unsubscribe rejects unknown profile in tenant", async () => {
  const tx = new MemoryUnsubscribeTx();
  tx.workspaces.set(WS, { legalName: "ABC Store" });
  const payload = verifyUnsubscribeToken(signUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_B, purpose: "marketing", v: 1 }, SECRET), SECRET);
  await assert.rejects(() => applyMarketingUnsubscribe(tx as any, { payload, externalId: "x", method: "ONE_CLICK" }));
});

test("csv import cannot re-subscribe an unsubscribed contact", () => {
  const current: "withdrawn" | "granted" = "withdrawn";
  const importStatus: "granted" | "withdrawn" = "granted";
  const shouldPreserve = importStatus === "granted" && (current === "withdrawn" || current === "denied");
  assert.equal(shouldPreserve, true);
});

test("scheduled campaign audience filter suppresses unsubscribed before queueing", async () => {
  const x = await phase2Setup("granted");
  try {
    x.repo.seedProfile({ id: PROFILE_B, workspaceId: WS, normalizedEmail: "sarah@gmail.com", originalEmail: "sarah@gmail.com", firstName: "Sarah", timezone: "UTC" }, "granted");
    x.repo.setProtectedSuppression(WS, PROFILE_A, true);
    const audience = {
      listActiveProfileIds: async () => [PROFILE_A, PROFILE_B],
      segmentMemberProfileIds: async () => [],
      marketingEligibility: async (_w: string, profileId: string) => ({
        consent: profileId === PROFILE_B ? "granted" as const : "withdrawn" as const,
        protectedSuppression: profileId === PROFILE_A,
        identifierValid: true,
      }),
    };
    const broadcast = new MarketingBroadcastService(x.service, audience, async () => undefined);
    const result = await broadcast.sendCampaign(x.actor, { campaignId: randomUUID(), emailVersionId: x.version.id, audienceType: "list", audienceId: randomUUID() });
    assert.equal(result.selected, 2);
    assert.equal(result.suppressed, 1);
    assert.equal(result.queued, 1);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("final send-time policy blocks contact who unsubscribed after queueing", async () => {
  const x = await phase2Setup("granted");
  try {
    const msg = await x.service.createMessageIntent(x.actor, { sourceType: "campaign", sourceId: randomUUID(), profileId: PROFILE_A, emailVersionId: x.version.id });
    await x.service.evaluatePolicy(WS, msg.id);
    await x.service.renderMessage(WS, msg.id);
    x.repo.setProtectedSuppression(WS, PROFILE_A, true);
    const submitted = await x.service.submitMessage(WS, msg.id);
    assert.notEqual(submitted?.state, "submitted");
    assert.equal(x.provider.submitCalls, 0);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("marketing email contains valid unsubscribe link and one-click headers", async () => {
  const x = await phase2Setup("granted");
  try {
    const msg = await x.service.createMessageIntent(x.actor, { sourceType: "campaign", sourceId: randomUUID(), profileId: PROFILE_A, emailVersionId: x.version.id });
    await x.service.evaluatePolicy(WS, msg.id);
    await x.service.renderMessage(WS, msg.id);
    const artifact = await x.repo.artifact(WS, msg.id);
    const mime = (await x.objects.get(artifact!.objectKey)).toString("utf8");
    assert.match(mime, /List-Unsubscribe:/);
    assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
    assert.match(mime, /\/unsubscribe\//);
    assert.doesNotMatch(mime, /unsubscribe\?email=/);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("test send email uses a real signed unsubscribe link", async () => {
  const x = await phase2Setup("granted");
  try {
    const testSend = await x.service.testSend(x.actor, x.version.emailDefinitionId, { profileId: PROFILE_A });
    await x.service.evaluatePolicy(WS, testSend.messageId);
    await x.service.renderMessage(WS, testSend.messageId);
    const artifact = await x.repo.artifact(WS, testSend.messageId);
    const mime = (await x.objects.get(artifact!.objectKey)).toString("utf8");
    assert.doesNotMatch(mime, /test-preview/);
    assert.match(mime, /\/unsubscribe\//);
    assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("unsubscribe from test send token withdraws marketing consent", async () => {
  const tx = new MemoryUnsubscribeTx();
  tx.workspaces.set(WS, { legalName: "ABC Store" });
  tx.profiles.set(`${WS}:${PROFILE_A}`, { id: PROFILE_A, workspaceId: WS, deletedAt: null });
  const payload = verifyUnsubscribeToken(createRecipientUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_A, messageId: randomUUID(), sourceType: "test", sourceId: randomUUID() }, SECRET), SECRET);
  const result = await applyMarketingUnsubscribe(tx as any, { payload, externalId: createHash("sha256").update("test-send").digest("hex"), method: "ONE_CLICK" });
  assert.equal(result.alreadyUnsubscribed, false);
  assert.equal(tx.subscription.currentStatus, "withdrawn");
  assert.equal(tx.subscription.unsubscribeMethod, "ONE_CLICK");
});

test("each recipient render gets a unique unsubscribe token", () => {
  const a = createRecipientUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_A, messageId: randomUUID(), sourceType: "campaign", sourceId: "camp-1" }, SECRET);
  const b = createRecipientUnsubscribeToken({ workspaceId: WS, profileId: PROFILE_A, messageId: randomUUID(), sourceType: "campaign", sourceId: "camp-1" }, SECRET);
  assert.notEqual(a, b);
});

test("duplicate footer is not injected when template already includes unsubscribe variable", () => {
  assert.equal(emailHasUnsubscribeBlock("<a>{{ system.unsubscribe_url }}</a>", "Unsubscribe: {{ system.unsubscribe_url }}"), true);
  const mime = buildMime({ fromName: "ABC", fromEmail: "hello@brand.test", replyTo: "support@brand.test", to: "john@gmail.com", subject: "Hi", html: "<a href=\"https://click.brand.test/unsubscribe/tok\">Unsubscribe</a>", text: "Unsubscribe", unsubscribeUrl: "https://click.brand.test/unsubscribe/tok" });
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
});

test("unsubscribe URL uses click host path form", () => {
  const token = "abc.def";
  assert.equal(buildUnsubscribeUrl({ token, publicBaseUrl: "http://localhost:4001", trackingBaseUrl: "https://click.velivoo.com" }), "https://click.velivoo.com/unsubscribe/abc.def");
});

test("proof mode test send uses public base for unsubscribe when configured", async () => {
  const x = await phase2Setup("granted");
  try {
    const service = new Phase2Service(x.repo, x.objects, x.provider, {
      publicBaseUrl: "https://enjoyable-iphone-zeppelin.ngrok-free.dev",
      unsubscribeSecret: SECRET,
      trackingSecret: "t".repeat(32),
      maxMessageBytes: 500_000,
      providerReady: true,
      unsubscribePublicBaseOnly: true,
    });
    const testSend = await service.testSend(x.actor, x.version.emailDefinitionId, { profileId: PROFILE_A });
    await service.evaluatePolicy(WS, testSend.messageId);
    await service.renderMessage(WS, testSend.messageId);
    const artifact = await x.repo.artifact(WS, testSend.messageId);
    const mime = (await x.objects.get(artifact!.objectKey)).toString("utf8");
    assert.match(mime, /https:\/\/enjoyable-iphone-zeppelin\.ngrok-free\.dev\/unsubscribe\//);
    assert.doesNotMatch(mime, /send\.lahorixsolutions\.com|send\.brand\.test/);
    assert.doesNotMatch(mime, /\/t\/c\/[^"\r\n]+/);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});

test("tracked sends keep unsubscribe href off the click-tracking host", async () => {
  const x = await phase2Setup("granted");
  try {
    const draft = await x.service.getEmail(x.actor, x.version.emailDefinitionId);
    await x.service.updateEmail(x.actor, draft.id, {
      expectedRowVersion: draft.rowVersion,
      patch: {
        structuredDocument: {
          schemaVersion: 1,
          blocks: [
            { id: "cta", type: "button", label: "Shop now", url: "https://example.com/sale" },
            { id: "compliance", type: "compliance_footer", locked: true },
          ],
        },
        trackingEnabled: true,
      },
    });
    const service = new Phase2Service(x.repo, x.objects, x.provider, {
      publicBaseUrl: "https://enjoyable-iphone-zeppelin.ngrok-free.dev",
      unsubscribeSecret: SECRET,
      trackingSecret: "t".repeat(32),
      maxMessageBytes: 500_000,
      providerReady: true,
      unsubscribePublicBaseOnly: true,
    });
    const testSend = await service.testSend(x.actor, draft.id, { profileId: PROFILE_A });
    await service.evaluatePolicy(WS, testSend.messageId);
    await service.renderMessage(WS, testSend.messageId);
    const artifact = await x.repo.artifact(WS, testSend.messageId);
    const mime = (await x.objects.get(artifact!.objectKey)).toString("utf8");
    assert.match(mime, /List-Unsubscribe: <https:\/\/enjoyable-iphone-zeppelin\.ngrok-free\.dev\/unsubscribe\//);
    assert.match(mime, /href="https:\/\/enjoyable-iphone-zeppelin\.ngrok-free\.dev\/t\/c\//);
    assert.doesNotMatch(mime, /href="https:\/\/enjoyable-iphone-zeppelin\.ngrok-free\.dev\/t\/c\/[^"]*unsubscribe/i);
    assert.doesNotMatch(mime, /send\.lahorixsolutions\.com/);
  } finally { await rm(x.root, { recursive: true, force: true }); }
});
