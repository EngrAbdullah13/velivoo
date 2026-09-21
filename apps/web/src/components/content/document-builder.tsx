"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import type { ContentBlock, EmailAlignment, EmailTextStyle, ImageBlock, StructuredBlock, StructuredEmailDocument } from "../../../../../packages/domain/src/phase2/content";

export type PreviewMode = "desktop" | "mobile" | "plain";
type LibraryTab = "blocks" | "sections" | "saved";
type TemplateSettingsTab = "styles" | "message";
type PaletteGroup = "Content" | "Email commerce" | "Layout" | "Advanced";
type InsertableBlockType = ContentBlock["type"];
interface Variable { key: string; label: string; requiresFallback: boolean }
interface UniversalBlock { id: string; name: string; blocks: ContentBlock[] }
interface MediaAsset { id: string; name: string; url: string; altText: string }
export interface MessageSettings { subject: string; preheader: string; plainText: string; category: string | null; notes: string; templateType: string; useCase: string; tags: string }
type TextPatch = { text?: string; align?: EmailAlignment; style?: EmailTextStyle };
interface PaletteItem { label: string; group: PaletteGroup; icon: string; description: string; type?: InsertableBlockType; create?: () => ContentBlock[]; unavailableReason?: string }
interface SectionPreset { label: string; icon: string; description: string; create: () => ContentBlock[] }
export interface TemplateDesignSettings { backgroundColor?: string; bodyBackgroundColor?: string; emailWidth?: number; fontFamily?: EmailTextStyle["fontFamily"]; headingFontSize?: number; bodyFontSize?: number; buttonRadius?: number; defaultLinkColor?: string; spacingScale?: string; logoUrl?: string; footerStyle?: string; recentColors?: string[] }

const createId = () => crypto.randomUUID();
const contentOnly = (block: StructuredBlock): block is ContentBlock => block.type !== "compliance_footer";
const textOnly = (block: ContentBlock): block is Extract<ContentBlock, { type: "heading" | "text" | "header" | "footer" }> => ["heading", "text", "header", "footer"].includes(block.type);

