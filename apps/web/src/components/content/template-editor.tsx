"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComplianceFooterBlock, ContentBlock, PreflightIssue, StructuredEmailDocument } from "../../../../../packages/domain/src/phase2/content";
import { DocumentBuilder, FooterInspector, FooterPreview, type MessageSettings, type PreviewMode, type TemplateDesignSettings } from "./document-builder";
import { PlainTextEditorPanel } from "./inbox-metadata-bar";
import { phase1Api } from "../../lib/phase1-api";
import { buildImportedHtmlDocument } from "../../lib/template-document-utils";

interface Template {
  id: string;
  name: string;
  category: string | null;
  document: StructuredEmailDocument;
  subject: string;
  preheader: string;
  plainText: string;
  settings: Record<string, unknown> | null;
  editorType?: "visual" | "html" | "text";
  templateType?: string;
  importMethod?: string | null;
  originalFilename?: string | null;
  originalSourceHtml?: string | null;
  importedAt?: string | null;
  sanitizedHtml?: string | null;
}
interface Variable { key: string; label: string; requiresFallback: boolean }
interface TemplateVersion { id: string; versionNumber: number; approvedAt: string; contentHash: string }
interface Usage { id: string; usageType: "email" | "flow"; label: string; createdAt: string }
interface UniversalBlock { id: string; name: string; blocks: ContentBlock[] }
interface MediaAsset { id: string; name: string; url: string; altText: string }
interface BrandKit { primaryColor: string; secondaryColor: string; logoUrl: string | null; fontFamily: TemplateDesignSettings["fontFamily"] }

