import { createHash } from "node:crypto";

// HTML is retained only for backwards-compatible persistence reads.  Release 1
// commands always create and publish structured content.
export type AuthoringMode = "structured" | "html";
export type EmailDraftState = "draft" | "ready" | "blocked";

/**
 * This deliberately small style contract is the only typography surface that
 * Release 1 structured email blocks may persist.  It is data, not author HTML
 * or CSS, so the compiler remains the sole rendering authority.
 */
export interface EmailTextStyle {
  fontFamily?: "Arial, sans-serif" | "Georgia, serif" | "Helvetica, Arial, sans-serif";
  color?: string;
  fontSize?: number;
  lineHeight?: number;
  linkColor?: string;
  fontWeight?: "normal" | "bold";
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}
export interface EmailBlockSpacing { top?: number; bottom?: number }
export interface RichTextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; link?: string }
export interface RichTextDocument { runs: RichTextRun[] }

export type EmailAlignment = "left" | "center" | "right";
export interface HeadingBlock { id:string; type:"heading"; text:string; level:1|2|3; align?:EmailAlignment; richText?:RichTextDocument; style?:EmailTextStyle; spacing?:EmailBlockSpacing; backgroundColor?:string }
export interface TextBlock { id:string; type:"text"; text:string; align?:EmailAlignment; richText?:RichTextDocument; style?:EmailTextStyle; spacing?:EmailBlockSpacing; backgroundColor?:string }
export interface HeaderBlock { id:string; type:"header"; text:string; align?:EmailAlignment; style?:EmailTextStyle; spacing?:EmailBlockSpacing; backgroundColor?:string }
export interface FooterBlock { id:string; type:"footer"; text:string; align?:EmailAlignment; style?:EmailTextStyle; spacing?:EmailBlockSpacing; backgroundColor?:string }
export interface ImageBlock { id:string; type:"image"; src:string; alt:string; width?:number; align?:EmailAlignment; link?:string; borderRadius?:number; spacing?:EmailBlockSpacing }
export interface ButtonBlock { id:string; type:"button"; label:string; url:string; align?:EmailAlignment; backgroundColor?:string; textColor?:string; borderColor?:string; spacing?:EmailBlockSpacing }
export interface DividerBlock { id:string; type:"divider"; color?:string; style?:"solid"|"dashed"; spacing?:EmailBlockSpacing }
export interface SpacerBlock { id:string; type:"spacer"; height:number }
export interface SocialBlock { id:string; type:"social"; links:Array<{label:string;url:string}> }
export interface ColumnsBlock { id:string; type:"columns"; columns:Array<{id:string;blocks:ContentBlock[]}>; spacing?:EmailBlockSpacing }
export interface CustomHtmlBlock { id:string; type:"custom_html"; html:string; label?:string; needsReview?:boolean; spacing?:EmailBlockSpacing }
export type ContentBlock=HeadingBlock|TextBlock|HeaderBlock|FooterBlock|ImageBlock|ButtonBlock|DividerBlock|SpacerBlock|SocialBlock|ColumnsBlock|CustomHtmlBlock;
export interface ComplianceFooterBlock { id:string; type:"compliance_footer"; locked:true }
export type StructuredBlock=ContentBlock|ComplianceFooterBlock;

export interface StructuredEmailDocument {
  schemaVersion: 1;
  blocks: StructuredBlock[];
}