function newBlock(type: InsertableBlockType): ContentBlock {
  switch (type) {
    case "heading": return { id: createId(), type, level: 2, text: "Add a heading", style: { fontFamily: "Arial, sans-serif", fontSize: 26, lineHeight: 1.25 } };
    case "text": return { id: createId(), type, text: "Write your message here.", style: { fontFamily: "Arial, sans-serif", fontSize: 16, lineHeight: 1.5 } };
    case "header": return { id: createId(), type, text: "Your brand", align: "center", style: { fontFamily: "Arial, sans-serif", fontSize: 18, fontWeight: "bold" } };
    case "footer": return { id: createId(), type, text: "Thanks for reading.", align: "center", style: { fontFamily: "Arial, sans-serif", fontSize: 12, color: "#6b6474" } };
    case "image": return { id: createId(), type, src: "", alt: "", width: 600, align: "center", borderRadius: 0 };
    case "button": return { id: createId(), type, label: "Call to action", url: "https://example.com", align: "center", backgroundColor: "#6846ed", textColor: "#ffffff" };
    case "divider": return { id: createId(), type, color: "#ded8e6", style: "solid" };
    case "spacer": return { id: createId(), type, height: 28 };
    case "social": return { id: createId(), type, links: [{ label: "Website", url: "https://example.com" }] };
    case "columns": return { id: createId(), type, columns: [{ id: createId(), blocks: [newBlock("text")] }, { id: createId(), blocks: [newBlock("text")] }] };
    case "custom_html": return { id: createId(), type, html: "<p>Custom HTML section</p>", label: "Custom HTML" };
  }
}
function newHeading(text: string): Extract<ContentBlock, { type: "heading" }> { return { id: createId(), type: "heading", level: 2, text, style: { fontFamily: "Arial, sans-serif", fontSize: 26, lineHeight: 1.25 } }; }
function newText(text: string): Extract<ContentBlock, { type: "text" }> { return { id: createId(), type: "text", text, style: { fontFamily: "Arial, sans-serif", fontSize: 16, lineHeight: 1.5 } }; }
function newImage(alt: string): ImageBlock { return { id: createId(), type: "image", src: "", alt, width: 600, align: "center", borderRadius: 0 }; }
function newButton(label = "Call to action"): Extract<ContentBlock, { type: "button" }> { return { id: createId(), type: "button", label, url: "https://example.com", align: "center", backgroundColor: "#6846ed", textColor: "#ffffff" }; }
function imageAndText(): ContentBlock[] { return [{ id: createId(), type: "columns", columns: [{ id: createId(), blocks: [newBlock("image")] }, { id: createId(), blocks: [newBlock("text")] }] }]; }
function videoLayout(): ContentBlock[] { return [newImage("Video thumbnail"), newButton("Watch video")]; }
function countdownLayout(): ContentBlock[] { return [newHeading("Offer ends soon"), newText("00 days · 00 hours · 00 minutes"), newButton()]; }
function productLayout(): ContentBlock[] { return [newImage("Featured product"), newHeading("Featured product"), newText("Add product details, price, and a short benefit."), newButton()]; }
function productGridLayout(): ContentBlock[] { return [{ id: createId(), type: "columns", columns: [{ id: createId(), blocks: [newImage("Product one"), newText("Product one")] }, { id: createId(), blocks: [newImage("Product two"), newText("Product two")] }] }]; }
function couponLayout(): ContentBlock[] { return [newHeading("Your exclusive offer"), newText("Use code: WELCOME20"), newButton()]; }
function cartLayout(): ContentBlock[] { return imageAndText().concat([newButton("Return to your cart")]); }
function recommendationLayout(): ContentBlock[] { return [newHeading("Picked for you"), ...productGridLayout()]; }
function sectionLayout(): ContentBlock[] { return [newHeading("New section"), newBlock("text"), newBlock("spacer")]; }
function containerLayout(): ContentBlock[] { return [newBlock("columns")]; }
function tableLayout(): ContentBlock[] { return [{ id: createId(), type: "columns", columns: [{ id: createId(), blocks: [newText("Column one\nAdd your content")] }, { id: createId(), blocks: [newText("Column two\nAdd your content")] }] }]; }
function dynamicContentLayout(): ContentBlock[] { return [newText('Hello {{ profile.first_name | default: "there" }},')]; }
function customContentLayout(): ContentBlock[] { return [newHeading("Custom content"), newText("Build this content with the safe structured email editor.")]; }
const palette: PaletteItem[] = [
  { label: "Heading", group: "Content", icon: "H", description: "Section headline", type: "heading" }, { label: "Text", group: "Content", icon: "T", description: "Paragraph copy", type: "text" }, { label: "Image", group: "Content", icon: "▧", description: "Visual content", type: "image" }, { label: "Image & text", group: "Content", icon: "▤", description: "Two-column content", create: imageAndText }, { label: "Video", group: "Content", icon: "▶", description: "Editable video layout", create: videoLayout }, { label: "Button", group: "Content", icon: "↗", description: "Call to action", type: "button" }, { label: "Divider", group: "Content", icon: "—", description: "Visual separation", type: "divider" }, { label: "List", group: "Content", icon: "☷", description: "Bullet point copy", create: () => [{ ...newBlock("text"), text: "• First item\n• Second item\n• Third item" }] }, { label: "Countdown", group: "Content", icon: "◷", description: "Editable offer timer", create: countdownLayout }, { label: "Social icons", group: "Content", icon: "◎", description: "Connected destinations", type: "social" }, { label: "Header", group: "Content", icon: "⌁", description: "Email masthead", type: "header" }, { label: "Footer", group: "Content", icon: "⌄", description: "Content footer", type: "footer" },
  { label: "Product block", group: "Email commerce", icon: "□", description: "Editable product layout", create: productLayout }, { label: "Product grid", group: "Email commerce", icon: "▦", description: "Editable product grid", create: productGridLayout }, { label: "Coupon block", group: "Email commerce", icon: "%", description: "Editable offer layout", create: couponLayout }, { label: "Cart item", group: "Email commerce", icon: "▣", description: "Editable cart layout", create: cartLayout }, { label: "Recommendation", group: "Email commerce", icon: "✦", description: "Editable recommendation", create: recommendationLayout },
  { label: "Columns", group: "Layout", icon: "▦", description: "Responsive columns", type: "columns" }, { label: "Spacer", group: "Layout", icon: "↕", description: "Vertical space", type: "spacer" }, { label: "Section", group: "Layout", icon: "□", description: "Editable content section", create: sectionLayout }, { label: "Container", group: "Layout", icon: "▤", description: "Editable content container", create: containerLayout },
  { label: "HTML", group: "Advanced", icon: "</>", description: "Safe custom content", create: customContentLayout }, { label: "Table", group: "Advanced", icon: "▤", description: "Editable table layout", create: tableLayout }, { label: "Dynamic content", group: "Advanced", icon: "✦", description: "Variable-ready content", create: dynamicContentLayout },
];
const sectionPresets: SectionPreset[] = [
  { label: "Hero", icon: "✦", description: "Headline, copy and CTA", create: () => [newBlock("heading"), newBlock("text"), newBlock("button")] },
  { label: "Image & copy", icon: "▤", description: "Responsive two columns", create: imageAndText },
  { label: "Feature row", icon: "▦", description: "Two feature columns", create: () => [newBlock("columns")] },
  { label: "Call to action", icon: "↗", description: "Copy with a button", create: () => [newBlock("text"), newBlock("button")] },
  { label: "Social footer", icon: "◎", description: "Social links and sign-off", create: () => [newBlock("social"), newBlock("footer")] },
];
function isImportedHtmlDocument(document: StructuredEmailDocument): boolean {
  const content = document.blocks.filter(contentOnly);
  return content.length === 1 && content[0]?.type === "custom_html";
}

function blockTypeLabel(block: ContentBlock): string {
  switch (block.type) {
    case "heading": return "Heading";
    case "text": return "Text";
    case "header": return "Header";
    case "footer": return "Footer";
    case "image": return "Image";
    case "button": return "Button";
    case "divider": return "Divider";
    case "spacer": return "Spacer";
    case "social": return "Social";
    case "columns": return "Columns";
    case "custom_html": return "Custom HTML";
    default: return "Block";
  }
}

function resolvedEmailWidth(settings: TemplateDesignSettings): number {
  return Math.min(Math.max(settings.emailWidth ?? 600, 480), 760);
}

function resizeHtmlPreview(frame: HTMLIFrameElement | null) {
  if (!frame?.contentDocument?.body) return;
  const body = frame.contentDocument.body;
  const html = frame.contentDocument.documentElement;
  const height = Math.max(body.scrollHeight, body.offsetHeight, html?.scrollHeight ?? 0, html?.offsetHeight ?? 0, 320);
  frame.style.height = `${height}px`;
}

