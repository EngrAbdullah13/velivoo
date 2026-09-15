import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryPhase2Repository } from "../packages/persistence/src/proof/in-memory-phase2-repository.js";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";
import { FakeEmailProvider } from "../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";
import { convertHtmlToBlocks, extractSafeZip, isSingleCustomHtmlImport, processImportedHtml, sanitizeImportedHtml } from "../packages/domain/src/phase2/html-import.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function makeZip(files: Record<string, string | Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    header.write(name, 30);
    chunks.push(header, data);
  }
  return Buffer.concat(chunks);
}

test("sanitizeImportedHtml removes scripts and unsafe handlers", () => {
  const source = `<html><body><script>alert(1)</script><a href="javascript:alert(1)" onclick="evil()">Click</a><p>Hello</p></body></html>`;
  const result = sanitizeImportedHtml(source);
  assert.match(result.html, /Hello/);
  assert.doesNotMatch(result.html, /<script/i);
  assert.doesNotMatch(result.html, /javascript:/i);
  assert.ok(result.warnings.some(w => w.code === "SCRIPT_REMOVED"));
});

test("extractSafeZip rejects zip-slip paths", () => {
  const zip = makeZip({ "../escape.html": "<p>Nope</p>" });
  assert.throws(() => extractSafeZip(zip), /IMPORT_ZIP_UNSAFE_PATH/);
});

test("import paste creates tenant-scoped imported html template", async () => {
  const root = await mkdtemp(join(tmpdir(), "template-import-"));
  const repo = new InMemoryPhase2Repository();
  const service = new Phase2Service(repo, new LocalObjectStore(root), new FakeEmailProvider(), {
    publicBaseUrl: "https://mail.example.test",
    unsubscribeSecret: "u".repeat(32),
    trackingSecret: "t".repeat(32),
    maxMessageBytes: 500000,
  });
  repo.seedWorkspace({ id: workspaceId, businessAddress: "1 Test Street", timezone: "UTC", legalName: "Test Brand" }, userId, "owner");
  const actor = { workspaceId, userId };
  try {
    const processed = await service.importTemplatePaste(actor, "<html><body><h1>Welcome</h1><p>Thanks for joining.</p></body></html>");
    assert.ok(processed.sessionId);
    assert.match(processed.previewHtml, /Welcome/);
    const saved = await service.saveImportedTemplate(actor, {
      sessionId: processed.sessionId,
      name: "Imported welcome",
      saveMode: "blocks",
      subject: "Welcome",
      plainText: processed.plainText,
    });
    assert.equal(saved.template.templateType, "converted_import");
    assert.ok(saved.template.document.blocks.some(block => block.type === "heading"));
    assert.equal(saved.template.workspaceId, workspaceId);
    await service.updateTemplateContent(actor, saved.template.id, {
      document: saved.template.document,
      subject: "Welcome",
      preheader: "Glad you are here",
      plainText: saved.template.plainText,
    });
    const preflight = await service.templatePreflight(actor, saved.template.id);
    assert.equal(preflight.ok, true);
    await service.approveTemplate(actor, saved.template.id);
    const email = await service.createCampaignFromApprovedTemplate(actor, saved.template.id, { internalName: "Imported campaign" });
    assert.match(email.subject, /Welcome/);
    const other = { workspaceId: "33333333-3333-4333-8333-333333333333", userId: "44444444-4444-4444-8444-444444444444" };
    repo.seedWorkspace({ id: other.workspaceId, businessAddress: "2 Test Street", timezone: "UTC", legalName: "Other" }, other.userId, "owner");
    await assert.rejects(() => service.template(other, saved.template.id), /TEMPLATE_NOT_FOUND/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zip import with html file succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "template-import-zip-"));
  const repo = new InMemoryPhase2Repository();
  const service = new Phase2Service(repo, new LocalObjectStore(root), new FakeEmailProvider(), {
    publicBaseUrl: "https://mail.example.test",
    unsubscribeSecret: "u".repeat(32),
    trackingSecret: "t".repeat(32),
    maxMessageBytes: 500000,
  });
  repo.seedWorkspace({ id: workspaceId, businessAddress: "1 Test Street", timezone: "UTC", legalName: "Test Brand" }, userId, "owner");
  const actor = { workspaceId, userId };
  try {
    const zip = makeZip({ "email/index.html": "<html><body><p>ZIP body</p></body></html>" });
    const processed = await service.importTemplateUpload(actor, { filename: "export.zip", contentBase64: zip.toString("base64"), kind: "zip" });
    assert.match(processed.previewHtml, /ZIP body/);
    assert.throws(() => processImportedHtml("", "html_upload"), /IMPORT_HTML_EMPTY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial conversion retains custom html sections", async () => {
  const html = "<h1>Title</h1><table><tr><td>Complex</td></tr></table><a style='padding:12px;background-color:#000;color:#fff' href='https://example.com'>Shop</a>";
  const processed = processImportedHtml(html, "pasted_html");
  assert.match(processed.sanitizedHtml, /Title/);
  assert.ok(processed.stats.linksDetected >= 1);
});

test("convertHtmlToBlocks extracts headings and images from table-based email layout", () => {
  const html = `<html><body><table><tr><td><h1 style="color:#2d2d2f;font-size:26px">Velivoo</h1></td><td><p>September Update</p></td></tr></table><table><tr><td><img src="https://cdn.example.com/hero.jpg" alt="Hero image" /></td></tr></table></body></html>`;
  const { document, report } = convertHtmlToBlocks(html);
  const types = document.blocks.map(block => block.type);
  assert.ok(types.includes("heading"));
  assert.ok(types.includes("image"));
  assert.ok(types.includes("text"));
  assert.equal(report.blocksCreated >= 3, true);
  assert.equal(isSingleCustomHtmlImport(document), false);
  const heading = document.blocks.find(block => block.type === "heading");
  assert.equal(heading && heading.type === "heading" ? heading.text : "", "Velivoo");
  assert.equal(heading && heading.type === "heading" ? heading.style?.color : undefined, "#2d2d2f");
});

test("processImportedHtml extracts html from raw email source", () => {
  const eml = [
    "Delivered-To: user@example.com",
    "DKIM-Signature: v=1; a=rsa-sha256",
    "Subject: Why choose BrowserStack?",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="abc123"',
    "",
    "--abc123",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Plain fallback",
    "--abc123",
    "Content-Type: text/html; charset=UTF-8",
    "",
    "<html><body><h1>BrowserStack offer</h1><p>Try now</p></body></html>",
    "--abc123--",
  ].join("\r\n");
  const processed = processImportedHtml(eml, "pasted_html");
  assert.match(processed.previewHtml, /BrowserStack offer/);
  assert.equal(processed.subjectSuggestion, "Why choose BrowserStack?");
  assert.doesNotMatch(processed.previewHtml, /Delivered-To:/);
  assert.ok(processed.warnings.some(w => w.code === "EMAIL_SOURCE_EXTRACTED"));
});

test("processImportedHtml rejects email source without html body", () => {
  const eml = [
    "Delivered-To: user@example.com",
    "Subject: Text only",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Just plain text",
  ].join("\r\n");
  assert.throws(() => processImportedHtml(eml, "pasted_html"), /IMPORT_EMAIL_SOURCE_NO_HTML/);
});

test("processImportedHtml rejects non-html paste", () => {
  assert.throws(() => processImportedHtml("Hello world without tags", "pasted_html"), /IMPORT_HTML_INVALID/);
});
