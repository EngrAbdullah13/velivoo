"use client";

import { useMemo, useRef, useState, type RefObject } from "react";

interface Variable { key: string; label: string; requiresFallback: boolean }

function insertAtCursor(field: HTMLInputElement | HTMLTextAreaElement | null, snippet: string, onValue: (next: string) => void, current: string) {
  if (!field) {
    onValue(current ? `${current} ${snippet}` : snippet);
    return;
  }
  const start = field.selectionStart ?? current.length;
  const end = field.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`;
  onValue(next);
  queueMicrotask(() => {
    field.focus();
    const caret = start + snippet.length;
    field.setSelectionRange(caret, caret);
  });
}

function PersonalizationControl({ label, required, value, onChange, variables, multiline = false }: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  variables: Variable[];
  multiline?: boolean;
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const commonEmojis = ["✨", "🎉", "💌", "🔥", "✅", "🛍️"];

  const field = multiline
    ? <textarea ref={fieldRef as RefObject<HTMLTextAreaElement>} rows={3} value={value} placeholder="" aria-required={required} onChange={event => onChange(event.target.value)} />
    : <input ref={fieldRef as RefObject<HTMLInputElement>} type="text" value={value} aria-required={required} onChange={event => onChange(event.target.value)} />;

  return (
    <label className={`template-setup-field${required ? " is-required" : ""}`}>
      <span>{label}{required && " *"}</span>
      <div className="template-setup-input-wrap">
        {field}
        <div className="template-setup-input-tools">
          <details className="template-setup-emoji" onToggle={event => setPickerOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary aria-label="Insert emoji">☺</summary>
            <div className="template-setup-emoji-grid">
              {commonEmojis.map(emoji => (
                <button type="button" key={emoji} onClick={() => insertAtCursor(fieldRef.current, emoji, onChange, value)}>{emoji}</button>
              ))}
            </div>
          </details>
          <details className="template-setup-merge" open={pickerOpen} onToggle={event => setPickerOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary aria-label="Insert personalization">{"{ }"}</summary>
            <div className="template-setup-merge-list">
              {variables.length ? variables.map(variable => (
                <button
                  type="button"
                  key={variable.key}
                  onClick={() => insertAtCursor(fieldRef.current, `{{ ${variable.key}${variable.requiresFallback ? ' | default: "there"' : ""} }}`, onChange, value)}
                >
                  {variable.label}
                </button>
              )) : <p>No workspace variables yet.</p>}
            </div>
          </details>
        </div>
      </div>
    </label>
  );
}

export function TemplateSetupScreen({
  workspaceId,
  name,
  fromName,
  subject,
  preheader,
  tag,
  replyTo,
  trackingEnabled,
  variables,
  saving,
  onNameChange,
  onFromNameChange,
  onSubjectChange,
  onPreheaderChange,
  onTagChange,
  onReplyToChange,
  onTrackingChange,
  onSave,
  onAddContent,
}: {
  workspaceId: string;
  name: string;
  fromName: string;
  subject: string;
  preheader: string;
  tag: string;
  replyTo: string;
  trackingEnabled: boolean;
  variables: Variable[];
  saving: boolean;
  onNameChange: (value: string) => void;
  onFromNameChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onPreheaderChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onReplyToChange: (value: string) => void;
  onTrackingChange: (enabled: boolean) => void;
  onSave: () => void | Promise<void>;
  onAddContent: () => void | Promise<void>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const inactiveLabel = useMemo(() => "Inactive", []);

  const validate = () => {
    if (!fromName.trim()) return "Sender name is required.";
    if (!subject.trim()) return "Subject line is required.";
    return "";
  };

  const runAddContent = async () => {
    const message = validate();
    if (message) {
      setFormError(message);
      return;
    }
    setFormError("");
    await onAddContent();
  };

  const runSave = async () => {
    setFormError("");
    await onSave();
  };

  return (
    <section className="template-setup-page">
      <header className="template-setup-topbar">
        <div className="template-setup-title-block">
          <a className="template-setup-back" href={`/w/${workspaceId}/content/templates`} aria-label="Back to templates">←</a>
          <div>
            <input className="template-setup-name" aria-label="Template name" value={name} maxLength={160} onChange={event => onNameChange(event.target.value)} />
            <p className="template-setup-status"><span className="template-setup-status-dot" aria-hidden="true" />{inactiveLabel}</p>
          </div>
        </div>
        <div className="template-setup-top-actions">
          <button type="button" className="premium-button premium-button-secondary" disabled={saving} onClick={() => void runSave()}>Save</button>
        </div>
      </header>

      <div className="template-setup-body">
        <section className="template-setup-content-panel" aria-labelledby="template-setup-content-heading">
          <h2 id="template-setup-content-heading">Content</h2>
          <div className="template-setup-content-card">
            <div className="template-setup-illustration" aria-hidden="true">
              <span className="template-setup-illustration-doc" />
              <span className="template-setup-illustration-pencil" />
            </div>
            <p>Add content and design from scratch using the editor or an existing template.</p>
            <button type="button" className="button-primary template-setup-add-content" disabled={saving} onClick={() => void runAddContent()}>
              <span aria-hidden="true">▦</span> Add content
            </button>
          </div>
        </section>

        <section className="template-setup-settings-panel" aria-label="Template delivery settings">
          {formError && <p className="template-setup-error" role="alert">{formError}</p>}
          <label className="template-setup-field is-required">
            <span>Sender name *</span>
            <input type="text" value={fromName} maxLength={120} placeholder="Name shown in the inbox" aria-required onChange={event => onFromNameChange(event.target.value)} />
          </label>

          <PersonalizationControl label="Subject line" required value={subject} onChange={onSubjectChange} variables={variables} multiline />
          <PersonalizationControl label="Preview text" value={preheader} onChange={onPreheaderChange} variables={variables} multiline />
          <p className="template-setup-tip"><span aria-hidden="true">💡</span> Keep preview text under 35 characters so it is less likely to be truncated in inbox lists.</p>

          <label className="template-setup-field">
            <span>Tag</span>
            <input type="text" value={tag} maxLength={80} placeholder="Optional label for your library" onChange={event => onTagChange(event.target.value)} />
          </label>

          <div className="template-setup-advanced">
            <button type="button" className="template-setup-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}>
              Advanced settings <span aria-hidden="true">{advancedOpen ? "▴" : "▾"}</span>
            </button>
            {advancedOpen && (
              <div className="template-setup-advanced-body">
                <label className="template-setup-field">
                  <span>Reply-to email address</span>
                  <input type="email" value={replyTo} placeholder="replies@yourdomain.com" onChange={event => onReplyToChange(event.target.value)} />
                </label>
                <label className="template-setup-toggle">
                  <input type="checkbox" checked={trackingEnabled} onChange={event => onTrackingChange(event.target.checked)} />
                  <span>Activate UTM tracking</span>
                </label>
                <p className="template-setup-advanced-note">You can add images and blocks in the editor after you click Add content. Attachments are not configured on this screen.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
