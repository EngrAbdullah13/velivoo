import { randomUUID } from "node:crypto";
import type { ObjectStore } from "../ports/object-store.js";
import type { Phase2Repository } from "../ports/phase2-repository.js";
import {
  assertHtmlSize,
  assertZipSize,
  buildImportedHtmlDocument,
  convertHtmlToBlocks,
  extractSafeZip,
  extractTemplateDesignFromHtml,
  importSessionKey,
  pickPrimaryHtmlFiles,
  processImportedHtml,
  rewriteImageSources,
  sanitizeImportedHtml,
  type ImportProcessResult,
  type ImportWarning,
  type TemplateImportMethod,
} from "../../../domain/src/phase2/html-import.js";
import { ensureComplianceFooter } from "../../../domain/src/phase2/content.js";

export interface ImportSessionPayload {
  workspaceId: string;
  userId: string;
  method: TemplateImportMethod;
  filename?: string;
  originalSourceHtml: string;
  sanitizedHtml: string;
  plainText: string;
  subjectSuggestion: string;
  preheaderSuggestion: string;
  warnings: ImportWarning[];
  stats: ImportProcessResult["stats"];
  htmlFileChoices?: string[];
  zipEntries?: Record<string, string>;
  conversionReport?: ImportProcessResult["conversionReport"];
  createdAt: string;
}

export interface SaveImportedTemplateInput {
  sessionId: string;
  name: string;
  category?: string;
  saveMode: "html" | "blocks";
  subject?: string;
  preheader?: string;
  plainText?: string;
  selectedHtmlFile?: string;
}

export class TemplateImportService {
  constructor(private readonly repo: Phase2Repository, private readonly objects: ObjectStore, private readonly publicBaseUrl: string) {}

