import type { StructuredEmailDocument } from "../../../packages/domain/src/phase2/content";

export interface TemplateSetupShape {
  document: StructuredEmailDocument;
  settings: Record<string, unknown> | null;
  templateType?: string;
  importMethod?: string | null;
  originalSourceHtml?: string | null;
  sanitizedHtml?: string | null;
}

export function templateContentBlockCount(document: StructuredEmailDocument): number {
  return document.blocks.filter(block => block.type !== "compliance_footer").length;
}

export function templateNeedsSetup(template: TemplateSetupShape): boolean {
  if (template.templateType === "imported_html" || template.importMethod) return false;
  if (template.originalSourceHtml?.trim() || template.sanitizedHtml?.trim()) return false;
  if (template.settings?.contentEditorStarted === true) return false;
  return templateContentBlockCount(template.document) === 0;
}

export function templateFromName(settings: Record<string, unknown> | null | undefined): string {
  return typeof settings?.fromName === "string" ? settings.fromName : "";
}

export function templateReplyTo(settings: Record<string, unknown> | null | undefined): string {
  return typeof settings?.replyTo === "string" ? settings.replyTo : "";
}

export function templateTrackingEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return settings?.trackingEnabled !== false;
}
