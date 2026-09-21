import { validateStructuredDocument, type ContentBlock, type StructuredEmailDocument } from "./content.js";

/** The new builder format is distinct from the shipped flat v1 document. */
export type TemplateEditorType = "visual" | "html" | "text";
export type TemplateSourceType =
  | "blank"
  | "system_template"
  | "user_template"
  | "html_paste"
  | "html_file"
  | "zip"
  | "url"
  | "velivoo_import";

export interface TemplateDeviceStyleV2 {
  padding?: { top: number; right: number; bottom: number; left: number };
  alignment?: "left" | "center" | "right";
  fontSize?: number;
}

export interface TemplateResponsiveSettingsV2 {
  desktop?: TemplateDeviceStyleV2;
  mobile?: TemplateDeviceStyleV2;
  visibility?: { desktop: boolean; mobile: boolean };
}

export type TemplateContentBlockV2 = Exclude<ContentBlock, { type: "columns" } | { type: "custom_html" }> & {
  responsive?: TemplateResponsiveSettingsV2;
};

export interface TemplateColumnV2 {
  id: string;
  widthPercent: number;
  blocks: TemplateContentBlockV2[];
}

export interface TemplateSectionV2 {
  id: string;
  columns: TemplateColumnV2[];
  responsive?: TemplateResponsiveSettingsV2 & { mobileColumnOrder?: string[]; mobileStack?: boolean };
}

export interface TemplateGlobalStylesV2 {
  canvasBackground?: string;
  bodyBackground?: string;
  emailWidth?: number;
  fontFamily?: string;
  textColor?: string;
  linkColor?: string;
}

export interface TemplateDocumentV2 {
  schemaVersion: 2;
  type: "email_template";
  settings: TemplateGlobalStylesV2;
  sections: TemplateSectionV2[];
  compliance: { mode: "platform_footer" };
}

export interface LegacyTemplateInput {
  templateType: string;
  conversionStatus: string;
  importMethod: string | null;
  document: unknown;
  settings: unknown;
  originalSourceHtml: string | null;
  sanitizedHtml: string | null;
}

export type LegacyTemplateMigrationPlan =
  | { disposition: "visual"; editorType: "visual"; sourceType: TemplateSourceType | null; design: TemplateDocumentV2; notes: string[] }
  | { disposition: "html"; editorType: "html"; sourceType: TemplateSourceType | null; sourceHtml: string; notes: string[] }
  | { disposition: "review"; editorType: null; sourceType: TemplateSourceType | null; reasons: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceType(input: LegacyTemplateInput): TemplateSourceType | null {
  if (input.importMethod === "pasted_html") return "html_paste";
  if (input.importMethod === "html_upload") return "html_file";
  if (input.importMethod === "zip_upload") return "zip";
  if (input.importMethod === "url_import") return "url";
  if (input.importMethod === "velivoo_import") return "velivoo_import";
  if (record(input.settings) && input.settings.source === "system") return "system_template";
  return null; // Older native rows do not record whether they began blank or copied.
}

function legacyDocument(value: unknown): value is StructuredEmailDocument {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.blocks)) return false;
  return value.blocks.every(block => record(block) && typeof block.id === "string" && typeof block.type === "string");
}

const convertibleTypes = new Set<ContentBlock["type"]>([
  "heading", "text", "header", "footer", "image", "button", "divider", "spacer", "social",
]);