function wrapSectionPreviewHtml(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}</style></head><body>${html}</body></html>`;
}

function CustomHtmlPreview({ html, label, section = false }: { html: string; label?: string; section?: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const previewHtml = section ? wrapSectionPreviewHtml(html) : html;
  const syncHeight = useCallback(() => resizeHtmlPreview(frameRef.current), []);
  useEffect(() => {
    syncHeight();
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => syncHeight()) : null;
    observer?.observe(doc.body);
    return () => observer?.disconnect();
  }, [previewHtml, syncHeight]);
  return (
    <div className={`canvas-custom-html${section ? " canvas-custom-html-section" : ""}`}>
      {!section && <strong>{label ?? "Custom HTML"}</strong>}
      <iframe
        ref={frameRef}
        title={label ?? "Custom HTML preview"}
        sandbox=""
        srcDoc={previewHtml}
        className="custom-html-preview"
        onLoad={(event: SyntheticEvent<HTMLIFrameElement>) => resizeHtmlPreview(event.currentTarget)}
      />
    </div>
  );
}
function cloneBlock(block: ContentBlock): ContentBlock { const copy = structuredClone(block); copy.id = createId(); if (copy.type === "columns") copy.columns = copy.columns.map(column => ({ id: createId(), blocks: column.blocks.map(cloneBlock) })); return copy; }
function isLightColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  if (normalized === "#fff" || normalized === "#ffffff") return true;
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match?.[1]) return false;
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 210;
}
type StyledTextBlock = Extract<ContentBlock, { type: "heading" | "text" | "header" | "footer" }>;
function textStyle(block: StyledTextBlock): CSSProperties {
  const backgroundColor = block.backgroundColor;
  let color = block.style?.color;
  if (color && isLightColor(color) && !backgroundColor) color = "#111111";
  return { textAlign: block.align, color, fontFamily: block.style?.fontFamily, fontSize: block.style?.fontSize, lineHeight: block.style?.lineHeight, fontWeight: block.style?.fontWeight, fontStyle: block.style?.italic ? "italic" : undefined, textDecoration: [block.style?.underline ? "underline" : "", block.style?.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined, margin: 0, whiteSpace: "pre-wrap" };
}
function blockSurfaceStyle(block: ContentBlock): CSSProperties {
  if ("backgroundColor" in block && block.backgroundColor) {
    return { backgroundColor: block.backgroundColor, margin: "0 -13px", padding: "18px 20px" };
  }
  return {};
}
export function DocumentBuilder({ document, onChange, variables, universalBlocks = [], mediaAssets = [], previewMode = "desktop", templateSettings = {}, brandColors = [], onTemplateSettingsChange, messageSettings = { subject: "", preheader: "", plainText: "", category: null, notes: "", templateType: "email_template", useCase: "", tags: "" }, onMessageSettingsChange = () => undefined, focusMessageTabKey = 0, defaultInspector }: { document: StructuredEmailDocument; onChange: (document: StructuredEmailDocument) => void; variables: Variable[]; universalBlocks?: UniversalBlock[]; mediaAssets?: MediaAsset[]; previewMode?: Exclude<PreviewMode, "plain">; templateSettings?: TemplateDesignSettings; brandColors?: string[]; onTemplateSettingsChange?: (settings: Partial<TemplateDesignSettings>) => void; messageSettings?: MessageSettings; onMessageSettingsChange?: (settings: Partial<MessageSettings>) => void; focusMessageTabKey?: number; defaultInspector?: ReactNode }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("blocks");
  const [templateSettingsTab, setTemplateSettingsTab] = useState<TemplateSettingsTab>("styles");
  useEffect(() => {
    if (!focusMessageTabKey) return;
    setSelectedIndex(null);
    setTemplateSettingsTab("message");
  }, [focusMessageTabKey]);
  const messageIncomplete = !messageSettings.subject.trim() || !messageSettings.plainText.trim();
  const unconvertedImport = isImportedHtmlDocument(document);
  const selected = selectedIndex === null ? undefined : document.blocks[selectedIndex];
  const editable = selected && contentOnly(selected) ? selected : undefined;
  const update = (blocks: StructuredBlock[]) => onChange({ schemaVersion: 1, blocks });
  const insert = (items: ContentBlock[], position?: number) => { const footer = document.blocks.find(block => block.type === "compliance_footer"); const content = document.blocks.filter(contentOnly); const at = Math.max(0, Math.min(position ?? (selectedIndex === null ? content.length : selectedIndex + 1), content.length)); content.splice(at, 0, ...items); update([...content, ...(footer ? [footer] : [])]); setSelectedIndex(at); };
  const add = (item: PaletteItem) => insert(item.create ? item.create() : item.type ? [newBlock(item.type)] : []);
  const updateSelected = (next: ContentBlock) => { if (selectedIndex !== null) update(document.blocks.map((block, index) => index === selectedIndex ? next : block)); };
  const move = (delta: number) => { if (selectedIndex === null || !editable) return; const destination = selectedIndex + delta; if (destination < 0 || destination >= document.blocks.length || !contentOnly(document.blocks[destination]!)) return; const blocks = [...document.blocks]; const [moving] = blocks.splice(selectedIndex, 1); if (!moving) return; blocks.splice(destination, 0, moving); update(blocks); setSelectedIndex(destination); };
  const duplicate = () => { if (editable && selectedIndex !== null) insert([cloneBlock(editable)], selectedIndex + 1); };
  const remove = () => { if (editable && selectedIndex !== null) { update(document.blocks.filter((_, index) => index !== selectedIndex)); setSelectedIndex(null); } };
  const updateText = (patch: TextPatch) => { if (editable && textOnly(editable)) updateSelected({ ...editable, ...patch }); };
  const emailWidth = resolvedEmailWidth(templateSettings);
  const canvasStyle: CSSProperties = {
    backgroundColor: templateSettings.bodyBackgroundColor ?? "#ffffff",
    width: previewMode === "mobile" ? undefined : emailWidth,
    maxWidth: previewMode === "mobile" ? undefined : emailWidth,
    fontFamily: templateSettings.fontFamily,
  };
  const stageStyle: CSSProperties = { backgroundColor: templateSettings.backgroundColor ?? "#eef1f0" };
  const contentBlockCount = document.blocks.filter(contentOnly).length;
  return (
    <div className="builder-shell">
      <ElementLibrary tab={libraryTab} setTab={setLibraryTab} blocks={universalBlocks} onAdd={add} onInsert={insert} />
      <main className="builder-stage" style={stageStyle} onClick={event => { if (event.target === event.currentTarget) setSelectedIndex(null); }}>
        <div className="stage-label">
          <span>{previewMode === "mobile" ? "Mobile design" : "Desktop design"}</span>
          <span>{previewMode === "mobile" ? "390px" : `${emailWidth}px`}{contentBlockCount ? ` · ${contentBlockCount} blocks` : ""}{unconvertedImport ? " · convert to edit" : ""}</span>
        </div>
        <article
          style={canvasStyle}
          className={`email-canvas premium-email-canvas ${previewMode === "mobile" ? "email-canvas-mobile" : ""}`}
          onClick={event => { if (event.target === event.currentTarget) setSelectedIndex(null); }}
        >
          {!document.blocks.some(contentOnly) && <div className="canvas-empty"><span aria-hidden="true">✦</span><h2>Start designing your email</h2><p>Add content from the panel or begin with a ready-made section.</p><button type="button" onClick={() => add(palette[0]!) }>Add a heading</button></div>}
          {document.blocks.map((block, index) => <CanvasBlock key={block.id} block={block} selected={index === selectedIndex} variables={variables} onSelect={() => setSelectedIndex(index)} onMove={move} onDuplicate={duplicate} onRemove={remove} onTextChange={updateText} onBlockChange={updateSelected} />)}
        </article>
      </main>
      <aside className="builder-inspector" aria-label={editable ? "Block settings" : "Email settings"}>
        {editable && messageIncomplete && <div className="inspector-message-nudge" role="status"><strong>Inbox settings need attention</strong><p>Add a subject and plain-text version before publishing.</p><button type="button" className="button-secondary" onClick={() => { setSelectedIndex(null); setTemplateSettingsTab("message"); }}>Open message settings</button></div>}
        {editable
          ? <BlockInspector block={editable} variables={variables} mediaAssets={mediaAssets} brandColors={brandColors} onChange={updateSelected} onMove={move} onDuplicate={duplicate} onRemove={remove} />
          : defaultInspector ?? <TemplateInspector tab={templateSettingsTab} onTabChange={setTemplateSettingsTab} settings={templateSettings} messageSettings={messageSettings} brandColors={brandColors} onChange={onTemplateSettingsChange} onMessageSettingsChange={onMessageSettingsChange} />}
      </aside>
    </div>
  );
}

function ElementLibrary({ tab, setTab, blocks, onAdd, onInsert }: { tab: LibraryTab; setTab: (tab: LibraryTab) => void; blocks: UniversalBlock[]; onAdd: (item: PaletteItem) => void; onInsert: (blocks: ContentBlock[]) => void }) {
  const heading = { kicker: "Build", title: "Add content", subtitle: "Choose a block or section to add it to your email." };
  return (
    <aside className="builder-library" id="content-block-library" aria-label="Elements">
      <div className="library-heading">
        <span className="library-kicker">{heading.kicker}</span>
        <h2>{heading.title}</h2>
        <p>{heading.subtitle}</p>
      </div>
      <div className="library-tabs" role="tablist" aria-label="Element library">
        <button type="button" role="tab" aria-selected={tab === "blocks"} className={tab === "blocks" ? "active" : ""} onClick={() => setTab("blocks")}>Blocks</button>
        <button type="button" role="tab" aria-selected={tab === "sections"} className={tab === "sections" ? "active" : ""} onClick={() => setTab("sections")}>Sections</button>
        <button type="button" role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>Saved</button>
      </div>
      {tab === "blocks" && (
        <div className="element-card-grid">
          {palette.map(item => (
            <button type="button" key={item.label} className={`element-card ${item.unavailableReason ? "disabled" : ""}`} disabled={Boolean(item.unavailableReason)} title={item.unavailableReason ?? `Add ${item.label}`} onClick={() => onAdd(item)}>
              <span className="element-grip" aria-hidden="true">⠿</span>
              <span className="element-card-icon" aria-hidden="true">{item.icon}</span>
              <strong>{item.label}</strong>
              <small>{item.unavailableReason ? "Unavailable" : item.description}</small>
            </button>
          ))}
        </div>
      )}
      {tab === "sections" && (
        <div className="element-card-grid">
          {sectionPresets.map(section => (
            <button type="button" className="element-card" key={section.label} title={`Add ${section.label} section`} onClick={() => onInsert(section.create())}>
              <span className="element-grip" aria-hidden="true">⠿</span>
              <span className="element-card-icon" aria-hidden="true">{section.icon}</span>
              <strong>{section.label}</strong>
              <small>{section.description}</small>
            </button>
          ))}
        </div>
      )}
      {tab === "saved" && (blocks.length > 0 ? (
        <div className="element-card-grid">
          {blocks.map(block => (
            <button type="button" className="element-card" key={block.id} title={`Insert ${block.name}`} onClick={() => onInsert(block.blocks.map(cloneBlock))}>
              <span className="element-grip" aria-hidden="true">⠿</span>
              <span className="element-card-icon" aria-hidden="true">✦</span>
              <strong>{block.name}</strong>
              <small>Reusable block</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="library-empty"><span>✦</span><strong>No saved blocks yet</strong><p>Save a reusable workspace block to insert it here.</p></div>
      ))}
    </aside>
  );
}

function MessageSettingsFields({ messageSettings, onMessageSettingsChange, metadataOnly }: { messageSettings: MessageSettings; onMessageSettingsChange: (settings: Partial<MessageSettings>) => void; metadataOnly?: boolean }) {
  if (metadataOnly) {
    return (
      <>
        <p className="inspector-help">Subject, preview text, and plain text live above the canvas and in the Plain text view—not as blocks.</p>
        <Field label="Category"><input maxLength={80} value={messageSettings.category ?? ""} onChange={event => onMessageSettingsChange({ category: event.target.value || null })} placeholder="e.g. Welcome series" /></Field>
        <Field label="Template type"><select value={messageSettings.templateType || "email_template"} onChange={event => onMessageSettingsChange({ templateType: event.target.value })}><option value="email_template">Email template</option></select></Field>
        <Field label="Use case"><input value={messageSettings.useCase} onChange={event => onMessageSettingsChange({ useCase: event.target.value })} placeholder="e.g. New subscriber welcome" /></Field>
        <Field label="Tags"><input value={messageSettings.tags} onChange={event => onMessageSettingsChange({ tags: event.target.value })} placeholder="welcome, lifecycle, onboarding" /></Field>
        <Field label="Notes / internal description"><textarea rows={4} value={messageSettings.notes} onChange={event => onMessageSettingsChange({ notes: event.target.value })} placeholder="Internal notes for your team" /></Field>
      </>
    );
  }
  const subjectMissing = !messageSettings.subject.trim();
  const plainMissing = !messageSettings.plainText.trim();
  return (
    <>
      <Field label={subjectMissing ? "Subject (required)" : "Subject"}><input value={messageSettings.subject} onChange={event => onMessageSettingsChange({ subject: event.target.value })} placeholder="Your email subject" /></Field>
      <Field label="Preheader"><input value={messageSettings.preheader} onChange={event => onMessageSettingsChange({ preheader: event.target.value })} placeholder="Short inbox preview text" /></Field>
      <Field label={plainMissing ? "Plain-text alternative (required)" : "Plain-text alternative"}><textarea rows={5} value={messageSettings.plainText} onChange={event => onMessageSettingsChange({ plainText: event.target.value })} placeholder="Readable plain-text version" /></Field>
    </>
  );
}

function CanvasBlock({ block, selected, variables, onSelect, onMove, onDuplicate, onRemove, onTextChange, onBlockChange }: { block: StructuredBlock; selected: boolean; variables: Variable[]; onSelect: () => void; onMove: (delta: number) => void; onDuplicate: () => void; onRemove: () => void; onTextChange: (patch: TextPatch) => void; onBlockChange: (block: ContentBlock) => void }) { const keydown = (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }; if (block.type === "compliance_footer") return <div className="email-compliance-card"><span>✓</span><div><strong>Required compliance footer</strong><p>Business identity, address, unsubscribe, and preferences links are added at send time.</p></div></div>; const text = textOnly(block) ? block : undefined; const image = block.type === "image" ? block : undefined; const isSection = block.type === "custom_html"; const blockClass = `canvas-block${selected ? " selected" : ""}${isSection ? " canvas-block-section" : ""}${"backgroundColor" in block && block.backgroundColor ? " canvas-block-surface" : ""}`; return <section className={blockClass} role="button" tabIndex={0} onClick={event => { event.stopPropagation(); onSelect(); }} onKeyDown={keydown} style={isSection ? undefined : blockSurfaceStyle(block)}><span className={`canvas-block-label${selected ? " is-selected" : ""}`}>{isSection ? "Section" : blockTypeLabel(block)}</span>{selected && <div className="block-floating-toolbar" role="toolbar" aria-label={`${block.type} block toolbar`} onClick={event => event.stopPropagation()}><button type="button" title="Move block up" aria-label="Move block up" onClick={() => onMove(-1)}>↑</button><button type="button" title="Move block down" aria-label="Move block down" onClick={() => onMove(1)}>↓</button>{text && <><button type="button" className={text.style?.fontWeight === "bold" ? "active" : ""} title="Bold" aria-label="Bold" onClick={() => onTextChange({ style: { ...text.style, fontWeight: text.style?.fontWeight === "bold" ? "normal" : "bold" } })}>B</button><button type="button" className={text.style?.italic ? "active" : ""} title="Italic" aria-label="Italic" onClick={() => onTextChange({ style: { ...text.style, italic: !text.style?.italic } })}>I</button><button type="button" title="Center align" aria-label="Center align" onClick={() => onTextChange({ align: text.align === "center" ? "left" : "center" })}>≡</button>{variables.length > 0 && <button type="button" title="Insert personalization variable" aria-label="Insert personalization variable" onClick={() => onTextChange({ text: `${text.text}${text.text ? " " : ""}{{ ${variables[0]!.key}${variables[0]!.requiresFallback ? ' | default: "there"' : ""} }}` })}>{"{{ }}"}</button>}</>}{image && <button type="button" title="Align image" aria-label="Align image" onClick={() => onBlockChange({ ...image, align: image.align === "center" ? "left" : "center" })}>↔</button>}<button type="button" title="Duplicate block" aria-label="Duplicate block" onClick={onDuplicate}>⧉</button><button type="button" className="danger" title="Delete block" aria-label="Delete block" onClick={onRemove}>×</button></div>}<CanvasPreview block={block} /></section>; }
function CanvasPreview({ block }: { block: ContentBlock }) { if (block.type === "custom_html") return <CustomHtmlPreview html={block.html} label={block.label} section />; if (block.type === "heading") { const Tag = block.level === 1 ? "h1" : block.level === 3 ? "h3" : "h2"; return <Tag className="canvas-native-text" style={textStyle(block)}>{block.text || "Add a heading"}</Tag>; } if (block.type === "header") return <div className="canvas-native-text" style={textStyle(block)}>{block.text || "Your brand"}</div>; if (block.type === "text" || block.type === "footer") return <p className="canvas-native-text" style={textStyle(block)}>{block.text || "Write your message here."}</p>; if (block.type === "image") return block.src ? <div className="canvas-image" style={{ textAlign: block.align }}><img src={block.src} alt={block.alt} style={{ maxWidth: "100%", borderRadius: block.borderRadius }} /></div> : <div className="image-placeholder"><span aria-hidden="true">▧</span><strong>Add an image</strong><p>Add an image URL or select from media.</p></div>; if (block.type === "button") return <p style={{ textAlign: block.align }}><span className="canvas-button" style={{ backgroundColor: block.backgroundColor, color: block.textColor }}>{block.label || "Call to action"}</span></p>; if (block.type === "divider") return <hr style={{ borderTopColor: block.color, borderTopStyle: block.style }} />; if (block.type === "spacer") return <div className="canvas-spacer" style={{ height: block.height }}>Spacer · {block.height}px</div>; if (block.type === "social") return <p className="canvas-social">{block.links.map(link => link.label).join(" · ") || "Social links"}</p>; return <div className="canvas-columns">{block.columns.map(column => <div key={column.id}>{column.blocks.map(child => <CanvasPreview block={child} key={child.id} />)}</div>)}</div>; }

function BlockInspector({ block, variables, mediaAssets, brandColors, onChange, onMove, onDuplicate, onRemove }: { block: ContentBlock; variables: Variable[]; mediaAssets: MediaAsset[]; brandColors: string[]; onChange: (block: ContentBlock) => void; onMove: (delta: number) => void; onDuplicate: () => void; onRemove: () => void }) {
  const alignment = (value: string): EmailAlignment => value === "center" || value === "right" ? value : "left"; const controls = <div className="inspector-actions"><button type="button" onClick={() => onMove(-1)}>Move up</button><button type="button" onClick={() => onMove(1)}>Move down</button><button type="button" onClick={onDuplicate}>Duplicate</button><button type="button" className="danger-button" onClick={onRemove}>Delete block</button></div>;
  if (textOnly(block)) return <div className="inspector-content"><InspectorHeading title={block.type === "heading" ? "Heading" : block.type === "header" ? "Header" : block.type === "footer" ? "Footer" : "Text"} subtitle="Edit content and typography." /><div className="format-row"><button type="button" className={block.style?.fontWeight === "bold" ? "active" : ""} title="Bold" onClick={() => onChange({ ...block, style: { ...block.style, fontWeight: block.style?.fontWeight === "bold" ? "normal" : "bold" } })}>B</button><button type="button" className={block.style?.italic ? "active" : ""} title="Italic" onClick={() => onChange({ ...block, style: { ...block.style, italic: !block.style?.italic } })}>I</button><select aria-label="Text alignment" value={block.align ?? "left"} onChange={event => onChange({ ...block, align: alignment(event.target.value) })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div><Field label="Content"><textarea rows={7} value={block.text} onChange={event => onChange({ ...block, text: event.target.value })} /></Field><div className="field-grid"><Field label="Font"><select value={block.style?.fontFamily ?? "Arial, sans-serif"} onChange={event => onChange({ ...block, style: { ...block.style, fontFamily: event.target.value as EmailTextStyle["fontFamily"] } })}><option>Arial, sans-serif</option><option>Helvetica, Arial, sans-serif</option><option>Georgia, serif</option></select></Field><Field label="Size"><input type="number" min="10" max="48" value={block.style?.fontSize ?? 16} onChange={event => onChange({ ...block, style: { ...block.style, fontSize: Number(event.target.value) } })} /></Field></div><div className="field-grid"><Field label="Line height"><input type="number" min="1" max="2.5" step="0.1" value={block.style?.lineHeight ?? 1.5} onChange={event => onChange({ ...block, style: { ...block.style, lineHeight: Number(event.target.value) } })} /></Field><ColorSetting label="Text color" value={block.style?.color ?? "#2d2d2f"} swatches={brandColors} onChange={value => onChange({ ...block, style: { ...block.style, color: value } })} /></div><ColorSetting label="Section background" value={block.backgroundColor ?? "#ffffff"} swatches={brandColors} onChange={value => onChange({ ...block, backgroundColor: value === "#ffffff" ? undefined : value })} /><details className="variable-insert"><summary>Insert personalization</summary><div>{variables.length ? variables.map(variable => <button type="button" key={variable.key} onClick={() => onChange({ ...block, text: `${block.text}${block.text ? " " : ""}{{ ${variable.key}${variable.requiresFallback ? ' | default: "there"' : ""} }}` })}>{variable.label}</button>) : <p>No workspace variables are available.</p>}</div></details>{controls}</div>;
  if (block.type === "image") { const image: ImageBlock = block; return <div className="inspector-content"><InspectorHeading title="Image" subtitle="Configure the selected image block." /><Field label="Image URL"><input type="url" placeholder="https://…" value={image.src} onChange={event => onChange({ ...image, src: event.target.value })} /></Field>{mediaAssets.length > 0 ? <details className="media-select"><summary>Select from media library</summary><div>{mediaAssets.map(asset => <button type="button" key={asset.id} onClick={() => onChange({ ...image, src: asset.url, alt: asset.altText || image.alt })}><img src={asset.url} alt="" />{asset.name}</button>)}</div></details> : <p className="inspector-help">Add an asset in Content → Assets to select it here.</p>}<Field label="Alt text"><input value={image.alt} onChange={event => onChange({ ...image, alt: event.target.value })} /></Field><Field label="Link URL"><input type="url" placeholder="Optional https://…" value={image.link ?? ""} onChange={event => onChange({ ...image, link: event.target.value || undefined })} /></Field><div className="field-grid"><Field label="Width"><input type="number" min="1" max="1200" value={image.width ?? 600} onChange={event => onChange({ ...image, width: Number(event.target.value) })} /></Field><Field label="Corner radius"><input type="number" min="0" max="80" value={image.borderRadius ?? 0} onChange={event => onChange({ ...image, borderRadius: Number(event.target.value) })} /></Field></div><Field label="Alignment"><select value={image.align ?? "center"} onChange={event => onChange({ ...image, align: alignment(event.target.value) })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field><div className="field-grid"><Field label="Padding top"><input type="number" min="0" max="80" value={image.spacing?.top ?? 0} onChange={event => onChange({ ...image, spacing: { ...image.spacing, top: Number(event.target.value) } })} /></Field><Field label="Padding bottom"><input type="number" min="0" max="80" value={image.spacing?.bottom ?? 16} onChange={event => onChange({ ...image, spacing: { ...image.spacing, bottom: Number(event.target.value) } })} /></Field></div>{controls}</div>; }
  if (block.type === "button") return <div className="inspector-content"><InspectorHeading title="Button" subtitle="Edit this call to action." /><Field label="Button text"><input value={block.label} onChange={event => onChange({ ...block, label: event.target.value })} /></Field><Field label="Destination URL"><input type="url" value={block.url} onChange={event => onChange({ ...block, url: event.target.value })} /></Field><div className="field-grid"><ColorSetting label="Background" value={block.backgroundColor ?? "#6846ed"} swatches={brandColors} onChange={value => onChange({ ...block, backgroundColor: value })} /><ColorSetting label="Text color" value={block.textColor ?? "#ffffff"} swatches={brandColors} onChange={value => onChange({ ...block, textColor: value })} /></div><Field label="Alignment"><select value={block.align ?? "center"} onChange={event => onChange({ ...block, align: alignment(event.target.value) })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>{controls}</div>;
  if (block.type === "spacer") return <div className="inspector-content"><InspectorHeading title="Spacer" /><Field label="Height"><input type="number" min="0" max="120" value={block.height} onChange={event => onChange({ ...block, height: Number(event.target.value) })} /></Field>{controls}</div>;
  if (block.type === "divider") return <div className="inspector-content"><InspectorHeading title="Divider" /><ColorSetting label="Color" value={block.color ?? "#ded8e6"} swatches={brandColors} onChange={value => onChange({ ...block, color: value })} /><Field label="Style"><select value={block.style ?? "solid"} onChange={event => onChange({ ...block, style: event.target.value === "dashed" ? "dashed" : "solid" })}><option value="solid">Solid</option><option value="dashed">Dashed</option></select></Field>{controls}</div>;
  if (block.type === "social") return <div className="inspector-content"><InspectorHeading title="Social links" subtitle="Add a labelled destination." /><Field label="Label"><input value={block.links[0]?.label ?? ""} onChange={event => onChange({ ...block, links: [{ label: event.target.value, url: block.links[0]?.url ?? "https://example.com" }] })} /></Field><Field label="HTTPS URL"><input type="url" value={block.links[0]?.url ?? ""} onChange={event => onChange({ ...block, links: [{ label: block.links[0]?.label ?? "Website", url: event.target.value }] })} /></Field>{controls}</div>;
  if (block.type === "custom_html") return <div className="inspector-content"><InspectorHeading title="Custom HTML" subtitle="Edit imported HTML safely. Scripts and event handlers are blocked on save." /><Field label="Section label"><input value={block.label ?? "Custom HTML"} onChange={event => onChange({ ...block, label: event.target.value })} /></Field><Field label="HTML"><textarea rows={14} value={block.html} onChange={event => onChange({ ...block, html: event.target.value })} spellCheck={false} /></Field>{block.needsReview && <p className="inspector-help">This section may need layout review after conversion.</p>}{controls}</div>;
  return <div className="inspector-content"><InspectorHeading title="Columns" subtitle="Each column contains editable email-safe copy." />{block.columns.map((column, index) => { const text = column.blocks.find(textOnly); return <Field label={`Column ${index + 1}`} key={column.id}><textarea rows={4} value={text?.text ?? ""} onChange={event => onChange({ ...block, columns: block.columns.map(current => current.id !== column.id ? current : { ...current, blocks: [{ id: text?.id ?? createId(), type: "text", text: event.target.value }] }) })} /></Field>; })}<Field label="Number of columns"><select value={block.columns.length} onChange={event => { const count = Number(event.target.value); const columns = Array.from({ length: count }, (_, index) => block.columns[index] ?? { id: createId(), blocks: [newBlock("text")] }); onChange({ ...block, columns }); }}><option value="2">2 columns</option><option value="3">3 columns</option><option value="4">4 columns</option></select></Field>{controls}</div>;
}

function TemplateInspector({ tab, onTabChange, settings, messageSettings, brandColors, onChange, onMessageSettingsChange }: { tab: TemplateSettingsTab; onTabChange: (tab: TemplateSettingsTab) => void; settings: TemplateDesignSettings; messageSettings: MessageSettings; brandColors: string[]; onChange?: (settings: Partial<TemplateDesignSettings>) => void; onMessageSettingsChange: (settings: Partial<MessageSettings>) => void }) {
  const patch = (next: Partial<TemplateDesignSettings>) => onChange?.({ ...next, recentColors: [...new Set([...(settings.recentColors ?? []), ...Object.values(next).filter((value): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))])].slice(-8) });
  return <div className="inspector-content template-inspector">
    <InspectorHeading title="Email settings" subtitle="Set global design and inbox defaults." />
    <div className="inspector-tabs" role="tablist" aria-label="Email settings">
      <button type="button" role="tab" aria-selected={tab === "styles"} className={tab === "styles" ? "active" : ""} onClick={() => onTabChange("styles")}>Styles</button>
      <button type="button" role="tab" aria-selected={tab === "message"} className={tab === "message" ? "active" : ""} onClick={() => onTabChange("message")}>Message</button>
    </div>
    {tab === "styles" ? <>
      <div className="inspector-section-label">Email canvas</div>
      <ColorSetting label="Template background" value={settings.backgroundColor ?? "#f5f3f8"} swatches={brandColors} onChange={value => patch({ backgroundColor: value })} />
      <ColorSetting label="Content background" value={settings.bodyBackgroundColor ?? "#ffffff"} swatches={brandColors} onChange={value => patch({ bodyBackgroundColor: value })} />
      <div className="field-grid"><Field label="Content width"><input type="number" min="480" max="760" value={settings.emailWidth ?? 700} onChange={event => patch({ emailWidth: Number(event.target.value) })} /></Field><Field label="Spacing"><select value={settings.spacingScale ?? "comfortable"} onChange={event => patch({ spacingScale: event.target.value })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></Field></div>
      <div className="inspector-section-label">Typography</div>
      <Field label="Default font"><select value={settings.fontFamily ?? "Arial, sans-serif"} onChange={event => patch({ fontFamily: event.target.value as EmailTextStyle["fontFamily"] })}><option>Arial, sans-serif</option><option>Helvetica, Arial, sans-serif</option><option>Georgia, serif</option></select></Field>
      <div className="field-grid"><Field label="Heading size"><input type="number" min="10" max="48" value={settings.headingFontSize ?? 32} onChange={event => patch({ headingFontSize: Number(event.target.value) })} /></Field><Field label="Body size"><input type="number" min="10" max="48" value={settings.bodyFontSize ?? 16} onChange={event => patch({ bodyFontSize: Number(event.target.value) })} /></Field></div>
      <ColorSetting label="Link color" value={settings.defaultLinkColor ?? "#6846ed"} swatches={[...brandColors, ...(settings.recentColors ?? [])]} onChange={value => patch({ defaultLinkColor: value })} />
      <div className="inspector-section-label">Brand and controls</div>
      <Field label="Logo URL"><input type="url" placeholder="https://…" value={settings.logoUrl ?? ""} onChange={event => patch({ logoUrl: event.target.value })} /></Field>
      <div className="field-grid"><Field label="Button radius"><input type="number" min="0" max="24" value={settings.buttonRadius ?? 8} onChange={event => patch({ buttonRadius: Number(event.target.value) })} /></Field><Field label="Footer style"><select value={settings.footerStyle ?? "compliance"} onChange={event => patch({ footerStyle: event.target.value })}><option value="compliance">Compliance</option><option value="minimal">Minimal</option></select></Field></div>
    </> : <>
      <div className="inspector-section-label">Inbox details</div>
      <MessageSettingsFields messageSettings={messageSettings} onMessageSettingsChange={onMessageSettingsChange} />
      <div className="inbox-mini-preview"><span>Inbox preview</span><strong>{messageSettings.subject || "Your subject line"}</strong><p>{messageSettings.preheader || "Add preview text to support your subject."}</p></div>
      <div className="inspector-section-label">Organization</div>
      <Field label="Category"><input maxLength={80} value={messageSettings.category ?? ""} onChange={event => onMessageSettingsChange({ category: event.target.value || null })} placeholder="e.g. Lifecycle" /></Field>
      <Field label="Use case"><input value={messageSettings.useCase} onChange={event => onMessageSettingsChange({ useCase: event.target.value })} placeholder="e.g. Cart recovery" /></Field>
      <Field label="Tags"><input value={messageSettings.tags} onChange={event => onMessageSettingsChange({ tags: event.target.value })} placeholder="commerce, recovery" /></Field>
      <Field label="Internal notes"><textarea rows={4} value={messageSettings.notes} onChange={event => onMessageSettingsChange({ notes: event.target.value })} placeholder="Visible only to your team" /></Field>
    </>}
  </div>;
}
function ColorSetting({ label, value, swatches, onChange }: { label: string; value: string; swatches: string[]; onChange: (value: string) => void }) { return <Field label={label}><div className="color-setting"><input type="color" value={value} onChange={event => onChange(event.target.value)} /><input aria-label={`${label} hex value`} pattern="^#[0-9a-fA-F]{6}$" value={value} onChange={event => { const next = event.target.value; if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next); }} /><div className="color-swatches">{[...new Set(swatches.filter(color => /^#[0-9a-fA-F]{6}$/.test(color)))].slice(0, 6).map(color => <button type="button" title={`Use ${color}`} aria-label={`Use ${color}`} key={color} style={{ backgroundColor: color }} onClick={() => onChange(color)} />)}</div></div></Field>; }
function InspectorHeading({ title, subtitle }: { title: string; subtitle?: string }) { return <header className="inspector-heading"><span>{title.slice(0, 1).toUpperCase()}</span><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="inspector-field"><span>{label}</span>{children}</label>; }