  private assetUrl(workspaceId: string, assetId: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, "");
    return `${base}/api/v1/public/content-assets/${workspaceId}/${assetId}`;
  }

  private async persistSession(payload: ImportSessionPayload): Promise<string> {
    const sessionId = randomUUID();
    await this.objects.put(importSessionKey(payload.workspaceId, sessionId), JSON.stringify(payload));
    return sessionId;
  }

  async loadSession(workspaceId: string, sessionId: string): Promise<ImportSessionPayload> {
    const raw = await this.objects.get(importSessionKey(workspaceId, sessionId));
    const payload = JSON.parse(raw.toString("utf8")) as ImportSessionPayload;
    if (payload.workspaceId !== workspaceId) throw new Error("IMPORT_SESSION_NOT_FOUND");
    return payload;
  }

  async importPaste(workspaceId: string, userId: string, html: string): Promise<ImportProcessResult> {
    if (!html.trim()) throw new Error("IMPORT_HTML_EMPTY");
    assertHtmlSize(html);
    const processed = processImportedHtml(html, "pasted_html");
    const sessionId = await this.persistSession({
      workspaceId,
      userId,
      method: "pasted_html",
      originalSourceHtml: html,
      ...processed,
      createdAt: new Date().toISOString(),
    });
    return { sessionId, ...processed };
  }

  async importHtmlUpload(workspaceId: string, userId: string, filename: string, content: Buffer): Promise<ImportProcessResult> {
    const lower = filename.toLowerCase();
    if (!/\.html?$/.test(lower) && !lower.endsWith(".eml")) throw new Error("IMPORT_FILE_TYPE_INVALID");
    assertHtmlSize(content.toString("utf8"));
    const html = content.toString("utf8");
    const processed = processImportedHtml(html, "html_upload", filename);
    const sessionId = await this.persistSession({
      workspaceId,
      userId,
      method: "html_upload",
      filename,
      originalSourceHtml: html,
      ...processed,
      createdAt: new Date().toISOString(),
    });
    return { sessionId, ...processed };
  }

  async importZipUpload(workspaceId: string, userId: string, filename: string, content: Buffer): Promise<ImportProcessResult> {
    if (!filename.toLowerCase().endsWith(".zip")) throw new Error("IMPORT_FILE_TYPE_INVALID");
    assertZipSize(content);
    const entries = extractSafeZip(content);
    const htmlFiles = pickPrimaryHtmlFiles(entries);
    if (!htmlFiles.length) throw new Error("IMPORT_ZIP_NO_HTML");
    const zipEntries: Record<string, string> = {};
    for (const entry of entries) {
      if (/\.(png|jpe?g|gif|webp)$/i.test(entry.path)) zipEntries[entry.path] = entry.data.toString("base64");
    }
    const primary = entries.find(entry => entry.path === htmlFiles[0])!;
    const html = primary.data.toString("utf8");
    const processed = processImportedHtml(html, "zip_upload", filename);
    const sessionId = randomUUID();
    await this.objects.put(`template-imports/${workspaceId}/${sessionId}.zip`, content);
    await this.objects.put(importSessionKey(workspaceId, sessionId), JSON.stringify({
      workspaceId,
      userId,
      method: "zip_upload",
      filename,
      originalSourceHtml: html,
      ...processed,
      htmlFileChoices: htmlFiles.length > 1 ? htmlFiles : undefined,
      zipEntries,
      createdAt: new Date().toISOString(),
    } satisfies ImportSessionPayload));
    return { sessionId, ...processed, htmlFileChoices: htmlFiles.length > 1 ? htmlFiles : undefined };
  }

  async processSession(workspaceId: string, userId: string, input: { sessionId: string; selectedHtmlFile?: string }): Promise<ImportProcessResult> {
    const session = await this.loadSession(workspaceId, input.sessionId);
    if (session.userId !== userId) throw new Error("IMPORT_SESSION_NOT_FOUND");
    let html = session.originalSourceHtml;
    if (input.selectedHtmlFile && session.method === "zip_upload") {
      const buffer = Buffer.from(await this.objects.get(`template-imports/${workspaceId}/${input.sessionId}.zip`));
      const entries = extractSafeZip(buffer);
      const selected = entries.find(entry => entry.path === input.selectedHtmlFile);
      if (!selected) throw new Error("IMPORT_HTML_FILE_NOT_FOUND");
      html = selected.data.toString("utf8");
    }
    const processed = processImportedHtml(html, session.method, session.filename);
    const next: ImportSessionPayload = { ...session, ...processed, originalSourceHtml: html, createdAt: new Date().toISOString() };
    await this.objects.put(importSessionKey(workspaceId, input.sessionId), JSON.stringify(next));
    return { sessionId: input.sessionId, ...processed, htmlFileChoices: session.htmlFileChoices };
  }

  private async uploadZipImages(workspaceId: string, userId: string, session: ImportSessionPayload, html: string): Promise<{ html: string; imported: number; warnings: ImportWarning[] }> {
    if (!session.zipEntries) return { html, imported: 0, warnings: [] };
    const mapping: Record<string, string> = {};
    const warnings: ImportWarning[] = [];
    let imported = 0;
    for (const [path, base64] of Object.entries(session.zipEntries)) {
      try {
        const bytes = Buffer.from(base64, "base64");
        if (bytes.byteLength > 2 * 1024 * 1024) {
          warnings.push({ code: "IMAGE_SKIPPED", severity: "warning", message: `${path.split("/").pop()} was skipped because it exceeds the image size limit.` });
          continue;
        }
        const assetId = randomUUID();
        const ext = path.split(".").pop()?.toLowerCase() ?? "png";
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
        const objectKey = `content-assets/${workspaceId}/${assetId}.${ext}`;
        await this.objects.put(objectKey, bytes);
        const url = this.assetUrl(workspaceId, assetId);
        await this.repo.createMediaAsset({ workspaceId, name: path.split("/").pop() ?? "Imported image", url, altText: "", mimeType: mime, actorId: userId, objectKey, assetId });
        mapping[path] = url;
        mapping[`./${path}`] = url;
        imported += 1;
      } catch {
        warnings.push({ code: "IMAGE_UPLOAD_FAILED", severity: "warning", message: `Could not import ${path.split("/").pop()}.` });
      }
    }
    return { html: rewriteImageSources(html, mapping), imported, warnings };
  }

  async saveImportedTemplate(workspaceId: string, userId: string, input: SaveImportedTemplateInput) {
    const session = await this.loadSession(workspaceId, input.sessionId);
    if (session.userId !== userId) throw new Error("IMPORT_SESSION_NOT_FOUND");
    let html = session.sanitizedHtml;
    const imageResult = await this.uploadZipImages(workspaceId, userId, session, html);
    html = sanitizeImportedHtml(imageResult.html).html;
    const warnings = [...session.warnings, ...imageResult.warnings];
    if (imageResult.imported) warnings.push({ code: "IMAGES_IMPORTED", severity: "warning", message: `${imageResult.imported} image${imageResult.imported === 1 ? "" : "s"} imported into your media library.` });

    const name = input.name.trim();
    if (!name || name.length > 160) throw new Error("TEMPLATE_NAME_INVALID");
    const category = input.category?.trim();
    if (category && category.length > 80) throw new Error("TEMPLATE_CATEGORY_INVALID");

    const saveAsHtml = input.saveMode === "html";
    const design = extractTemplateDesignFromHtml(html);
    let document = buildImportedHtmlDocument(html);
    let templateType: "imported_html" | "converted_import" = "imported_html";
    let conversionStatus: "not_requested" | "converted" | "partial" | "failed" = "not_requested";
    let conversionReport: ReturnType<typeof convertHtmlToBlocks>["report"] | undefined;
    if (!saveAsHtml) {
      const converted = convertHtmlToBlocks(html);
      document = ensureComplianceFooter(converted.document);
      templateType = "converted_import";
      conversionStatus = converted.report.customHtmlSections ? "partial" : "converted";
      conversionReport = converted.report;
      warnings.push(...converted.warnings);
    }

    const saved = await this.repo.createImportedEmailTemplate({
      workspaceId,
      name,
      category: category || undefined,
      document,
      subject: input.subject?.trim() || session.subjectSuggestion,
      preheader: input.preheader?.trim() || session.preheaderSuggestion,
      plainText: input.plainText?.trim() || session.plainText,
      settings: { templateType: saveAsHtml ? "html" : "email", trackingEnabled: true, plainTextMode: "manual", importSource: session.method, ...design },
      actorId: userId,
      templateType,
      importMethod: session.method,
      originalFilename: session.filename ?? null,
      originalSourceHtml: html,
      sanitizedHtml: html,
      conversionStatus,
      importWarnings: warnings,
      importedAt: new Date(),
      importedByUserId: userId,
    });

    await this.repo.recordTemplateImportAudit({
      workspaceId,
      userId,
      importMethod: session.method,
      filename: session.filename ?? null,
      templateId: saved.id,
      processingResult: conversionStatus,
      warningCount: warnings.length,
    });

    return { template: saved, warnings, conversionReport };
  }

  importReportFromTemplate(template: {
    templateType: string;
    importMethod: string | null;
    originalFilename: string | null;
    sanitizedHtml: string | null;
    conversionStatus: string;
    importWarnings: ImportWarning[] | null;
    importedAt: Date | null;
    importedByUserId: string | null;
  }) {
    return {
      templateType: template.templateType,
      importMethod: template.importMethod,
      originalFilename: template.originalFilename,
      conversionStatus: template.conversionStatus,
      warnings: template.importWarnings ?? [],
      importedAt: template.importedAt?.toISOString() ?? null,
      importedByUserId: template.importedByUserId,
      hasSanitizedHtml: Boolean(template.sanitizedHtml?.trim()),
    };
  }
}
