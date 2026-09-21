"use client";

interface InboxMetadataBarProps {
  subject: string;
  preheader: string;
  onChange: (patch: { subject?: string; preheader?: string }) => void;
  id?: string;
}

export function InboxMetadataBar({ subject, preheader, onChange, id = "template-inbox-metadata" }: InboxMetadataBarProps) {
  const subjectMissing = !subject.trim();
  const previewSubject = subject.trim() || "Your subject line";
  const previewPreheader = preheader.trim() || "Preview text shown next to the subject in the inbox.";

  return (
    <section className="inbox-metadata-bar" id={id} aria-label="Inbox delivery settings">
      <div className="inbox-metadata-main">
        <div className="inbox-metadata-fields">
          <label className="inbox-metadata-field">
            <span className={subjectMissing ? "is-required" : undefined}>Subject line</span>
            <input
              type="text"
              value={subject}
              maxLength={200}
              placeholder="What recipients see in their inbox"
              aria-required={subjectMissing}
              onChange={event => onChange({ subject: event.target.value })}
            />
          </label>
          <label className="inbox-metadata-field">
            <span>Preview text</span>
            <input
              type="text"
              value={preheader}
              maxLength={200}
              placeholder="Short summary beside the subject (preheader)"
              onChange={event => onChange({ preheader: event.target.value })}
            />
          </label>
        </div>
        <div className="inbox-list-preview" aria-label="Inbox list preview">
          <span className="inbox-list-preview-kicker">Inbox preview</span>
          <div className="inbox-list-preview-row">
            <span className="inbox-list-preview-subject">{previewSubject}</span>
            <span className="inbox-list-preview-preheader">{previewPreheader}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

interface PlainTextEditorPanelProps {
  plainText: string;
  onChange: (plainText: string) => void;
  subject?: string;
  preheader?: string;
  onMetadataChange?: (patch: { subject?: string; preheader?: string }) => void;
  id?: string;
}

export function PlainTextEditorPanel({ plainText, onChange, subject, preheader, onMetadataChange, id = "template-plain-text-editor" }: PlainTextEditorPanelProps) {
  const plainMissing = !plainText.trim();
  const showMessageFields = subject !== undefined && preheader !== undefined && onMetadataChange !== undefined;
  const subjectMissing = showMessageFields && !subject.trim();
  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;

  return (
    <section className={`plain-text-editor-panel${showMessageFields ? " plain-text-message-composer" : ""}`} id={id} aria-label="Plain-text version">
      <header className="plain-text-editor-heading">
        <div>
          <span className="plain-text-editor-kicker">Message</span>
          <h2>{showMessageFields ? "Write your email" : "Plain text"}</h2>
          <p>{showMessageFields ? "Set the inbox details and write the message recipients will read." : "Required for approval and inbox clients that prefer text. This is separate from your design blocks."}</p>
        </div>
        {(plainMissing || subjectMissing) && <span className="plain-text-required-badge" role="status">Needs attention</span>}
      </header>
      <div className={showMessageFields ? "plain-text-composer-layout" : undefined}>
        <div className={showMessageFields ? "plain-text-composer-card" : undefined}>
          {showMessageFields && <div className="plain-text-metadata-fields">
            <label className="plain-text-composer-field">
              <span>Subject <em>Required</em></span>
              <input
                type="text"
                value={subject}
                maxLength={200}
                placeholder="Write a subject that earns the open"
                aria-required="true"
                onChange={event => onMetadataChange({ subject: event.target.value })}
              />
              <small>{subject.length}/200 characters</small>
            </label>
            <label className="plain-text-composer-field">
              <span>Preview text</span>
              <input
                type="text"
                value={preheader}
                maxLength={200}
                placeholder="Add context recipients see beside the subject"
                onChange={event => onMetadataChange({ preheader: event.target.value })}
              />
              <small>{preheader.length}/200 characters</small>
            </label>
          </div>}
          <label className={`plain-text-composer-field plain-text-body-field${plainMissing ? " is-required" : ""}`}>
            {showMessageFields && <span>Body <em>Required</em></span>}
            <textarea
              className="email-plain-editor"
              rows={18}
              value={plainText}
              placeholder="Write your email body here…"
              aria-label={showMessageFields ? "Email body" : "Plain-text version"}
              aria-required={plainMissing}
              onChange={event => onChange(event.target.value)}
            />
            {showMessageFields && <small>{wordCount} {wordCount === 1 ? "word" : "words"} · {plainText.length} characters</small>}
          </label>
          {showMessageFields && <div className="plain-text-compliance-note"><span aria-hidden="true">✓</span><div><strong>Compliance footer included</strong><p>Business identity, unsubscribe, and preference links are appended when this email is sent.</p></div></div>}
        </div>
        {showMessageFields && <aside className="plain-text-message-summary" aria-label="Message readiness">
          <div className="plain-text-inbox-preview">
            <span>Inbox preview</span>
            <strong>{subject.trim() || "Your subject line"}</strong>
            <p>{preheader.trim() || "Preview text will appear here."}</p>
          </div>
          <div className="plain-text-readiness">
            <h3>Ready to publish</h3>
            <p className={subjectMissing ? "is-missing" : "is-complete"}><span>{subjectMissing ? "!" : "✓"}</span> Subject line</p>
            <p className={!preheader.trim() ? "is-warning" : "is-complete"}><span>{!preheader.trim() ? "!" : "✓"}</span> Preview text</p>
            <p className={plainMissing ? "is-missing" : "is-complete"}><span>{plainMissing ? "!" : "✓"}</span> Email body</p>
          </div>
          <p className="plain-text-autosave-note">Changes are autosaved while you type.</p>
        </aside>}
      </div>
    </section>
  );
}