function getTemplateNotes(settings: Record<string, unknown> | null): string {
  const value = settings?.notes;
  return typeof value === "string" ? value : "";
}
function templateSettingString(settings: Record<string, unknown> | null, key: string): string { const value = settings?.[key]; return typeof value === "string" ? value : ""; }
function templateTags(settings: Record<string, unknown> | null): string { const value = settings?.tags; return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string").join(", ") : ""; }
function templateDesignSettings(settings: Record<string, unknown> | null): TemplateDesignSettings {
  const value = settings ?? {};
  const string = (key: string) => typeof value[key] === "string" ? value[key] as string : undefined;
  const number = (key: string) => typeof value[key] === "number" ? value[key] as number : undefined;
  const colors = Array.isArray(value.recentColors) ? value.recentColors.filter((color): color is string => typeof color === "string") : undefined;
  const font = string("fontFamily");
  return { backgroundColor: string("backgroundColor"), bodyBackgroundColor: string("bodyBackgroundColor"), emailWidth: number("emailWidth"), fontFamily: font === "Arial, sans-serif" || font === "Helvetica, Arial, sans-serif" || font === "Georgia, serif" ? font : undefined, headingFontSize: number("headingFontSize"), bodyFontSize: number("bodyFontSize"), buttonRadius: number("buttonRadius"), defaultLinkColor: string("defaultLinkColor"), spacingScale: string("spacingScale"), logoUrl: string("logoUrl"), footerStyle: string("footerStyle"), recentColors: colors };
}

export function TemplateEditor({ workspaceId, templateId }: { workspaceId: string; templateId: string }) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [universalBlocks, setUniversalBlocks] = useState<UniversalBlock[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [issues, setIssues] = useState<PreflightIssue[]>([]);
  const [focusMessageTabKey, setFocusMessageTabKey] = useState(0);
  const [importHtmlOpen, setImportHtmlOpen] = useState(false);
  const [footerOpen, setFooterOpen] = useState(false);
  const [importHtmlValue, setImportHtmlValue] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingImportedHtml = useRef<string | null>(null);
  const [history, setHistory] = useState<{ past: Template[]; future: Template[] }>({ past: [], future: [] });

  const load = useCallback(async () => {
    try {
      const [templateResponse, variableResponse, blockResponse, mediaResponse, versionResponse, usageResponse, brandResponse] = await Promise.all([
        phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}`),
        phase1Api<{ items: Variable[] }>(`/api/v1/workspaces/${workspaceId}/content/variables`),
        phase1Api<{ items: UniversalBlock[] }>(`/api/v1/workspaces/${workspaceId}/content/universal-blocks`),
        phase1Api<{ items: MediaAsset[] }>(`/api/v1/workspaces/${workspaceId}/content/media`),
        phase1Api<{ items: TemplateVersion[] }>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/versions`),
        phase1Api<{ items: Usage[] }>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/usage`),
        phase1Api<BrandKit | null>(`/api/v1/workspaces/${workspaceId}/content/brand-kit`),
      ]);
      setTemplate(templateResponse);
      setPreviewMode(templateResponse.editorType === "text" ? "plain" : "desktop");
      setVariables(variableResponse.items);
      setUniversalBlocks(blockResponse.items);
      setMediaAssets(mediaResponse.items);
      setVersions(versionResponse.items);
      setUsage(usageResponse.items);
      setBrandKit(brandResponse);
      setDirty(false);
      setHistory({ past: [], future: [] });
      setStatus("Saved");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to load template.");
    }
  }, [templateId, workspaceId]);

  useEffect(() => {
    void load();
    return () => { if (timer.current) clearTimeout(timer.current); if (sourceTimer.current) clearTimeout(sourceTimer.current); };
  }, [load]);

  const saveContent = useCallback(async (current: Template) => {
    setSaving(true);
    setStatus("Saving…");
    try {
      const saved = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/content`, {
        method: "PATCH",
        body: JSON.stringify({
          document: current.document,
          subject: current.subject,
          preheader: current.preheader,
          plainText: current.plainText,
          settings: current.settings,
        }),
      });
      setTemplate(active => active?.id === current.id ? saved : active);
      setDirty(false);
      setStatus("Saved");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [templateId, workspaceId]);

  const queueSave = (next: Template) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveContent(next), 700);
  };

  const saveImportedSource = useCallback(async (current: Template, html: string) => {
    setSaving(true);
    setStatus("Saving original HTML…");
    try {
      const saved = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/content`, {
        method: "PATCH",
        body: JSON.stringify({
          document: buildImportedHtmlDocument(html, current.document),
          subject: current.subject,
          preheader: current.preheader,
          plainText: current.plainText,
          settings: current.settings,
          importedHtml: html,
        }),
      });
      setTemplate(active => active?.id === current.id ? saved : active);
      setDirty(false);
      setStatus("Saved");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to save original HTML.");
    } finally {
      setSaving(false);
    }
  }, [templateId, workspaceId]);

  const changeImportedSource = useCallback((html: string) => {
    if (!template) return;
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    pendingImportedHtml.current = html;
    setDirty(true);
    setStatus("Unsaved original HTML changes");
    sourceTimer.current = setTimeout(() => void saveImportedSource(template, html), 700);
  }, [saveImportedSource, template]);

  const change = (next: Template) => {
    if (template) setHistory(current => ({ past: [...current.past, template].slice(-50), future: [] }));
    setTemplate(next);
    setDirty(true);
    queueSave(next);
  };

  const saveMetadata = async (current = template) => {
    if (!current) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const saved = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: current.name, category: current.category }),
      });
      setTemplate(saved);
      setDirty(false);
      setStatus("Saved");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Metadata save failed.");
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    if (!template || !history.past.length) return;
    const previous = history.past[history.past.length - 1]!;
    setHistory(current => ({ past: current.past.slice(0, -1), future: [template, ...current.future].slice(0, 50) }));
    setTemplate(previous);
    setDirty(true);
    queueSave(previous);
  };
  const redo = () => {
    if (!template || !history.future.length) return;
    const next = history.future[0]!;
    setHistory(current => ({ past: [...current.past, template].slice(-50), future: current.future.slice(1) }));
    setTemplate(next);
    setDirty(true);
    queueSave(next);
  };
  const updateMessageSettings = (patch: Partial<MessageSettings>) => {
    if (!template) return;
    const nextSettings = { ...(template.settings ?? {}) };
    if (patch.notes !== undefined) nextSettings.notes = patch.notes;
    if (patch.templateType !== undefined) nextSettings.templateType = patch.templateType;
    if (patch.useCase !== undefined) nextSettings.useCase = patch.useCase;
    if (patch.tags !== undefined) nextSettings.tags = patch.tags.split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 12);
    const next = { ...template, subject: patch.subject ?? template.subject, preheader: patch.preheader ?? template.preheader, plainText: patch.plainText ?? template.plainText, category: patch.category === undefined ? template.category : patch.category, settings: nextSettings };
    change(next);
    if (patch.category !== undefined) void saveMetadata(next);
  };

  const preflight = async () => {
    try {
      const result = await phase1Api<{ issues: PreflightIssue[]; ok: boolean }>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/preflight`, { method: "POST" });
      setIssues(result.issues);
      setStatus(result.ok ? "Template preflight passed" : "Template preflight needs attention");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Preflight failed.");
    }
  };

  const createCampaign = async () => {
    if (!template) return;
    if (timer.current) clearTimeout(timer.current);
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    try {
      setSaving(true);
      setStatus("Preparing campaign…");
      const importedHtml = pendingImportedHtml.current;
      const savedContent = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/content`, {
        method: "PATCH",
        body: JSON.stringify({
          document: importedHtml === null ? template.document : buildImportedHtmlDocument(importedHtml, template.document),
          subject: template.subject,
          preheader: template.preheader,
          plainText: template.plainText,
          settings: template.settings,
          ...(importedHtml === null ? {} : { importedHtml }),
        }),
      });
      setTemplate({ ...savedContent, name: template.name, category: template.category });
      pendingImportedHtml.current = null;
      const savedMetadata = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: template.name, category: template.category }),
      });
      setTemplate(savedMetadata);
      setDirty(false);
      const content = JSON.stringify({ document: savedContent.document, subject: savedContent.subject, preheader: savedContent.preheader, plainText: savedContent.plainText, settings: savedContent.settings });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (versions[0]?.contentHash !== contentHash) {
        await phase1Api(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/approve`, { method: "POST" });
      }
      const email = await phase1Api<{ id: string }>(`/api/v1/workspaces/${workspaceId}/content/templates/${template.id}/create-campaign`, { method: "POST", body: JSON.stringify({ internalName: `${template.name.slice(0, 151)} campaign` }) });
      window.location.href = `/w/${workspaceId}/content/emails/${email.id}/edit`;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to create campaign draft.";
      if (message.includes("TEMPLATE_PREFLIGHT_BLOCKED")) {
        const result = await phase1Api<{ issues: PreflightIssue[] }>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/preflight`, { method: "POST" }).catch(() => null);
        if (result) setIssues(result.issues);
        setStatus("Needs attention");
      } else setStatus(message);
      setSaving(false);
    }
  };

  const applyImportedHtml = async () => {
    if (!template || !importHtmlValue.trim()) return;
    setSaving(true);
    try {
      const processed = await phase1Api<{ sanitizedHtml: string; plainText: string; subjectSuggestion: string; preheaderSuggestion: string }>(`/api/v1/workspaces/${workspaceId}/content/templates/import/paste`, { method: "POST", body: JSON.stringify({ html: importHtmlValue }) });
      const saved = await phase1Api<Template>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/content`, {
        method: "PATCH",
        body: JSON.stringify({
          document: buildImportedHtmlDocument(processed.sanitizedHtml, template.document),
          subject: template.subject || processed.subjectSuggestion,
          preheader: template.preheader || processed.preheaderSuggestion,
          plainText: processed.plainText || template.plainText,
          settings: { ...(template.settings ?? {}), templateType: "html" },
          importedHtml: processed.sanitizedHtml,
        }),
      });
      setTemplate(saved);
      setDirty(false);
      setHistory({ past: [], future: [] });
      setImportHtmlOpen(false);
      setImportHtmlValue("");
      setStatus("Imported HTML saved. Viewing the original layout.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "HTML import failed.");
    } finally {
      setSaving(false);
    }
  };

  const exportHtml = async () => {
    if (!template) return;
    try {
      const exported = await phase1Api<{ filename: string; html: string }>(`/api/v1/workspaces/${workspaceId}/content/templates/${templateId}/export-html`, { method: "POST", body: "{}" });
      const blob = new Blob([exported.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Export failed.");
    }
  };

  if (!template) {
    return <section className="template-editor-loading" aria-live="polite">
      <div className="loading-shimmer loading-shimmer-title" />
      <div className="loading-shimmer loading-shimmer-body" />
      <p>{status}</p>
    </section>;
  }

  const hasApprovedVersion = versions.length > 0;
  const saveLabel = saving ? "Autosaving" : dirty ? "Unsaved changes" : status === "Saved" ? "Saved" : status;
  const sourceHtml = template.originalSourceHtml?.trim() || template.sanitizedHtml?.trim() || "";
  const hasImportedSource = Boolean(sourceHtml && (template.templateType === "imported_html" || template.importMethod));
  const footerBlock: ComplianceFooterBlock = template.document.blocks.find((block): block is ComplianceFooterBlock => block.type === "compliance_footer") ?? { id: "compliance", type: "compliance_footer", locked: true };
  const updateFooter = (next: ComplianceFooterBlock) => {
    const updated = { ...template, document: { schemaVersion: 1 as const, blocks: [...template.document.blocks.filter(block => block.type !== "compliance_footer"), next] } };
    if (!hasImportedSource) { change(updated); return; }
    if (timer.current) clearTimeout(timer.current);
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    const html = pendingImportedHtml.current ?? sourceHtml;
    pendingImportedHtml.current = html;
    setTemplate(updated);
    setDirty(true);
    setStatus("Unsaved footer changes");
    sourceTimer.current = setTimeout(() => void saveImportedSource(updated, html), 700);
  };
  const openHtmlEditor = (html = sourceHtml) => {
    setImportHtmlValue(html);
    setImportHtmlOpen(true);
  };

  return <section className="template-editor-page">
    <header className="template-topbar">
      <div className="template-heading">
        <nav className="template-breadcrumb" aria-label="Breadcrumb">
          <a className="editor-back-link" href={`/w/${workspaceId}/content/templates`} aria-label="Back to templates">←</a>
          <a href={`/w/${workspaceId}/content/templates`}>Email templates</a><span>/</span>
          <strong>Design</strong>
        </nav>
        <div className="template-title-row">
          <input className="template-name-input" aria-label="Template name" value={template.name} style={{ width: `calc(${Math.max(2, Math.min(30, template.name.length + 1))}ch + 12px)` }} maxLength={160}
            onChange={event => { setTemplate({ ...template, name: event.target.value }); setDirty(true); }}
            onBlur={() => void saveMetadata()} />
          <span className={`template-save-state ${saving ? "is-saving" : dirty ? "is-dirty" : ""}`} role="status">{saveLabel}</span>
          <span className={`template-status-badge ${hasApprovedVersion ? "is-approved" : ""}`}>{hasApprovedVersion ? "Approved" : "Draft"}</span>
        </div>
      </div>
      <div className="editor-mode-tabs" aria-label="Editor mode">
        <div className="preview-segmented editor-view-switcher" aria-label="Email preview mode">
          {(["desktop", "mobile", "plain"] as PreviewMode[]).map(mode => <button key={mode} type="button" className={previewMode === mode ? "active" : ""} onClick={() => setPreviewMode(mode)}>{mode === "desktop" ? "Desktop" : mode === "plain" ? "Plain text" : "Mobile"}</button>)}
        </div>
      </div>
      <div className="template-top-actions">
        <div className="template-history-actions" aria-label="Editing history">
          <button type="button" className="premium-button premium-button-icon" disabled={!history.past.length || saving} title={history.past.length ? "Undo last editor change" : "Nothing to undo"} aria-label="Undo" onClick={undo}>↶</button>
          <button type="button" className="premium-button premium-button-icon" disabled={!history.future.length || saving} title={history.future.length ? "Redo last editor change" : "Nothing to redo"} aria-label="Redo" onClick={redo}>↷</button>
        </div>
        <button
          type="button"
          className={`premium-button premium-button-secondary message-settings-action${!template.subject.trim() || !template.plainText.trim() ? " needs-attention" : ""}`}
          title="Edit subject, preview text, and plain-text body"
          onClick={() => {
            if (previewMode === "plain" || hasImportedSource || template.editorType === "text") setPreviewMode("plain");
            else setFocusMessageTabKey(key => key + 1);
          }}
        >
          <span aria-hidden="true">✉</span> Subject &amp; message
        </button>
        <button type="button" className="premium-button premium-button-secondary" disabled={saving} onClick={() => void preflight()}>Preflight</button>
        <button type="button" className="premium-button premium-button-secondary" onClick={() => setFooterOpen(true)}>Footer</button>
        <details className="editor-more-menu">
          <summary className="premium-button premium-button-icon" aria-label="More template actions" title="More template actions">•••</summary>
          <div className="editor-more-popover">
            <button type="button" onClick={hasImportedSource ? () => openHtmlEditor() : () => setImportHtmlOpen(true)}>{hasImportedSource ? "Edit source HTML" : "Import HTML"}</button>
            <button type="button" onClick={() => void exportHtml()}>Export HTML</button>
          </div>
        </details>
        <button type="button" className="premium-button premium-button-primary template-campaign-button" disabled={saving} title="Save this template and open a campaign draft" onClick={() => void createCampaign()}>Create campaign</button>
      </div>
    </header>

    {hasApprovedVersion && <p className="approved-note">The latest approved version is locked; any changes here remain a new draft.</p>}

    <div className="template-editor-workspace">
      {previewMode === "plain"
        ? <PlainTextEditorPanel subject={template.subject} preheader={template.preheader} plainText={template.plainText} variables={variables} onMetadataChange={updateMessageSettings} onChange={plainText => updateMessageSettings({ plainText })} />
        : template.editorType === "text"
          ? <SimpleTextEmailPreview templateName={template.name} subject={template.subject} preheader={template.preheader} plainText={template.plainText} previewMode={previewMode} footer={footerBlock} workspaceId={workspaceId} onEditFooter={() => setFooterOpen(true)} />
        : hasImportedSource && sourceHtml
          ? <ImportedHtmlCanvas html={sourceHtml} previewMode={previewMode} onChange={changeImportedSource} onOpenHtmlEditor={openHtmlEditor} footer={footerBlock} workspaceId={workspaceId} onEditFooter={() => setFooterOpen(true)} />
          : <DocumentBuilder workspaceId={workspaceId} document={template.document} variables={variables} universalBlocks={universalBlocks} mediaAssets={mediaAssets} previewMode={previewMode} templateSettings={templateDesignSettings(template.settings)} brandColors={[brandKit?.primaryColor, brandKit?.secondaryColor].filter((color): color is string => typeof color === "string")} messageSettings={{ subject: template.subject, preheader: template.preheader, plainText: template.plainText, category: template.category, notes: getTemplateNotes(template.settings), templateType: templateSettingString(template.settings, "templateType"), useCase: templateSettingString(template.settings, "useCase"), tags: templateTags(template.settings) }} onMessageSettingsChange={updateMessageSettings} onTemplateSettingsChange={settings => change({ ...template, settings: { ...(template.settings ?? {}), ...settings } })} onChange={document => change({ ...template, document })} focusMessageTabKey={focusMessageTabKey} />}
    </div>

    {issues.length > 0 && <section className="preflight-notice" aria-live="polite"><strong>Preflight results</strong>{issues.some(issue => /subject|preview|plain.?text/i.test(issue.message)) && <p className="preflight-hint">Add the <strong>subject line</strong> and <strong>preview text</strong> above the canvas. Add <strong>plain text</strong> in the Plain text tab.</p>}{issues.map(issue => <p key={`${issue.code}:${issue.path}`}><span className={issue.severity}>{issue.severity}</span>{issue.message}</p>)}<button type="button" className="button-secondary" onClick={() => { if (issues.some(issue => /plain.?text/i.test(issue.message))) setPreviewMode("plain"); else setFocusMessageTabKey(key => key + 1); }}>Fix inbox settings</button></section>}
    {footerOpen && <div className="modal-backdrop" role="presentation"><section className="modal footer-editor-modal" role="dialog" aria-modal="true" aria-label="Required email footer"><header><div><h2>Required footer</h2><p>Applies to this template and campaigns created from it.</p></div><button type="button" className="modal-close" onClick={() => setFooterOpen(false)}>×</button></header><FooterInspector block={footerBlock} workspaceId={workspaceId} onChange={updateFooter} /><footer><button type="button" className="button-primary" onClick={() => setFooterOpen(false)}>Done</button></footer></section></div>}
    {importHtmlOpen && <div className="modal-backdrop" role="presentation"><section className="modal template-form-modal" role="dialog" aria-modal="true" aria-labelledby="editor-import-html-title"><header><div><h2 id="editor-import-html-title">{hasImportedSource ? "Edit template HTML" : "Import HTML"}</h2><p>{hasImportedSource ? "Edit the source while retaining the template’s original layout, styling, and responsive rules." : "Paste exported HTML to replace the current template draft."}</p></div><button type="button" className="modal-close" onClick={() => setImportHtmlOpen(false)}>×</button></header><label>{hasImportedSource ? "Template HTML" : "Paste email HTML"}<textarea rows={12} value={importHtmlValue} onChange={event => setImportHtmlValue(event.target.value)} /></label><footer><button type="button" className="button-secondary" onClick={() => setImportHtmlOpen(false)}>Cancel</button><button type="button" className="button-primary" disabled={!importHtmlValue.trim() || saving} onClick={() => { if (window.confirm(hasImportedSource ? "Save these changes to the template HTML?" : "Replace the current canvas with this imported HTML?")) void applyImportedHtml(); }}>{hasImportedSource ? "Save HTML" : "Import HTML"}</button></footer></section></div>}
  </section>;
}

function SimpleTextEmailPreview({ templateName, subject, preheader, plainText, previewMode, footer, workspaceId, onEditFooter }: { templateName: string; subject: string; preheader: string; plainText: string; previewMode: Exclude<PreviewMode, "plain">; footer: ComplianceFooterBlock; workspaceId: string; onEditFooter: () => void }) {
  const mobile = previewMode === "mobile";
  const paragraphs = plainText.trim() ? plainText.trim().split(/\n{2,}/) : [];
  return <main className="simple-text-preview-stage" aria-label={`${mobile ? "Mobile" : "Desktop"} email preview`}>
    <div className={`simple-text-preview-frame${mobile ? " is-mobile" : ""}`}>
      <section className="simple-text-inbox-summary" aria-label="Inbox preview">
        <span className="simple-text-inbox-icon" aria-hidden="true">✉</span>
        <div className="simple-text-inbox-copy">
          <span>Inbox preview</span>
          <strong>{subject.trim() || "Your subject line"}</strong>
          <p>{preheader.trim() || "Add preview text to support your subject."}</p>
        </div>
        <span className="simple-text-device-badge"><i aria-hidden="true">{mobile ? "▯" : "▭"}</i>{mobile ? "Mobile" : "Desktop"} · {mobile ? "390" : "640"}px</span>
      </section>
      <div className="simple-text-preview-label">
        <span>Email preview</span>
        <span>{templateName}</span>
      </div>
      <article className={`simple-text-email-preview${mobile ? " is-mobile" : ""}`}>
        {paragraphs.length
          ? <div className="simple-text-preview-body">{paragraphs.map((paragraph, index) => <p key={`${index}:${paragraph.slice(0, 16)}`}>{paragraph}</p>)}</div>
          : <div className="simple-text-preview-empty"><span aria-hidden="true">✉</span><strong>Your email body is empty</strong><p>Open Plain text to write the message recipients will read.</p></div>}
        <div className="simple-text-preview-footer"><FooterPreview block={footer} workspaceId={workspaceId} onClick={onEditFooter} /></div>
      </article>
    </div>
  </main>;
}

type SourceElementType = "heading" | "text" | "divider" | "spacer" | "columns" | "list" | "header" | "footer" | "image_text";
type SourceElementTab = "blocks" | "sections" | "saved";

const sourceElementCards: ReadonlyArray<{ type: SourceElementType | "image" | "button" | "social" | "html"; label: string; icon: string; description: string }> = [
  { type: "heading", label: "Heading", icon: "H", description: "Section headline" },
  { type: "text", label: "Text", icon: "T", description: "Paragraph copy" },
  { type: "image", label: "Image", icon: "▧", description: "Image URL" },
  { type: "image_text", label: "Image & text", icon: "▤", description: "Two-column row" },
  { type: "html", label: "Video", icon: "▶", description: "Video embed" },
  { type: "button", label: "Button", icon: "↗", description: "Call to action" },
  { type: "divider", label: "Divider", icon: "—", description: "Visual separator" },
  { type: "list", label: "List", icon: "☷", description: "Bullet list" },
  { type: "html", label: "Countdown", icon: "◷", description: "Timed offer" },
  { type: "social", label: "Social links", icon: "◎", description: "Link destinations" },
  { type: "header", label: "Header", icon: "⌁", description: "Email masthead" },
  { type: "footer", label: "Footer", icon: "∨", description: "Content footer" },
  { type: "columns", label: "Columns", icon: "▥", description: "Multi-column row" },
  { type: "spacer", label: "Spacer", icon: "↕", description: "Vertical space" },
];

const sourceSectionCards: ReadonlyArray<{ type: SourceElementType | "html"; label: string; icon: string; description: string }> = [
  { type: "header", label: "Header", icon: "⌁", description: "Brand masthead" },
  { type: "heading", label: "Hero", icon: "✦", description: "Headline section" },
  { type: "columns", label: "Feature row", icon: "▥", description: "Two-column feature" },
  { type: "html", label: "CTA section", icon: "↗", description: "Button and link" },
  { type: "list", label: "Benefits", icon: "☷", description: "Benefit list" },
  { type: "footer", label: "Footer", icon: "∨", description: "Content footer" },
];

const sourceElementMarkup: Record<SourceElementType, string> = {
  heading: '<h2 style="margin:32px 0 14px;color:#151515;font:700 28px/1.2 Arial,Helvetica,sans-serif;">New heading</h2>',
  text: '<p style="margin:0 0 18px;color:#3f3f3f;font:16px/1.6 Arial,Helvetica,sans-serif;">Write your message here.</p>',
  divider: '<hr style="margin:28px 0;border:0;border-top:1px solid #dedede;">',
  spacer: '<div style="height:28px;line-height:28px;font-size:1px;">&nbsp;</div>',
  columns: '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td width="50%" valign="top" style="padding:0 12px 0 0;color:#3f3f3f;font:16px/1.5 Arial,Helvetica,sans-serif;">First column</td><td width="50%" valign="top" style="padding:0 0 0 12px;color:#3f3f3f;font:16px/1.5 Arial,Helvetica,sans-serif;">Second column</td></tr></table>',
  list: '<ul style="margin:0 0 20px;padding-left:24px;color:#3f3f3f;font:16px/1.7 Arial,Helvetica,sans-serif;"><li>First item</li><li>Second item</li><li>Third item</li></ul>',
  header: '<div style="margin:0 0 28px;padding:18px 0;border-bottom:1px solid #e5e5e5;color:#151515;font:700 20px/1.2 Arial,Helvetica,sans-serif;">Your brand</div>',
  footer: '<div style="margin:32px 0 0;padding:20px 0;border-top:1px solid #e5e5e5;color:#6b6b6b;font:13px/1.5 Arial,Helvetica,sans-serif;">Your company footer</div>',
  image_text: '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td width="50%" valign="top" style="padding:0 12px 0 0;color:#3f3f3f;font:16px/1.5 Arial,Helvetica,sans-serif;"><strong>Image area</strong><br>Use Edit HTML to set the real image URL.</td><td width="50%" valign="top" style="padding:0 0 0 12px;color:#3f3f3f;font:16px/1.5 Arial,Helvetica,sans-serif;"><strong>Supporting copy</strong><br>Add a short product benefit here.</td></tr></table>',
};

function ImportedHtmlCanvas({ html, previewMode, onChange, onOpenHtmlEditor, footer, workspaceId, onEditFooter }: { html: string; previewMode: Exclude<PreviewMode, "plain">; onChange: (html: string) => void; onOpenHtmlEditor: (html?: string) => void; footer: ComplianceFooterBlock; workspaceId: string; onEditFooter: () => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const lastSource = useRef(html);
  const [libraryTab, setLibraryTab] = useState<SourceElementTab>("blocks");
  const [selectedCard, setSelectedCard] = useState<{ label: string; description: string } | null>(null);
  useEffect(() => { lastSource.current = html; }, [html]);

  const serialise = (document: Document): string => {
    document.body.removeAttribute("contenteditable");
    document.body.removeAttribute("spellcheck");
    const next = `<!doctype html>${document.documentElement.outerHTML}`;
    document.body.contentEditable = "true";
    document.body.spellcheck = true;
    return next;
  };
  const publish = (document: Document) => {
    const next = serialise(document);
    if (next !== lastSource.current) {
      lastSource.current = next;
      onChange(next);
    }
  };
  const enableEditing = () => {
    const document = frame.current?.contentDocument;
    if (!document?.body) return;
    document.body.contentEditable = "true";
    document.body.spellcheck = true;
    document.body.addEventListener("input", () => publish(document));
  };
  const addElement = (card: { type: SourceElementType | "image" | "button" | "social" | "html"; label: string; description: string }) => {
    const { type } = card;
    setSelectedCard({ label: card.label, description: card.description });
    if (type === "image" || type === "button" || type === "social" || type === "html") {
      const document = frame.current?.contentDocument;
      if (document?.body) {
        const current = serialise(document);
        lastSource.current = current;
        onChange(current);
        onOpenHtmlEditor(current);
      } else onOpenHtmlEditor();
      return;
    }
    const document = frame.current?.contentDocument;
    if (!document?.body) return;
    document.body.insertAdjacentHTML("beforeend", sourceElementMarkup[type]);
    publish(document);
  };

  return <section className="imported-html-workspace" aria-label={`${previewMode} imported HTML editor`}>
    <aside id="content-block-library" className="source-element-library" aria-label="Add elements">
      <div><span className="library-kicker">Add</span><h2>Elements</h2><p>Combine elements to build your email.</p></div>
      <div className="source-element-tabs" role="tablist" aria-label="Element library"><button type="button" role="tab" aria-selected={libraryTab === "blocks"} className={libraryTab === "blocks" ? "active" : ""} onClick={() => setLibraryTab("blocks")}>Blocks</button><button type="button" role="tab" aria-selected={libraryTab === "sections"} className={libraryTab === "sections" ? "active" : ""} onClick={() => setLibraryTab("sections")}>Sections</button><button type="button" role="tab" aria-selected={libraryTab === "saved"} className={libraryTab === "saved" ? "active" : ""} onClick={() => setLibraryTab("saved")}>Saved</button></div>
      {libraryTab === "saved" ? <p className="source-element-empty">Saved blocks are not available for imported HTML yet. Use <b>Edit HTML</b> to reuse your own markup safely.</p> : <div className="source-element-grid">{(libraryTab === "blocks" ? sourceElementCards : sourceSectionCards).map((card, index) => <button type="button" key={`${card.type}:${card.label}:${index}`} className="source-element-card" title={card.type === "image" || card.type === "button" || card.type === "social" || card.type === "html" ? "Opens Edit HTML so you can supply the real URL or markup." : `Add ${card.label}`} onClick={() => addElement(card)}><i aria-hidden="true">⠿</i><span>{card.icon}</span><strong>{card.label}</strong><small>{card.description}</small></button>)}</div>}
      {selectedCard && <section className="source-element-inspector"><div><span>{selectedCard.label.slice(0, 1)}</span><h3>{selectedCard.label}</h3><p>{selectedCard.description}</p></div><p>Click content in the canvas to edit it. Use Edit HTML for detailed settings, URLs, and styles.</p><button type="button" onClick={() => { const document = frame.current?.contentDocument; onOpenHtmlEditor(document?.body ? serialise(document) : undefined); }}>Edit HTML</button></section>}
      <p className="source-element-help">Click existing text to edit it. Use <b>Edit HTML</b> for images, buttons, links, and advanced styling.</p>
    </aside>
    <div className="imported-html-stage">
      <div className="imported-html-stage-label"><span>Template canvas · click text to edit</span><span>{previewMode === "mobile" ? "390px mobile" : "Desktop editor"}</span></div>
      <iframe ref={frame} title={`Imported HTML ${previewMode} editor`} className={`imported-html-frame ${previewMode}`} sandbox="allow-same-origin" srcDoc={html} onLoad={enableEditing} />
      <div className={`imported-html-footer-preview ${previewMode}`}><FooterPreview block={footer} workspaceId={workspaceId} onClick={onEditFooter} /></div>
    </div>
  </section>;
}