export interface EmailDraft {
  id: string;
  workspaceId: string;
  internalName: string;
  authoringMode: AuthoringMode;
  subject: string;
  preheader: string;
  senderIdentityId: string | null;
  replyTo: string;
  structuredDocument: StructuredEmailDocument;
  htmlSource: string | null;
  plainText: string;
  plainTextMode?: "auto" | "manual";
  plainTextStale?: boolean;
  trackingEnabled: boolean;
  openTrackingEnabled: boolean;
  rowVersion: number;
  state: EmailDraftState;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface PublishedEmailVersion {
  id: string;
  workspaceId: string;
  emailDefinitionId: string;
  versionNumber: number;
  authoringMode: AuthoringMode;
  authoringSchemaVersion: number;
  sourceDocument: StructuredEmailDocument | null;
  sanitizedSource: string | null;
  compiledHtml: string;
  compiledText: string;
  subjectTemplate: string;
  preheaderTemplate: string;
  senderIdentityId: string;
  replyTo: string;
  trackingEnabled?: boolean;
  openTrackingEnabled?: boolean;
  senderSnapshot?: { fromName: string; fromEmail: string; replyTo: string } | null;
  contentHash: string;
  compilerVersion: string;
  sanitizerVersion: string;
  preflight: PreflightResult;
  publishedAt: string;
  publishedBy: string;
}

export type PreflightSeverity = "blocking" | "warning" | "passed";
export interface PreflightIssue {
  code: string;
  severity: PreflightSeverity;
  path: string;
  message: string;
  title?: string;
  blockId?: string;
  field?: string;
  suggestedAction?: string;
}
export interface PreflightResult {
  ok: boolean;
  checkedAt: string;
  issues: PreflightIssue[];
  state?: "passed" | "warnings" | "blocking" | "stale" | "not_run";
  fingerprint?: string;
}

export const PHASE2_COMPILER_VERSION = "phase2-structured-v1";
export const PHASE2_SANITIZER_VERSION = "phase2-conservative-v1";

export function defaultStructuredDocument(): StructuredEmailDocument {
  return {
    schemaVersion: 1,
    blocks: [{ id: "compliance", type: "compliance_footer", locked: true }],
  };
}

export function ensureComplianceFooter(document: StructuredEmailDocument): StructuredEmailDocument {
  const blocks = document.blocks.filter((b, index, all) => b.type !== "compliance_footer" || index === all.findIndex((x) => x.type === "compliance_footer"));
  const footer = blocks.find((b) => b.type === "compliance_footer");
  if (!footer) blocks.push({ id: "compliance", type: "compliance_footer", locked: true });
  return { schemaVersion: 1, blocks: blocks.map((b) => b.type === "compliance_footer" ? { ...b, locked: true } : b) };
}

const alignments = new Set(["left", "center", "right"]);
const allowedFonts = new Set(["Arial, sans-serif", "Georgia, serif", "Helvetica, Arial, sans-serif"]);
const safeColour = (value:unknown) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
export function validateStructuredDocument(document: StructuredEmailDocument): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.blocks)) return [{ code: "DOCUMENT_INVALID", severity: "blocking", path: "structuredDocument", message: "The email document is invalid.", title: "Invalid document" }];
  if (document.blocks.length > 100) issues.push({ code: "BLOCK_LIMIT", severity: "blocking", path: "structuredDocument.blocks", message: "An email can contain at most 100 blocks.", title: "Too many blocks" });
  const ids = new Set<string>();
  for (const [index, block] of document.blocks.entries()) {
    const path = `structuredDocument.blocks.${index}`;
    if (!block.id || ids.has(block.id)) issues.push({ code: "BLOCK_ID_INVALID", severity: "blocking", path, blockId: block.id, message: "Each block needs a unique ID.", title: "Invalid block ID" });
    ids.add(block.id);
    if ("align" in block && block.align !== undefined && !alignments.has(block.align)) issues.push({ code: "ALIGNMENT_INVALID", severity: "blocking", path: `${path}.align`, blockId: block.id, field: "align", message: "Alignment must be left, center, or right.", title: "Invalid alignment" });
    if (block.type === "heading" && ![1, 2, 3].includes(block.level)) issues.push({ code: "HEADING_LEVEL_INVALID", severity: "blocking", path: `${path}.level`, blockId: block.id, field: "level", message: "Heading level must be 1, 2, or 3.", title: "Invalid heading" });
    if (block.type === "spacer" && (!Number.isInteger(block.height) || block.height < 0 || block.height > 120)) issues.push({ code: "SPACER_HEIGHT_INVALID", severity: "blocking", path: `${path}.height`, blockId: block.id, field: "height", message: "Spacer height must be a whole number between 0 and 120.", title: "Invalid spacer" });
    if (block.type === "image" && block.width !== undefined && (!Number.isInteger(block.width) || block.width < 1 || block.width > 1200)) issues.push({ code: "IMAGE_WIDTH_INVALID", severity: "blocking", path: `${path}.width`, blockId: block.id, field: "width", message: "Image width must be between 1 and 1200 pixels.", title: "Invalid image width" });
    if (block.type === "image" && block.borderRadius !== undefined && (!Number.isInteger(block.borderRadius) || block.borderRadius < 0 || block.borderRadius > 80)) issues.push({ code: "IMAGE_RADIUS_INVALID", severity: "blocking", path: `${path}.borderRadius`, blockId: block.id, field: "borderRadius", message: "Image border radius must be between 0 and 80 pixels.", title: "Invalid image radius" });
    if ((block.type === "heading" || block.type === "text" || block.type === "header" || block.type === "footer") && block.style) {
      const style = block.style;
      if (style.fontFamily && !allowedFonts.has(style.fontFamily)) issues.push({ code: "FONT_INVALID", severity: "blocking", path: `${path}.style.fontFamily`, blockId: block.id, message: "Choose an approved email-safe font.", title: "Invalid font" });
      if ((style.fontSize !== undefined && (!Number.isInteger(style.fontSize) || style.fontSize < 10 || style.fontSize > 48)) || (style.lineHeight !== undefined && (style.lineHeight < 1 || style.lineHeight > 2.5))) issues.push({ code: "TEXT_STYLE_INVALID", severity: "blocking", path: `${path}.style`, blockId: block.id, message: "Text size or line height is outside the supported range.", title: "Invalid text style" });
      for (const key of ["color", "linkColor"] as const) if (style[key] !== undefined && !safeColour(style[key])) issues.push({ code: "TEXT_COLOR_INVALID", severity: "blocking", path: `${path}.style.${key}`, blockId: block.id, message: "Colors must use a six-digit hex value.", title: "Invalid color" });
    }
    if ("spacing" in block && block.spacing) for (const key of ["top", "bottom"] as const) { const value = block.spacing[key]; if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 80)) issues.push({ code: "SPACING_INVALID", severity: "blocking", path: `${path}.spacing.${key}`, blockId: block.id, message: "Spacing must be a whole number between 0 and 80 pixels.", title: "Invalid spacing" }); }
    if (block.type === "custom_html") {
      if (!block.html.trim()) issues.push({ code: "CUSTOM_HTML_EMPTY", severity: "blocking", path: `${path}.html`, blockId: block.id, message: "Custom HTML sections cannot be empty.", title: "Empty custom HTML" });
      if (block.html.length > 250_000) issues.push({ code: "CUSTOM_HTML_TOO_LARGE", severity: "blocking", path: `${path}.html`, blockId: block.id, message: "Custom HTML exceeds the supported size limit.", title: "Custom HTML too large" });
      if (/<script\b/i.test(block.html) || /\son[a-z]+\s*=/i.test(block.html)) issues.push({ code: "CUSTOM_HTML_UNSAFE", severity: "blocking", path: `${path}.html`, blockId: block.id, message: "Custom HTML contains unsupported scripts or event handlers.", title: "Unsafe custom HTML" });
    }
    if (block.type === "columns") {
      if (block.columns.length < 2 || block.columns.length > 4) issues.push({code:"COLUMN_COUNT_INVALID",severity:"blocking",path:`${path}.columns`,blockId:block.id,message:"A columns block must contain between two and four columns.",title:"Invalid columns"});
      for (const [columnIndex,column] of block.columns.entries()) {
        if (!column.id || ids.has(column.id)) issues.push({code:"COLUMN_ID_INVALID",severity:"blocking",path:`${path}.columns.${columnIndex}`,blockId:block.id,message:"Each column needs a unique ID.",title:"Invalid column ID"});
        ids.add(column.id);
        if (!Array.isArray(column.blocks) || !column.blocks.length) issues.push({code:"COLUMN_EMPTY",severity:"blocking",path:`${path}.columns.${columnIndex}.blocks`,blockId:block.id,message:"Each column needs at least one content block.",title:"Empty column"});
        for (const [childIndex,child] of column.blocks.entries()) {
          if (!child.id || ids.has(child.id)) issues.push({code:"BLOCK_ID_INVALID",severity:"blocking",path:`${path}.columns.${columnIndex}.blocks.${childIndex}`,blockId:child.id,message:"Each block needs a unique ID.",title:"Invalid block ID"});
          ids.add(child.id);
          if (child.type === "columns") issues.push({code:"NESTED_COLUMNS_UNSUPPORTED",severity:"blocking",path:`${path}.columns.${columnIndex}.blocks.${childIndex}`,blockId:child.id,message:"Columns cannot be nested inside another columns block.",title:"Unsupported nesting"});
        }
      }
    }
  }
  return issues;
}

export function stableContentHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n---\n")).digest("hex");
}
