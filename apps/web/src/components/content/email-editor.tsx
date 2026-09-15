"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmailDraft, PreflightIssue } from "../../../../../packages/domain/src/phase2/content";
import { DocumentBuilder, type PreviewMode } from "./document-builder";
import { phase1Api } from "../../lib/phase1-api";

interface Sender { id: string; fromName: string; fromEmail: string; replyTo?: string }
interface Version { id: string; versionNumber: number; publishedAt: string }
interface Dependency { id: string; flowId: string; nodeId: string }
interface Profile { id: string; firstName?: string | null; lastName?: string | null; originalEmail: string }
interface Variable { key: string; label: string; requiresFallback: boolean }
interface Preview { html: string; text: string }
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileQuery, setProfileQuery] = useState("");
  const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [templateName, setTemplateName] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [email, senderResponse, versionResponse, dependencyResponse, variableResponse] = await Promise.all([
        phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`),
        phase1Api<{ items: Sender[] }>(`/api/v1/workspaces/${workspaceId}/sender-identities`),
        phase1Api<{ items: Version[] }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/versions`),
        phase1Api<{ items: Dependency[] }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/flow-dependencies`),
        phase1Api<{ items: Variable[] }>(`/api/v1/workspaces/${workspaceId}/content/variables`),
      ]);
      setSenders(senderResponse.items); setVersions(versionResponse.items); setDependencies(dependencyResponse.items); setVariables(variableResponse.items);
      const soleSender = senderResponse.items.length === 1 ? senderResponse.items[0] : null;
      const needsSenderDefaults = soleSender && !email.senderIdentityId;
      const nextEmail = needsSenderDefaults
        ? { ...email, senderIdentityId: soleSender.id, replyTo: email.replyTo.trim() || soleSender.replyTo || "" }
        : email;
      setDraft(nextEmail);
      if (needsSenderDefaults) {
        try {
          const saved = await phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`, { method: "PATCH", body: JSON.stringify({ expectedRowVersion: email.rowVersion, patch: { senderIdentityId: soleSender.id, replyTo: nextEmail.replyTo } }) });
          setDraft(saved);
        } catch {
          // Keep the optimistic draft; the user can save manually.
        }
      }
      setStatus("Saved");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Unable to load email."); }
  }, [emailId, workspaceId]);
  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);

  const save = useCallback(async (current: EmailDraft) => {
    setSaving(true); setStatus("Saving…");
    try {
      const next = await phase1Api<EmailDraft>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}`, { method: "PATCH", body: JSON.stringify({ expectedRowVersion: current.rowVersion, patch: { internalName: current.internalName, subject: current.subject, preheader: current.preheader, senderIdentityId: current.senderIdentityId, replyTo: current.replyTo, plainText: current.plainText, plainTextMode: current.plainTextMode ?? "manual", trackingEnabled: current.trackingEnabled, structuredDocument: current.structuredDocument } }) });
      setDraft(active => active?.rowVersion === current.rowVersion ? next : active); setStatus("Saved");
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes("CONCURRENCY_CONFLICT")) {
        await load();
        setStatus("Another edit was saved first. The latest version has been loaded.");
      } else setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
    finally { setSaving(false); }
  }, [emailId, load, workspaceId]);
  const change = (next: EmailDraft) => { setDraft(next); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void save(next), 700); };
  const update = (patch: Partial<EmailDraft>) => { if (draft) change({ ...draft, ...patch }); };
  const searchProfiles = async (query: string) => { setProfileQuery(query); try { const response = await phase1Api<{ items: Profile[] }>(`/api/v1/workspaces/${workspaceId}/content/profiles?q=${encodeURIComponent(query)}`); setProfiles(response.items); } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Profile search failed."); } };
  const runPreflight = async () => { try { const result = await phase1Api<{ issues: PreflightIssue[]; state: string }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/preflight`, { method: "POST" }); setIssues(result.issues); setStatus(result.state === "passed" ? "Preflight passed" : result.state === "warnings" ? "Preflight completed with warnings" : "Preflight needs attention"); return result; } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Preflight failed."); return null; } };
  const renderPreview = async () => { if (!profileId) { setStatus("Select a workspace profile to preview."); return; } try { const result = await phase1Api<Preview>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/preview`, { method: "POST", body: JSON.stringify({ profileId }) }); setPreview(result); setStatus("Preview updated"); } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Preview failed."); } };
  const publish = async () => { if (!draft) return; try { const result = await phase1Api<{ versionNumber: number }>(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/publish`, { method: "POST", body: JSON.stringify({ expectedRowVersion: draft.rowVersion }) }); setStatus(`Published immutable version v${result.versionNumber}.`); await load(); } catch (reason) { const message = reason instanceof Error ? reason.message : "Publish failed."; if (message.includes("EMAIL_PREFLIGHT_BLOCKED")) { const result = await runPreflight(); const blocking = result?.issues.filter(issue => issue.severity === "blocking") ?? []; setStatus(blocking.length ? `Cannot publish yet: fix ${blocking.length} blocking item${blocking.length === 1 ? "" : "s"} shown below.` : "This email cannot be published until its preflight checks pass."); } else setStatus(message); } };
  const saveAsTemplate = async () => { if (!templateName.trim()) return; try { await phase1Api(`/api/v1/workspaces/${workspaceId}/emails/${emailId}/save-as-template`, { method: "POST", body: JSON.stringify({ name: templateName.trim() }) }); setTemplateName(""); setStatus("Saved as a reusable template."); } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Template save failed."); } };
  if (!draft) return <section className="flow-loading"><h1>Email editor</h1><p>{status}</p></section>;

  return <section className="email-editor-shell">
    <header className="email-editor-header"><a className="flow-back" href={`/w/${workspaceId}/content/emails`}>← Content</a><input aria-label="Internal name" value={draft.internalName} onChange={event => update({ internalName: event.target.value })} /><span role="status">{saving ? "Saving…" : status}</span><div className="editor-actions"><button type="button" onClick={() => void renderPreview()}>Preview</button><button type="button" onClick={() => void runPreflight()}>Preflight</button><button type="button" className="button-primary" onClick={() => void publish()}>Publish</button></div></header>
    {issues.some(issue => issue.severity === "blocking") && <section className="email-preflight-banner" role="alert"><div><strong>Before you can publish</strong><p>Resolve these required items, then run Preflight again.</p></div><ul>{issues.filter(issue => issue.severity === "blocking").map(issue => <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>)}</ul><button type="button" className="button-secondary" onClick={() => void runPreflight()}>Check again</button></section>}
    <div className="editor-tabbar email-preview-tabs"><button type="button" className={previewMode === "desktop" ? "active" : ""} onClick={() => setPreviewMode("desktop")}>Desktop</button><button type="button" className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}>Mobile</button><button type="button" className={previewMode === "plain" ? "active" : ""} onClick={() => setPreviewMode("plain")}>Plain text</button></div>
    {previewMode === "plain" ? <pre className="email-canvas email-plain-preview">{preview?.text || draft.plainText || "The plain-text alternative will appear here."}</pre> : <DocumentBuilder document={draft.structuredDocument} variables={variables} previewMode={previewMode} onChange={structuredDocument => change({ ...draft, structuredDocument })} />}
    <section className="editor-bottom"><div><h2>Message settings</h2><label>Subject<input value={draft.subject} onChange={event => update({ subject: event.target.value })} /></label><label>Preheader<input value={draft.preheader} onChange={event => update({ preheader: event.target.value })} /></label><label>Sender identity<select value={draft.senderIdentityId ?? ""} onChange={event => update({ senderIdentityId: event.target.value || null })}><option value="">Choose sender</option>{senders.map(sender => <option key={sender.id} value={sender.id}>{sender.fromName} &lt;{sender.fromEmail}&gt;</option>)}</select></label><label>Reply-to<input value={draft.replyTo} onChange={event => update({ replyTo: event.target.value })} /></label><label><input type="checkbox" checked={draft.trackingEnabled} onChange={event => update({ trackingEnabled: event.target.checked })} /> Enable click tracking</label><label>Plain-text alternative<textarea rows={5} value={draft.plainText} onChange={event => update({ plainText: event.target.value, plainTextMode: "manual" })} /></label></div><div><h2>Preview and validation</h2><label>Search profiles<input placeholder="Search name or email" value={profileQuery} onChange={event => void searchProfiles(event.target.value)} /></label>{profiles.map(profile => <button type="button" className="profile-result" key={profile.id} onClick={() => { setProfileId(profile.id); setProfileQuery(`${profileName(profile)} · ${profile.originalEmail}`); setProfiles([]); }}>{profileName(profile)} <small>{profile.originalEmail}</small></button>)}<p>{profileId ? "A recipient is selected for a rendered preview." : "Select a workspace profile for a rendered preview."}</p>{preview && <iframe title="Rendered email preview" sandbox="" srcDoc={preview.html} className="email-rendered-preview" />}{issues.length > 0 && <div className="issue-list">{issues.map(issue => <p key={`${issue.code}:${issue.path}`}><strong>{issue.severity.toUpperCase()}</strong> {issue.message}</p>)}</div>}<hr /><label>Save this email as a template<input placeholder="Template name" value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><button type="button" onClick={() => void saveAsTemplate()} disabled={!templateName.trim()}>Save template</button></div></section>
    <details className="email-editor-details"><summary>Version history and usage</summary>{versions.length ? versions.slice().reverse().map(version => <p key={version.id}>v{version.versionNumber} · {new Date(version.publishedAt).toLocaleString()}</p>) : <p>No published versions yet.</p>}{dependencies.length ? dependencies.map(dependency => <p key={dependency.id}>Used by flow {dependency.flowId}, node {dependency.nodeId}</p>) : <p>Not used by a published Flow.</p>}</details>
  </section>;
}
