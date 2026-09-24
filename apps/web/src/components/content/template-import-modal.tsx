"use client";

import { type ChangeEvent, type DragEvent, useCallback, useMemo, useState } from "react";
import { phase1Api } from "../../lib/phase1-api";

type ImportMethod = "html" | "zip" | "paste";
type ImportStep = "method" | "process" | "review";
type PreviewMode = "desktop" | "mobile";

interface ImportWarning { code: string; severity: "warning" | "error"; message: string }
interface ImportStats { imagesImported: number; externalImages: number; buttonsDetected: number; linksDetected: number; unsupportedRemoved: number }
interface ImportResult {
  sessionId: string;
  previewHtml: string;
  sanitizedHtml: string;
  plainText: string;
  subjectSuggestion: string;
  preheaderSuggestion: string;
  warnings: ImportWarning[];
  stats: ImportStats;
  htmlFileChoices?: string[];
  conversionReport?: { blocksCreated: number; customHtmlSections: number; reviewSections: number };
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const stages = ["Uploading file", "Reading template", "Uploading images", "Cleaning unsupported code", "Checking email compatibility", "Creating preview"] as const;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const base64 = value.includes(",") ? value.split(",")[1] ?? "" : value;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplateImportModal({ workspaceId, onClose, onSaved, initialMethod = "paste", heading = "Import template", description = "Bring HTML from Klaviyo, Mailchimp, Kit, Brevo, Shopify Email, HubSpot, or any email tool." }: { workspaceId: string; onClose: () => void; onSaved: (templateId: string) => void; initialMethod?: ImportMethod; heading?: string; description?: string }) {
  const [step, setStep] = useState<ImportStep>("method");
  const [method, setMethod] = useState<ImportMethod>(initialMethod);
  const [file, setFile] = useState<File | null>(null);
  const [pasteHtml, setPasteHtml] = useState("");
  const [selectedHtmlFile, setSelectedHtmlFile] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [plainText, setPlainText] = useState("");
  const [editableWarnings, setEditableWarnings] = useState<ImportWarning[]>([]);

  const canContinueMethod = useMemo(() => {
    if (method === "paste") return pasteHtml.trim().length > 0;
    if (!file) return false;
    if (method === "html") return (/\.html?$/.test(file.name) || file.name.toLowerCase().endsWith(".eml")) && file.size <= MAX_HTML_BYTES;
    return file.name.toLowerCase().endsWith(".zip") && file.size <= MAX_ZIP_BYTES;
  }, [file, method, pasteHtml]);

  const runProcess = useCallback(async () => {
    setPending(true);
    setError("");
    setStep("process");
    setStageIndex(0);
    const timer = window.setInterval(() => setStageIndex(current => Math.min(current + 1, stages.length - 1)), 450);
    try {
      let response: ImportResult;
      if (method === "paste") {
        response = await phase1Api<ImportResult>(`/api/v1/workspaces/${workspaceId}/content/templates/import/paste`, { method: "POST", body: JSON.stringify({ html: pasteHtml }) });
      } else {
        if (!file) throw new Error("Choose a file to import.");
        if (method === "html" && file.size > MAX_HTML_BYTES) throw new Error("HTML files must be 5 MB or smaller.");
        if (method === "zip" && file.size > MAX_ZIP_BYTES) throw new Error("ZIP files must be 10 MB or smaller.");
        const contentBase64 = await readFileAsBase64(file);
        response = await phase1Api<ImportResult>(`/api/v1/workspaces/${workspaceId}/content/templates/import/upload`, {
          method: "POST",
          body: JSON.stringify({ filename: file.name, contentBase64, kind: method === "zip" ? "zip" : "html" }),
        });
      }
      if (response.htmlFileChoices?.length) setSelectedHtmlFile(response.htmlFileChoices[0] ?? "");
      setResult(response);
      setName(response.subjectSuggestion || "Imported template");
      setSubject(response.subjectSuggestion);
      setPreheader(response.preheaderSuggestion);
      setPlainText(response.plainText);
      setEditableWarnings(response.warnings);
      setStep("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import processing failed.");
      setStep("method");
    } finally {
      window.clearInterval(timer);
      setPending(false);
    }
  }, [file, method, pasteHtml, workspaceId]);

  async function reprocessSelectedHtml() {
    if (!result || !selectedHtmlFile) return;
    setPending(true);
    setError("");
    try {
      const response = await phase1Api<ImportResult>(`/api/v1/workspaces/${workspaceId}/content/templates/import/process`, {
        method: "POST",
        body: JSON.stringify({ sessionId: result.sessionId, selectedHtmlFile }),
      });
      setResult(response);
      setEditableWarnings(response.warnings);
      setPlainText(response.plainText);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to process the selected HTML file.");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    if (!result || !name.trim()) return;
    setPending(true);
    setError("");
    try {
      const saved = await phase1Api<{ template: { id: string } }>(`/api/v1/workspaces/${workspaceId}/content/templates/import/save`, {
        method: "POST",
        body: JSON.stringify({ sessionId: result.sessionId, name: name.trim(), category: category.trim() || undefined, saveMode: "html", subject, preheader, plainText }),
      });
      onSaved(saved.template.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save imported template.");
      setPending(false);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) return;
    setFile(dropped);
    setError("");
  }

  function onBrowse(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setError("");
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="modal template-import-modal" role="dialog" aria-modal="true" aria-labelledby="import-template-title">
      <header>
        <div>
          <h2 id="import-template-title">{heading}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {step === "method" && <>
        <div className="import-method-grid" role="list">
          {([
            { id: "html" as const, title: "Upload HTML file", description: "Import a .html, .htm, or .eml email export.", icon: "↑" },
            { id: "zip" as const, title: "Upload ZIP export", description: "Import HTML plus local images from a ZIP.", icon: "▣" },
            { id: "paste" as const, title: "Paste HTML code", description: "Copy exported HTML directly from your previous platform.", icon: "</>" },
          ]).map(option => <button type="button" key={option.id} role="listitem" className={`import-method-card ${method === option.id ? "active" : ""}`} onClick={() => { setMethod(option.id); setError(""); }}>
            <span className="import-method-icon" aria-hidden="true">{option.icon}</span>
            <strong>{option.title}</strong>
            <span>{option.description}</span>
          </button>)}
        </div>

        {method === "paste"
          ? <label className="import-paste-field">Paste email HTML<textarea rows={10} value={pasteHtml} onChange={event => setPasteHtml(event.target.value)} placeholder="Paste the full HTML of your email template here." /><span className="field-help">Export or copy the HTML of your email template from your previous platform, then paste it here.</span></label>
          : <label className="import-dropzone" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
              <input type="file" accept={method === "zip" ? ".zip" : ".html,.htm,.eml"} hidden onChange={onBrowse} />
              <strong>{file ? file.name : method === "zip" ? "Drag and drop a ZIP file" : "Drag and drop an HTML or .eml file"}</strong>
              <span>{file ? `${formatBytes(file.size)} · ${method === "html" ? "5 MB max" : "10 MB max"}` : "or browse files"}</span>
              {file && <button type="button" className="button-secondary import-file-change" onClick={event => { event.preventDefault(); setFile(null); }}>Remove file</button>}
            </label>}

        {error && <p className="import-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="button-primary" disabled={!canContinueMethod || pending} onClick={() => void runProcess()}>Continue</button>
        </footer>
      </>}

      {step === "process" && <section className="import-progress" aria-live="polite">
        <p>Processing your template…</p>
        <ol>{stages.map((stage, index) => <li key={stage} className={index <= stageIndex ? "done" : ""}>{stage}</li>)}</ol>
      </section>}

      {step === "review" && result && <>
        <div className="import-review-grid">
          <section className="import-preview-panel" aria-label="Imported email preview">
            <div className="preview-segmented" aria-label="Preview mode">
              <button type="button" className={previewMode === "desktop" ? "active" : ""} onClick={() => setPreviewMode("desktop")}>Desktop</button>
              <button type="button" className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}>Mobile</button>
            </div>
            <iframe title="Imported email preview" className={`import-preview-frame ${previewMode}`} sandbox="allow-same-origin" srcDoc={result.previewHtml} />
          </section>
          <section className="import-review-form">
            <label>Template name<input value={name} onChange={event => setName(event.target.value)} maxLength={160} required /></label>
            <p className="import-review-guidance">Review the rendered HTML and any warnings. You can edit the subject and preview text now or later in the editor.</p>
            <details className="import-optional-details"><summary>Optional email details</summary><div>
              <label>Category<input value={category} onChange={event => setCategory(event.target.value)} maxLength={80} /></label>
              <label>Default subject<input value={subject} onChange={event => setSubject(event.target.value)} /></label>
              <label>Preview text<input value={preheader} onChange={event => setPreheader(event.target.value)} /></label>
            </div></details>
            {result.htmlFileChoices && result.htmlFileChoices.length > 1 && <label>HTML file in ZIP<select value={selectedHtmlFile} onChange={event => setSelectedHtmlFile(event.target.value)}>{result.htmlFileChoices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select><button type="button" className="button-secondary" disabled={pending} onClick={() => void reprocessSelectedHtml()}>Use selected file</button></label>}
            <details className="import-summary" aria-label="Import summary"><summary>Import details</summary>
              <ul>
                <li>{result.stats.imagesImported} images imported</li>
                <li>{result.stats.buttonsDetected} buttons detected</li>
                <li>{result.stats.linksDetected} links detected</li>
                <li>{result.stats.unsupportedRemoved} unsupported elements removed</li>
                <li>{editableWarnings.length} warnings</li>
              </ul>
            </details>
            {editableWarnings.length > 0 && <section className="import-warnings"><h3>Review these warnings</h3><ul>{editableWarnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}</ul></section>}
          </section>
        </div>
        {error && <p className="import-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="button-secondary" disabled={pending} onClick={() => setStep("method")}>Back</button>
          <button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="button" className="button-primary" disabled={pending || !name.trim()} onClick={() => void save()}>Save &amp; edit template</button>
        </footer>
      </>}
    </section>
  </div>;
}

type NewTemplateEditor = "visual" | "text";

export function CreateTemplateChoiceModal({ workspaceId, onClose, onCreate, onOpenGallery, pending = false, error = "" }: { workspaceId: string; onClose: () => void; onCreate: (input: { name: string; category?: string; editorType: NewTemplateEditor }) => void; onOpenGallery: () => void; pending?: boolean; error?: string }) {
  const [editorType, setEditorType] = useState<NewTemplateEditor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  if (importOpen) return <TemplateImportModal workspaceId={workspaceId} initialMethod="html" heading="Import an HTML template" description="Upload a file, import a ZIP with images, or paste your HTML code. Review the result before saving." onClose={() => setImportOpen(false)} onSaved={id => { window.location.href = `/w/${workspaceId}/content/templates/${id}/edit`; }} />;
  return <div className="modal-backdrop" role="presentation">
    <section className={`modal template-choice-modal ${editorType ? "template-create-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="create-template-choice-title">
      <header><div><span className="template-modal-eyebrow">New template</span><h2 id="create-template-choice-title">{editorType ? "Start with a blank template" : "How would you like to start?"}</h2><p>{editorType ? "Choose a visual or simple text email, give it a name, and start editing." : "Pick a starting point. You can edit everything before using it in a campaign."}</p></div><button type="button" className="modal-close" disabled={pending} onClick={onClose} aria-label="Close">×</button></header>
      {!editorType ? <div className="template-choice-grid template-choice-grid-simple">
        <button type="button" className="template-choice-card" onClick={onOpenGallery}><span className="template-choice-icon" aria-hidden="true">✦</span><strong>Choose a design</strong><span>Customize an editable starter layout.</span></button>
        <button type="button" className="template-choice-card" onClick={() => setEditorType("visual")}><span className="template-choice-icon" aria-hidden="true">＋</span><strong>Start blank</strong><span>Build a visual email or write simple text.</span></button>
        <button type="button" className="template-choice-card" onClick={() => setImportOpen(true)}><span className="template-choice-icon" aria-hidden="true">⇪</span><strong>Import HTML</strong><span>Upload HTML, EML, ZIP, or paste code.</span></button>
      </div> : <form className="template-create-details" onSubmit={event => { event.preventDefault(); if (!pending && name.trim()) onCreate({ name: name.trim(), category: category.trim() || undefined, editorType }); }}>
        <fieldset className="template-editor-type-picker"><legend>Email format</legend><label className={editorType === "visual" ? "selected" : ""}><input type="radio" name="template-editor-type" checked={editorType === "visual"} onChange={() => setEditorType("visual")} /><strong>Visual</strong><span>Design with blocks and images</span></label><label className={editorType === "text" ? "selected" : ""}><input type="radio" name="template-editor-type" checked={editorType === "text"} onChange={() => setEditorType("text")} /><strong>Simple text</strong><span>Write a personal, text-first email</span></label></fieldset>
        <label><span>Template name <em>Required</em></span><input autoFocus value={name} maxLength={160} placeholder={editorType === "text" ? "e.g. Founder welcome note" : "e.g. September product announcement"} onChange={event => setName(event.target.value)} required /><small>Use a name your team will recognize in the template library.</small></label>
        <label><span>Category <em className="optional">Optional</em></span><input value={category} maxLength={80} placeholder="e.g. Newsletter, Promotion, Lifecycle" onChange={event => setCategory(event.target.value)} /><small>Categories make templates easier to find and reuse.</small></label>
        {error && <p className="import-error" role="alert">{error}</p>}
        <footer><button type="button" className="template-back-button" disabled={pending} onClick={() => setEditorType(null)}>← Back</button><div><button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" className="button-primary" disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create template"}</button></div></footer>
      </form>}
    </section>
  </div>;
}
