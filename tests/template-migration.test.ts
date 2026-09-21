import test from "node:test";
import assert from "node:assert/strict";
import { planLegacyTemplateMigration, type LegacyTemplateInput } from "../packages/domain/src/phase2/template-document-v2.js";
import type { StructuredEmailDocument } from "../packages/domain/src/phase2/content.js";

const document: StructuredEmailDocument = {
  schemaVersion: 1,
  blocks: [
    { id: "heading", type: "heading", text: "Welcome", level: 1 },
    { id: "columns", type: "columns", columns: [
      { id: "left", blocks: [{ id: "left-copy", type: "text", text: "First" }] },
      { id: "right", blocks: [{ id: "right-copy", type: "text", text: "Second" }] },
    ] },
    { id: "compliance", type: "compliance_footer", locked: true },
  ],
};

function input(overrides: Partial<LegacyTemplateInput> = {}): LegacyTemplateInput {
  return { templateType: "native", conversionStatus: "not_requested", importMethod: null, document, settings: { emailWidth: 640 }, originalSourceHtml: null, sanitizedHtml: null, ...overrides };
}

test("native v1 blocks become ordered v2 sections without changing the source", () => {
  const before = structuredClone(document);
  const plan = planLegacyTemplateMigration(input());
  assert.equal(plan.disposition, "visual");
  if (plan.disposition !== "visual") return;
  assert.equal(plan.design.schemaVersion, 2);
  assert.equal(plan.design.settings.emailWidth, 640);
  assert.equal(plan.design.compliance.mode, "platform_footer");
  assert.deepEqual(plan.design.sections.map(section => section.columns.map(column => column.blocks.map(block => block.id))), [[ ["heading"] ], [["left-copy"], ["right-copy"]]]);
  assert.deepEqual(plan.design.sections[1]?.columns.map(column => column.widthPercent), [50, 50]);
  assert.deepEqual(document, before);
  assert.notStrictEqual(plan.design.sections[0]?.columns[0]?.blocks[0], document.blocks[0]);
});

test("HTML imports retain the original editable HTML, with no visual conversion", () => {
  const html = "<html><body><table><tr><td>Original layout</td></tr></table></body></html>";
  const plan = planLegacyTemplateMigration(input({ templateType: "imported_html", importMethod: "pasted_html", originalSourceHtml: html }));
  assert.equal(plan.disposition, "html");
  if (plan.disposition !== "html") return;
  assert.equal(plan.sourceType, "html_paste");
  assert.equal(plan.sourceHtml, html);
});

test("previous converted imports require review before promotion", () => {
  const plan = planLegacyTemplateMigration(input({ templateType: "converted_import", conversionStatus: "partial", originalSourceHtml: "<p>Original</p>" }));
  assert.equal(plan.disposition, "review");
  assert.equal(plan.editorType, null);
});

test("unknown and malformed legacy structures never become editable v2 designs", () => {
  const missingFooter = planLegacyTemplateMigration(input({ document: { schemaVersion: 1, blocks: [{ id: "copy", type: "text", text: "Hi" }] } }));
  const nestedColumns = planLegacyTemplateMigration(input({ document: { schemaVersion: 1, blocks: [
    { id: "outer", type: "columns", columns: [{ id: "col", blocks: [{ id: "inner", type: "columns", columns: [] }] }] },
    { id: "compliance", type: "compliance_footer", locked: true },
  ] } }));
  const unknown = planLegacyTemplateMigration(input({ templateType: "mystery" }));
  assert.equal(missingFooter.disposition, "review");
  assert.equal(nestedColumns.disposition, "review");
  assert.equal(unknown.disposition, "review");
});