function globalStyles(value: unknown): TemplateGlobalStylesV2 {
  if (!record(value)) return {};
  const styles: TemplateGlobalStylesV2 = {};
  for (const key of ["canvasBackground", "bodyBackground", "textColor", "linkColor"] as const) {
    if (typeof value[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(value[key])) styles[key] = value[key];
  }
  if (typeof value.emailWidth === "number" && Number.isInteger(value.emailWidth) && value.emailWidth >= 320 && value.emailWidth <= 900) styles.emailWidth = value.emailWidth;
  if (typeof value.fontFamily === "string") styles.fontFamily = value.fontFamily;
  return styles;
}

/**
 * Read-only conversion plan. It never rewrites the legacy document and never
 * promotes imported HTML into invented drag-and-drop blocks.
 */
export function planLegacyTemplateMigration(input: LegacyTemplateInput): LegacyTemplateMigrationPlan {
  const provenance = sourceType(input);
  if (input.templateType === "imported_html") {
    const html = input.originalSourceHtml || input.sanitizedHtml;
    return html?.trim()
      ? { disposition: "html", editorType: "html", sourceType: provenance, sourceHtml: html, notes: ["Original HTML remains the editable source."] }
      : { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Imported HTML source is missing."] };
  }

  if (input.templateType === "converted_import") {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: [
      `Previously converted import (${input.conversionStatus}) needs a visual comparison with its preserved HTML before promotion.`,
    ] };
  }

  if (input.templateType !== "native") {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: [`Unknown legacy template type: ${input.templateType}.`] };
  }
  if (!legacyDocument(input.document)) {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Legacy document is not a flat schema v1 document."] };
  }

  const document = input.document;
  const footerIndexes = document.blocks.flatMap((block, index) => block.type === "compliance_footer" ? [index] : []);
  const footer = footerIndexes.length === 1 ? document.blocks[footerIndexes[0]!] : undefined;
  if (!footer || footerIndexes[0] !== document.blocks.length - 1 || footer.type !== "compliance_footer" || footer.locked !== true) {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Expected exactly one final compliance footer."] };
  }

  let invalid: string[];
  try {
    invalid = validateStructuredDocument(document).filter(issue => issue.severity === "blocking").map(issue => issue.code);
  } catch {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Legacy document validation failed."] };
  }
  if (invalid.length) {
    return { disposition: "review", editorType: null, sourceType: provenance, reasons: invalid };
  }

  const allIds = new Set<string>([footer.id]);
  const usedIds = new Set<string>();
  const sections: TemplateSectionV2[] = [];
  const nextId = (base: string) => {
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedIds.add(candidate);
    return candidate;
  };

  for (const block of document.blocks) {
    if (block.type === "compliance_footer") continue;
    if (allIds.has(block.id)) return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Duplicate legacy block ID."] };
    allIds.add(block.id);
    if (block.type === "columns") {
      if (block.columns.length < 1 || block.columns.length > 4) {
        return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Unsupported legacy column count."] };
      }
      for (const column of block.columns) {
        if (!column.id || allIds.has(column.id)) return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Duplicate or missing legacy column ID."] };
        allIds.add(column.id);
        for (const child of column.blocks) {
          if (!record(child) || !convertibleTypes.has(child.type) || !child.id || allIds.has(child.id)) {
            return { disposition: "review", editorType: null, sourceType: provenance, reasons: ["Nested or unsupported legacy column block."] };
          }
          allIds.add(child.id);
        }
      }
    } else if (!convertibleTypes.has(block.type)) {
      return { disposition: "review", editorType: null, sourceType: provenance, reasons: [`Unsupported legacy block: ${block.type}.`] };
    }
  }
  for (const id of allIds) usedIds.add(id);

  for (const [index, block] of document.blocks.entries()) {
    if (block.type === "compliance_footer") continue;
    if (block.type === "columns") {
      const widthPercent = 100 / block.columns.length;
      sections.push({
        id: nextId(`section-${index}`),
        columns: block.columns.map(column => ({ id: column.id, widthPercent, blocks: structuredClone(column.blocks) as TemplateContentBlockV2[] })),
      });
    } else if (block.type !== "custom_html") {
      sections.push({ id: nextId(`section-${index}`), columns: [{ id: nextId(`column-${index}`), widthPercent: 100, blocks: [structuredClone(block)] }] });
    }
  }

  return {
    disposition: "visual",
    editorType: "visual",
    sourceType: provenance,
    design: { schemaVersion: 2, type: "email_template", settings: globalStyles(input.settings), sections, compliance: { mode: "platform_footer" } },
    notes: ["Legacy v1 document and settings must remain stored until v2 rendering is verified."],
  };
}
