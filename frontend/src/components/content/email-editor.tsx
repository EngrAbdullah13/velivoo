"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComplianceFooterBlock, EmailDraft, PreflightIssue } from "../../../../packages/domain/src/phase2/content";
import { DocumentBuilder, FooterInspector, type PreviewMode } from "./document-builder";
import { PlainTextEditorPanel } from "./inbox-metadata-bar";
import { inboxPersonalizationVariables, personalizationToken, PersonalizationPicker, type PersonalizationVariable } from "./personalization-picker";
import { phase1Api } from "../../lib/phase1-api";

interface Sender { id: string; fromName: string; fromEmail: string; replyTo?: string }
interface Version { id: string; versionNumber: number; publishedAt: string }
interface Dependency { id: string; flowId: string; nodeId: string }
interface Profile { id: string; firstName?: string | null; lastName?: string | null; originalEmail: string }
type Variable = PersonalizationVariable;
interface Preview { html: string; text: string }
type CampaignPanel = "settings" | "footer" | "preview" | "preflight" | "history" | null;

const profileName = (profile: Profile) => `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || profile.originalEmail;

export function EmailEditor({ workspaceId, emailId }: { workspaceId: string; emailId: string }) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [issues, setIssues] = useState<PreflightIssue[]>([]);
  const [status, setStatus] = useState("Loading…");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [activePanel, setActivePanel] = useState<CampaignPanel>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileQuery, setProfileQuery] = useState("");
  const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [templateName, setTemplateName] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);

  const load = useCallback(async () => {
    try {
      const [email, senderResponse, versionResponse, dependencyResponse, variableResponse] = await Promise.all([
        phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`),
        phase1Api<{ items: Sender[] }>(`/api/v1/workspaces/${workspaceId}/sender-identities`),
        phase1Api<{ items: Version[] }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/versions`),
        phase1Api<{ items: Dependency[] }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/flow-dependencies`),
        phase1Api<{ items: Variable[] }>(`/api/v1/workspaces/${workspaceId}/content/variables`),
      ]);
      setSenders(senderResponse.items);
      setVersions(versionResponse.items);
      setDependencies(dependencyResponse.items);
      setVariables(variableResponse.items);
      const soleSender = senderResponse.items.length === 1 ? senderResponse.items[0] : null;
      const needsSenderDefaults = Boolean(soleSender && !email.senderIdentityId);
      const nextEmail = needsSenderDefaults && soleSender
        ? { ...email, senderIdentityId: soleSender.id, replyTo: email.replyTo.trim() || soleSender.replyTo || "" }
        : email;
      setDraft(nextEmail);
      setDirty(false);
      if (needsSenderDefaults && soleSender) {
        try {
          const saved = await phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`, { method: "PATCH", body: JSON.stringify({ expectedRowVersion: email.rowVersion, patch: { senderIdentityId: soleSender.id, replyTo: nextEmail.replyTo } }) });
          setDraft(saved);
        } catch {
          setDirty(true);
          setStatus("Sender selected. Autosave will retry with your next change.");
          return;
        }
      }
      setStatus("Saved");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to load campaign email.");
    }
  }, [emailId, workspaceId]);

  useEffect(() => {
    void load();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  const save = useCallback(async (current: EmailDraft, requestedRevision = revision.current): Promise<EmailDraft | null> => {
    setSaving(true);
    setStatus("Autosaving…");
    try {
      const next = await phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRowVersion: current.rowVersion, patch: { internalName: current.internalName, subject: current.subject, preheader: current.preheader, senderIdentityId: current.senderIdentityId, replyTo: current.replyTo, plainText: current.plainText, plainTextMode: current.plainTextMode ?? "manual", trackingEnabled: current.trackingEnabled, structuredDocument: current.structuredDocument } }),
      });
      if (revision.current === requestedRevision) {
        setDraft(next);
        setDirty(false);
        setStatus("Saved");
      } else {
        setDraft(active => active ? { ...active, rowVersion: next.rowVersion, updatedAt: next.updatedAt } : active);
        setStatus("Unsaved changes");
      }
      return next;
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes("CONCURRENCY_CONFLICT")) {
        await load();
        setStatus("Another edit was saved first. The latest version has been loaded.");
      } else {
        setStatus(reason instanceof Error ? reason.message : "Save failed.");
      }
      return null;
    } finally {
      setSaving(false);
    }
  }, [emailId, load, workspaceId]);

  const change = (next: EmailDraft) => {
    revision.current += 1;
    const nextRevision = revision.current;
    setDraft(next);
    setDirty(true);
    setStatus("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(next, nextRevision); }, 700);
  };
  const update = (patch: Partial<EmailDraft>) => { if (draft) change({ ...draft, ...patch }); };
  const flushDraft = async (): Promise<EmailDraft | null> => {
    if (!draft) return null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return dirty ? save(draft, revision.current) : draft;
  };

  const searchProfiles = async (query: string) => {
    setProfileQuery(query);
    if (!query.trim()) { setProfiles([]); return; }
    try {
      const response = await phase1Api<{ items: Profile[] }>(`/api/v1/workspaces/${workspaceId}/content/profiles?q=${encodeURIComponent(query)}`);
      setProfiles(response.items);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Profile search failed.");
    }
  };
  const runPreflight = async () => {
    const current = await flushDraft();
    if (!current) return null;
    try {
      const result = await phase1Api<{ issues: PreflightIssue[]; state: string }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/preflight`, { method: "POST" });
      setIssues(result.issues);
      setStatus(result.state === "passed" ? "Preflight passed" : result.state === "warnings" ? "Preflight completed with warnings" : "Preflight needs attention");
      setActivePanel("preflight");
      return result;
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Preflight failed.");
      return null;
    }
  };
  const renderPreview = async () => {
    if (!profileId) { setStatus("Select a workspace profile to preview."); return; }
    const current = await flushDraft();
    if (!current) return;
    try {
      const result = await phase1Api<Preview>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/preview`, { method: "POST", body: JSON.stringify({ profileId }) });
      setPreview(result);
      setStatus("Preview updated");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Preview failed.");
    }
  };
  const publish = async () => {
    const current = await flushDraft();
    if (!current) return;
    try {
      const result = await phase1Api<{ versionNumber: number }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/publish`, { method: "POST", body: JSON.stringify({ expectedRowVersion: current.rowVersion }) });
      setStatus(`Published immutable version v${result.versionNumber}.`);
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Publish failed.";
      if (message.includes("EMAIL_PREFLIGHT_BLOCKED")) {
        const result = await runPreflight();
        const blocking = result?.issues.filter(issue => issue.severity === "blocking") ?? [];
        setStatus(blocking.length ? `Cannot publish yet: fix ${blocking.length} blocking item${blocking.length === 1 ? "" : "s"}.` : "This email cannot be published until preflight passes.");
      } else setStatus(message);
    }
  };
  const saveAsTemplate = async () => {
    if (!templateName.trim()) return;
    const current = await flushDraft();
    if (!current) return;
    try {
      await phase1Api(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/save-as-template`, { method: "POST", body: JSON.stringify({ name: templateName.trim() }) });
      setTemplateName("");
      setStatus("Saved as a reusable template.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Template save failed.");
    }
  };

  if (!draft) return <section className="template-editor-loading" aria-live="polite"><div className="loading-shimmer loading-shimmer-title" /><div className="loading-shimmer loading-shimmer-body" /><p>{status}</p></section>;

  const selectedSender = senders.find(sender => sender.id === draft.senderIdentityId) ?? null;
  const footerBlock: ComplianceFooterBlock = draft.structuredDocument.blocks.find((block): block is ComplianceFooterBlock => block.type === "compliance_footer") ?? { id: "compliance", type: "compliance_footer", locked: true };
  const latestVersion = versions.length ? versions[versions.length - 1] : null;
  const blockingIssues = issues.filter(issue => issue.severity === "blocking");
  const warningIssues = issues.filter(issue => issue.severity === "warning");
  const saveLabel = saving ? "Autosaving" : dirty ? "Unsaved changes" : status === "Saved" ? "Saved" : status;

  return <section className="template-editor-page campaign-editor-page">
    <header className="template-topbar campaign-topbar">
      <div className="template-heading">
        <nav className="template-breadcrumb" aria-label="Breadcrumb"><a className="editor-back-link" href={`/w/${workspaceId}/content/emails`} aria-label="Back to campaign emails">←</a><a href={`/w/${workspaceId}/content/emails`}>Campaign emails</a><span>/</span><strong>Design</strong></nav>
        <div className="template-title-row"><input className="template-name-input" aria-label="Campaign internal name" value={draft.internalName} maxLength={160} onChange={event => update({ internalName: event.target.value })} /><span className={`template-save-state ${saving ? "is-saving" : dirty ? "is-dirty" : ""}`} role="status">{saveLabel}</span><span className={`template-status-badge ${latestVersion ? "is-approved" : ""}`}>{latestVersion ? `Published v${latestVersion.versionNumber}` : "Draft"}</span></div>
      </div>
      <div className="editor-mode-tabs"><div className="preview-segmented editor-view-switcher" aria-label="Campaign preview mode">{(["desktop", "mobile", "plain"] as PreviewMode[]).map(mode => <button key={mode} type="button" className={previewMode === mode ? "active" : ""} onClick={() => setPreviewMode(mode)}>{mode === "desktop" ? "Desktop" : mode === "plain" ? "Plain text" : "Mobile"}</button>)}</div></div>
      <div className="template-top-actions">
        <button type="button" className={`premium-button premium-button-secondary message-settings-action${!draft.subject.trim() || !draft.senderIdentityId ? " needs-attention" : ""}`} onClick={() => setActivePanel("settings")}><span aria-hidden="true">⚙</span> Campaign settings</button>
        <button type="button" className="premium-button premium-button-secondary" onClick={() => setActivePanel("preview")}>Preview</button>
        <button type="button" className="premium-button premium-button-secondary" disabled={saving} onClick={() => void runPreflight()}>Preflight</button>
        <details className="editor-more-menu"><summary className="premium-button premium-button-icon" aria-label="More campaign actions" title="More campaign actions">•••</summary><div className="editor-more-popover"><button type="button" onClick={() => setActivePanel("history")}>Version history</button><button type="button" onClick={() => setActivePanel("settings")}>Save as template</button></div></details>
        <button type="button" className="premium-button premium-button-primary" disabled={saving} onClick={() => void publish()}>{latestVersion ? "Publish changes" : "Publish email"}</button>
      </div>
    </header>

    <section className="campaign-context-bar" aria-label="Campaign readiness">
      <button type="button" onClick={() => setActivePanel("settings")}><span>Subject</span><strong>{draft.subject.trim() || "Add a subject line"}</strong></button>
      <button type="button" onClick={() => setActivePanel("settings")}><span>From</span><strong>{selectedSender ? `${selectedSender.fromName} · ${selectedSender.fromEmail}` : "Choose a sender"}</strong></button>
      <button type="button" onClick={() => setActivePanel("settings")}><span>Tracking</span><strong>{draft.trackingEnabled ? "Click tracking on" : "Tracking off"}</strong></button>
      <button type="button" onClick={() => setActivePanel("preview")}><span>Recipient preview</span><strong>{profileId ? profileQuery : "Select a profile"}</strong></button>
    </section>

    <div className="template-editor-workspace">
      {previewMode === "plain"
        ? <PlainTextEditorPanel subject={draft.subject} preheader={draft.preheader} plainText={draft.plainText} variables={variables} onMetadataChange={patch => update(patch)} onChange={plainText => update({ plainText, plainTextMode: "manual" })} />
        : <DocumentBuilder workspaceId={workspaceId} document={draft.structuredDocument} variables={variables} previewMode={previewMode} messageSettings={{ subject: draft.subject, preheader: draft.preheader, plainText: draft.plainText, category: null, notes: "", templateType: "campaign_email", useCase: "", tags: "" }} onMessageSettingsChange={patch => update({ subject: patch.subject ?? draft.subject, preheader: patch.preheader ?? draft.preheader, plainText: patch.plainText ?? draft.plainText, ...(patch.plainText !== undefined ? { plainTextMode: "manual" as const } : {}) })} onChange={structuredDocument => change({ ...draft, structuredDocument })} defaultInspector={<CampaignOverviewInspector draft={draft} sender={selectedSender} issues={issues} onOpenSettings={() => setActivePanel("settings")} onOpenPreview={() => setActivePanel("preview")} onRunPreflight={() => void runPreflight()} />} />}
    </div>

    {blockingIssues.length > 0 && activePanel !== "preflight" && <button type="button" className="campaign-preflight-toast" onClick={() => setActivePanel("preflight")}><span>{blockingIssues.length}</span><div><strong>Preflight needs attention</strong><small>Open the report to resolve blocking issues.</small></div></button>}

    {activePanel && <div className="campaign-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setActivePanel(null); }}><aside className="campaign-drawer" role="dialog" aria-modal="true" aria-labelledby="campaign-drawer-title">
      <header><div><span>Campaign email</span><h2 id="campaign-drawer-title">{activePanel === "settings" ? "Settings" : activePanel === "footer" ? "Required footer" : activePanel === "preview" ? "Recipient preview" : activePanel === "preflight" ? "Preflight report" : "Versions and usage"}</h2></div><button type="button" aria-label="Close panel" onClick={() => setActivePanel(null)}>×</button></header>
      {activePanel === "settings" && <div className="campaign-drawer-content">
        <section className="campaign-settings-section"><h3>Inbox details</h3>
          <PersonalizedInboxField label="Subject line" value={draft.subject} placeholder="Write a subject that earns the open" variables={inboxPersonalizationVariables(variables)} onChange={subject => update({ subject })} />
          <PersonalizedInboxField label="Preview text" value={draft.preheader} placeholder="Support the subject with more context" variables={inboxPersonalizationVariables(variables)} onChange={preheader => update({ preheader })} />
        </section>
        <section className="campaign-settings-section"><h3>Sender</h3><label>Sender identity<select value={draft.senderIdentityId ?? ""} onChange={event => { const sender = senders.find(item => item.id === event.target.value); update({ senderIdentityId: event.target.value || null, replyTo: draft.replyTo || sender?.replyTo || "" }); }}><option value="">Choose sender</option>{senders.map(sender => <option key={sender.id} value={sender.id}>{sender.fromName} &lt;{sender.fromEmail}&gt;</option>)}</select></label><label>Reply-to address<input type="email" value={draft.replyTo} placeholder="reply@example.com" onChange={event => update({ replyTo: event.target.value })} /></label></section>
        <section className="campaign-settings-section"><h3>Tracking and text</h3><label className="campaign-toggle"><input type="checkbox" checked={draft.trackingEnabled} onChange={event => update({ trackingEnabled: event.target.checked })} /><span><strong>Click tracking</strong><small>Measure link clicks in this campaign.</small></span></label><button type="button" className="campaign-link-button" onClick={() => { setPreviewMode("plain"); setActivePanel(null); }}>Edit plain-text version →</button></section>
        <section className="campaign-settings-section"><h3>Required footer</h3><p>Adjust your logo, social links, and physical business address. Unsubscribe stays included.</p><button type="button" className="campaign-link-button" onClick={() => setActivePanel("footer")}>Customize footer →</button></section>
        <section className="campaign-settings-section"><h3>Reuse this email</h3><p>Save the current campaign draft as a workspace template.</p><label>Template name<input value={templateName} placeholder="Reusable template name" maxLength={160} onChange={event => setTemplateName(event.target.value)} /></label><button type="button" className="premium-button premium-button-secondary campaign-full-button" disabled={!templateName.trim() || saving} onClick={() => void saveAsTemplate()}>Save as template</button></section>
      </div>}
      {activePanel === "footer" && <div className="campaign-drawer-content"><FooterInspector block={footerBlock} workspaceId={workspaceId} onChange={next => update({ structuredDocument: { schemaVersion: 1, blocks: [...draft.structuredDocument.blocks.filter(block => block.type !== "compliance_footer"), next] } })} /></div>}
      {activePanel === "preview" && <div className="campaign-drawer-content"><section className="campaign-settings-section"><h3>Preview as a recipient</h3><p>Variables are rendered using the selected workspace profile.</p><label>Search profiles<input placeholder="Search name or email" value={profileQuery} onChange={event => void searchProfiles(event.target.value)} /></label>{profiles.length > 0 && <div className="campaign-profile-results">{profiles.map(profile => <button type="button" key={profile.id} onClick={() => { setProfileId(profile.id); setProfileQuery(`${profileName(profile)} · ${profile.originalEmail}`); setProfiles([]); setPreview(null); }}>{profileName(profile)}<small>{profile.originalEmail}</small></button>)}</div>}<button type="button" className="premium-button premium-button-primary campaign-full-button" disabled={!profileId || saving} onClick={() => void renderPreview()}>Render personalized preview</button></section>{preview ? <section className="campaign-preview-result"><div className="campaign-preview-result-head"><strong>Rendered email</strong><button type="button" onClick={() => setPreviewMode("plain")}>Open plain text</button></div><iframe title="Rendered campaign email preview" sandbox="" srcDoc={preview.html} /></section> : <div className="campaign-drawer-empty"><span>✦</span><strong>No rendered preview yet</strong><p>Select a profile and render the exact email that recipient would receive.</p></div>}</div>}
      {activePanel === "preflight" && <div className="campaign-drawer-content"><div className={`campaign-preflight-summary ${blockingIssues.length ? "blocking" : warningIssues.length ? "warning" : "passed"}`}><span>{blockingIssues.length ? "!" : "✓"}</span><div><strong>{blockingIssues.length ? `${blockingIssues.length} blocking issue${blockingIssues.length === 1 ? "" : "s"}` : warningIssues.length ? "Passed with warnings" : "Ready to publish"}</strong><p>{blockingIssues.length ? "Resolve the required items below before publishing." : "The campaign email passed its required checks."}</p></div></div>{issues.length ? <div className="campaign-issue-list">{issues.map(issue => <article key={`${issue.code}:${issue.path}`}><span className={issue.severity}>{issue.severity}</span><div><strong>{issue.title ?? issue.code.replaceAll("_", " ")}</strong><p>{issue.message}</p></div></article>)}</div> : <div className="campaign-drawer-empty"><span>✓</span><strong>No issues found</strong><p>Run preflight again after making substantial content or sender changes.</p></div>}<button type="button" className="premium-button premium-button-secondary campaign-full-button" disabled={saving} onClick={() => void runPreflight()}>Run preflight again</button></div>}
      {activePanel === "history" && <div className="campaign-drawer-content"><section className="campaign-settings-section"><h3>Immutable versions</h3>{versions.length ? <div className="campaign-version-list">{versions.slice().reverse().map(version => <article key={version.id}><span>v{version.versionNumber}</span><div><strong>Published version</strong><small>{new Date(version.publishedAt).toLocaleString()}</small></div></article>)}</div> : <div className="campaign-inline-empty">No published versions yet.</div>}</section><section className="campaign-settings-section"><h3>Flow usage</h3>{dependencies.length ? <div className="campaign-dependency-list">{dependencies.map(dependency => <p key={dependency.id}><strong>Flow {dependency.flowId}</strong><span>Node {dependency.nodeId}</span></p>)}</div> : <div className="campaign-inline-empty">This email is not used by a published flow.</div>}</section></div>}
    </aside></div>}
  </section>;
}

function PersonalizedInboxField({ label, value, placeholder, variables, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  variables: PersonalizationVariable[];
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [error, setError] = useState("");
  const rememberSelection = () => {
    const input = inputRef.current;
    if (input) selection.current = { start: input.selectionStart ?? value.length, end: input.selectionEnd ?? value.length };
  };
  const insert = (variable: PersonalizationVariable) => {
    const token = personalizationToken(variable);
    const range = selection.current ?? { start: value.length, end: value.length };
    const start = Math.min(range.start, value.length);
    const end = Math.min(range.end, value.length);
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    if (next.length > 200) {
      setError("Maximum 200 characters. Select text to replace or shorten this field.");
      return;
    }
    onChange(next);
    setError("");
    const caret = start + token.length;
    selection.current = { start: caret, end: caret };
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(caret, caret); });
  };
  return <div className="campaign-personalized-field">
    <label>{label}<input ref={inputRef} value={value} maxLength={200} placeholder={placeholder} onChange={event => { onChange(event.target.value); setError(""); }} onClick={rememberSelection} onKeyUp={rememberSelection} onSelect={rememberSelection} /></label>
    <PersonalizationPicker variables={variables} onInsert={insert} />
    {error && <small className="campaign-placeholder-error" role="alert">{error}</small>}
  </div>;
}

function CampaignOverviewInspector({ draft, sender, issues, onOpenSettings, onOpenPreview, onRunPreflight }: { draft: EmailDraft; sender: Sender | null; issues: PreflightIssue[]; onOpenSettings: () => void; onOpenPreview: () => void; onRunPreflight: () => void }) {
  const blocking = issues.filter(issue => issue.severity === "blocking").length;
  return <div className="inspector-content campaign-overview-inspector"><header className="inspector-heading"><span>C</span><div><h2>Campaign email</h2><p>Review message and delivery readiness.</p></div></header><div className="campaign-inspector-inbox"><span>Inbox preview</span><strong>{draft.subject || "Add your subject line"}</strong><p>{draft.preheader || "Add preview text to support the subject."}</p></div><div className="campaign-inspector-readiness"><h3>Ready to publish</h3><p className={draft.subject.trim() ? "complete" : "missing"}><span>{draft.subject.trim() ? "✓" : "!"}</span>Subject line</p><p className={sender ? "complete" : "missing"}><span>{sender ? "✓" : "!"}</span>Sender identity</p><p className={draft.structuredDocument.blocks.length > 1 ? "complete" : "missing"}><span>{draft.structuredDocument.blocks.length > 1 ? "✓" : "!"}</span>Email content</p><p className={draft.plainText.trim() ? "complete" : "warning"}><span>{draft.plainText.trim() ? "✓" : "!"}</span>Plain-text version</p></div><button type="button" className="campaign-inspector-action primary" onClick={onOpenSettings}>Open campaign settings</button><button type="button" className="campaign-inspector-action" onClick={onOpenPreview}>Preview with a profile</button><button type="button" className="campaign-inspector-action" onClick={onRunPreflight}>{blocking ? `Review ${blocking} blocking issue${blocking === 1 ? "" : "s"}` : "Run preflight"}</button></div>;
}
