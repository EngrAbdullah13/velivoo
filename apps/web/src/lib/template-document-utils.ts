import type { StructuredEmailDocument } from "../../../../packages/domain/src/phase2/content";

export function isSingleCustomHtmlDocument(document: StructuredEmailDocument): boolean {
  const content = document.blocks.filter(block => block.type !== "compliance_footer");
  return content.length === 1 && content[0]?.type === "custom_html";
}

export function buildImportedHtmlDocument(html: string): StructuredEmailDocument {
  return {
    schemaVersion: 1,
    blocks: [
      { id: "imported-html", type: "custom_html", html, label: "Imported HTML" },
      { id: "compliance", type: "compliance_footer", locked: true },
    ],
  };
}

export function needsEditableBlockConversion(template: { document: StructuredEmailDocument; templateType?: string }): boolean {
  if (template.templateType === "imported_html") return true;
  return isSingleCustomHtmlDocument(template.document);
}
