"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { StructuredBlock, StructuredEmailDocument } from "../../../../../packages/domain/src/phase2/content";
import { ConfirmationDialog } from "../confirmation-dialog";
import { redirectForWorkspaceAccessFailure } from "../../lib/api-auth";
import { phase1Api } from "../../lib/phase1-api";
import { ContentTabs } from "./content-tabs";
import { CreateTemplateChoiceModal, TemplateImportModal } from "./template-import-modal";

type TemplateSource = "system" | "workspace";
type GalleryTab = "all" | "starter" | "mine" | "saved" | "html";
type Sort = "newest" | "popular" | "recent";
interface TemplateSettings { templateType?: string; useCase?: string; industry?: string; style?: string; tags?: unknown; favorite?: boolean; lastUsedAt?: string }
interface WorkspaceTemplate { id: string; name: string; category: string | null; document: StructuredEmailDocument; subject: string; preheader: string; plainText: string; settings: TemplateSettings | null; templateType?: string; importMethod?: string | null; originalFilename?: string | null; importedAt?: string | null; createdAt: string; updatedAt: string; archivedAt: string | null }
interface SystemTemplate { id: string; name: string; category: string; type: string; useCase: string; industry: string; style: string; tags: readonly string[]; document: StructuredEmailDocument; subject: string; preheader: string; plainText: string; settings: TemplateSettings }
interface TemplateLibraryResponse { items: WorkspaceTemplate[]; nextCursor: string | null; systemTemplates: SystemTemplate[] }
interface GalleryItem { source: TemplateSource; template: WorkspaceTemplate | SystemTemplate }

const tabs: Array<{ id: GalleryTab; label: string }> = [{ id: "all", label: "All templates" }, { id: "starter", label: "Starter templates" }, { id: "mine", label: "My templates" }, { id: "saved", label: "Saved templates" }, { id: "html", label: "HTML templates" }];
const readableDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
const metadata = (template: WorkspaceTemplate | SystemTemplate) => {
  const settings = template.settings ?? {};
  return { type: settings.templateType ?? ("templateType" in template ? template.templateType : undefined) ?? ("type" in template ? template.type : "email"), useCase: settings.useCase ?? ("useCase" in template ? template.useCase : "Reusable workspace template"), industry: settings.industry ?? ("industry" in template ? template.industry : "General"), style: settings.style ?? ("style" in template ? template.style : "Modern"), tags: Array.isArray(settings.tags) ? settings.tags.filter((tag): tag is string => typeof tag === "string") : ("tags" in template ? [...template.tags] : []), favorite: settings.favorite === true, lastUsedAt: settings.lastUsedAt };
};

export function TemplateLibrary({ workspaceId }: { workspaceId: string }) {
  const [workspaceTemplates, setWorkspaceTemplates] = useState<WorkspaceTemplate[]>([]);
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  const [tab, setTab] = useState<GalleryTab>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [style, setStyle] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [blankFormOpen, setBlankFormOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (archived) params.set("archived", "true");
      const response = await phase1Api<TemplateLibraryResponse>(`/api/v1/workspaces/${workspaceId}/content/templates?${params}`);
      setWorkspaceTemplates(response.items);
      setSystemTemplates(response.systemTemplates);
      setError("");
    } catch (reason) {
      if (await redirectForWorkspaceAccessFailure(workspaceId, reason)) return;
      setError(reason instanceof Error ? reason.message : "Unable to load templates.");
      setWorkspaceTemplates([]);
      setSystemTemplates([]);
    } finally { setLoading(false); }
  }, [archived, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const allItems = useMemo<GalleryItem[]>(() => {
    const sourceItems: GalleryItem[] = archived ? workspaceTemplates.map(template => ({ source: "workspace", template })) : [...systemTemplates.map(template => ({ source: "system" as const, template })), ...workspaceTemplates.map(template => ({ source: "workspace" as const, template }))];
    const filtered = sourceItems.filter(item => {
      const meta = metadata(item.template);
      const search = `${item.template.name} ${item.template.category ?? ""} ${meta.useCase} ${meta.tags.join(" ")}`.toLowerCase();
      if (query.trim() && !search.includes(query.trim().toLowerCase())) return false;
      if (tab === "starter" && item.source !== "system") return false;
      if (tab === "mine" && item.source !== "workspace") return false;
      if (tab === "saved" && (item.source !== "workspace" || !meta.favorite)) return false;
      if (tab === "html" && meta.type !== "html" && !("templateType" in item.template && (item.template.templateType === "imported_html" || item.template.templateType === "converted_import"))) return false;
      return (category === "all" || item.template.category === category) && (type === "all" || meta.type === type) && (industry === "all" || meta.industry === industry) && (style === "all" || meta.style === style);
    });
    return filtered.sort((a, b) => {
      const left = metadata(a.template), right = metadata(b.template);
      if (sort === "popular") return Number(right.favorite) - Number(left.favorite) || a.template.name.localeCompare(b.template.name);
      if (sort === "recent") return (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") || a.template.name.localeCompare(b.template.name);
      const leftDate = "updatedAt" in a.template ? a.template.updatedAt : "";
      const rightDate = "updatedAt" in b.template ? b.template.updatedAt : "";
      return rightDate.localeCompare(leftDate) || a.template.name.localeCompare(b.template.name);
    });
  }, [archived, category, industry, query, sort, style, systemTemplates, tab, type, workspaceTemplates]);
  const filterOptions = useMemo(() => ({ categories: [...new Set(allItems.map(item => item.template.category).filter((value): value is string => Boolean(value)))], types: [...new Set(allItems.map(item => metadata(item.template).type))], industries: [...new Set(allItems.map(item => metadata(item.template).industry))], styles: [...new Set(allItems.map(item => metadata(item.template).style))] }), [allItems]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newName.trim()) return; setPending(true);
    try { const saved = await phase1Api<WorkspaceTemplate>(`/api/v1/workspaces/${workspaceId}/content/templates`, { method: "POST", body: JSON.stringify({ name: newName.trim(), category: newCategory.trim() || undefined }) }); window.location.href = `/w/${workspaceId}/content/templates/${saved.id}/edit`; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create template."); setPending(false); }
  }
  async function useStarter(template: SystemTemplate) {
    setPending(true);
    try { const saved = await phase1Api<WorkspaceTemplate>(`/api/v1/workspaces/${workspaceId}/content/system-templates/${template.id}/use`, { method: "POST", body: "{}" }); window.location.href = `/w/${workspaceId}/content/templates/${saved.id}/edit`; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to use this starter template."); setPending(false); }
  }
  async function toggleFavorite(template: WorkspaceTemplate) {
    setPending(true);
    try { await phase1Api<WorkspaceTemplate>(`/api/v1/workspaces/${workspaceId}/content/templates/${template.id}/favorite`, { method: "POST", body: JSON.stringify({ favorite: !metadata(template).favorite }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save template."); } finally { setPending(false); }
  }
  async function duplicate(template: WorkspaceTemplate) {
    setPending(true);
    try { const saved = await phase1Api<WorkspaceTemplate>(`/api/v1/workspaces/${workspaceId}/content/templates/${template.id}/duplicate`, { method: "POST", body: JSON.stringify({ name: `${template.name} copy` }) }); window.location.href = `/w/${workspaceId}/content/templates/${saved.id}/edit`; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to duplicate template."); setPending(false); }
  }
  async function archive() {
    if (!archiveTarget) return; setPending(true);
    try { await phase1Api(`/api/v1/workspaces/${workspaceId}/content/templates/${archiveTarget.id}/archive`, { method: "POST", body: JSON.stringify({ archived: !archived }) }); setArchiveTarget(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update archive status."); } finally { setPending(false); }
  }

  return <section className="template-gallery">
    <header className="page-heading template-gallery-heading"><div><span className="eyebrow">Content library</span><h1>Templates</h1><p>Start from an editable, email-safe layout—or build your own reusable template.</p></div><div className="template-heading-actions"><button type="button" className="button-secondary" onClick={() => setImportOpen(true)}>Import template</button><button type="button" className="button-primary" onClick={() => setCreateOpen(true)}>+ Create template</button></div></header>
    <ContentTabs workspaceId={workspaceId} active="templates" />
    <nav className="template-gallery-tabs" aria-label="Template collections">{tabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}<label className="gallery-archive"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Archived</label></nav>
    <section className="template-gallery-filters" aria-label="Template filters"><label className="gallery-search"><span>Search</span><input placeholder="Search templates, tags, or use cases" value={query} onChange={event => setQuery(event.target.value)} /></label><GallerySelect label="Category" value={category} onChange={setCategory} options={filterOptions.categories} /><GallerySelect label="Type" value={type} onChange={setType} options={filterOptions.types} /><GallerySelect label="Industry" value={industry} onChange={setIndustry} options={filterOptions.industries} /><GallerySelect label="Style" value={style} onChange={setStyle} options={filterOptions.styles} /><label><span>Sort</span><select value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="newest">Newest</option><option value="popular">Popular</option><option value="recent">Recently used</option></select></label></section>
    {error && <section className="panel template-library-error" role="alert"><div><strong>We couldn’t load the template gallery.</strong><p>{error}</p></div><button type="button" className="button-secondary" onClick={() => void load()} disabled={loading}>Retry</button></section>}
    {loading ? <section className="template-gallery-grid" aria-label="Loading templates"><GallerySkeleton /><GallerySkeleton /><GallerySkeleton /></section> : allItems.length ? <section className="template-gallery-grid">{allItems.map(item => <TemplateCard key={`${item.source}:${item.template.id}`} item={item} pending={pending} archived={archived} onPreview={() => setPreview(item)} onUse={() => item.source === "system" ? void useStarter(item.template as SystemTemplate) : window.location.assign(`/w/${workspaceId}/content/templates/${item.template.id}/edit`)} onFavorite={() => item.source === "workspace" && void toggleFavorite(item.template as WorkspaceTemplate)} onDuplicate={() => item.source === "workspace" && void duplicate(item.template as WorkspaceTemplate)} onArchive={() => item.source === "workspace" && setArchiveTarget(item.template as WorkspaceTemplate)} />)}</section> : <section className="panel template-empty-state"><div className="template-empty-icon">✦</div><h2>{tab === "html" ? "No imported HTML templates yet" : "No templates match these filters."}</h2><p>{tab === "html" ? "Import HTML or a ZIP export from another email platform to see templates here." : "Try clearing a filter, or create a reusable workspace template."}</p>{tab === "html" ? <button type="button" className="button-primary" onClick={() => setImportOpen(true)}>Import template</button> : <button type="button" className="button-primary" onClick={() => setCreateOpen(true)}>Create template</button>}</section>}
    {createOpen && <CreateTemplateChoiceModal workspaceId={workspaceId} onClose={() => setCreateOpen(false)} onCreateBlank={() => { setCreateOpen(false); setBlankFormOpen(true); }} onOpenGallery={() => { setCreateOpen(false); setTab("starter"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
    {importOpen && <TemplateImportModal workspaceId={workspaceId} onClose={() => setImportOpen(false)} onSaved={id => { window.location.href = `/w/${workspaceId}/content/templates/${id}/edit`; }} />}
    {blankFormOpen && <div className="modal-backdrop" role="presentation"><section className="modal template-form-modal" role="dialog" aria-modal="true" aria-labelledby="new-template-title"><header><div><h2 id="new-template-title">Create template</h2><p>Create a blank, structured template you can design with real blocks.</p></div><button type="button" className="modal-close" onClick={() => setBlankFormOpen(false)}>×</button></header><form onSubmit={event => void create(event)}><label>Template name<input autoFocus required maxLength={160} value={newName} onChange={event => setNewName(event.target.value)} /></label><label>Category <span className="field-optional">Optional</span><input maxLength={80} value={newCategory} onChange={event => setNewCategory(event.target.value)} /></label><footer><button type="button" className="button-secondary" onClick={() => setBlankFormOpen(false)}>Cancel</button><button className="button-primary" disabled={pending || !newName.trim()}>Create template</button></footer></form></section></div>}
    {preview && <TemplatePreviewModal item={preview} onClose={() => setPreview(null)} onUse={() => preview.source === "system" ? void useStarter(preview.template as SystemTemplate) : window.location.assign(`/w/${workspaceId}/content/templates/${preview.template.id}/edit`)} />}
    <ConfirmationDialog open={Boolean(archiveTarget)} title={archived ? "Restore template?" : "Archive template?"} consequence={archived ? `Restore “${archiveTarget?.name ?? "this template"}” to the active gallery.` : `Archive “${archiveTarget?.name ?? "this template"}”? It remains restorable.`} confirmLabel={archived ? "Restore template" : "Archive template"} pending={pending} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archive()} />
  </section>;
}

function GallerySelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}><option value="all">All</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>; }
function TemplateCard({ item, pending, archived, onPreview, onUse, onFavorite, onDuplicate, onArchive }: { item: GalleryItem; pending: boolean; archived: boolean; onPreview: () => void; onUse: () => void; onFavorite: () => void; onDuplicate: () => void; onArchive: () => void }) { const { template, source } = item; const meta = metadata(template); return <article className="template-gallery-card"><TemplateThumbnail document={template.document} /><div className="gallery-card-body"><div className="gallery-card-heading"><div><h2>{template.name}</h2><p>{template.category ?? "Uncategorized"} · {meta.type}</p></div><span className={`gallery-source ${source}`}>{archived ? "Archived" : source === "system" ? "Starter" : "My template"}</span></div><p className="gallery-use-case">{meta.useCase}</p><div className="gallery-tags">{meta.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>{"updatedAt" in template && <small>Updated {readableDate(template.updatedAt)}</small>}</div><footer><button type="button" className="button-secondary" onClick={onPreview}>Preview</button><button type="button" className="button-primary" disabled={pending} onClick={onUse}>{source === "system" ? "Use template" : "Open template"}</button>{source === "workspace" && <><button type="button" className="gallery-icon-button" title={meta.favorite ? "Remove from saved templates" : "Save template"} aria-label={meta.favorite ? "Remove from saved templates" : "Save template"} disabled={pending} onClick={onFavorite}>{meta.favorite ? "★" : "☆"}</button><details className="template-more"><summary aria-label="More template actions">•••</summary><div><button type="button" disabled={pending || archived} onClick={onDuplicate}>Duplicate</button><button type="button" disabled={pending} onClick={onArchive}>{archived ? "Restore" : "Archive"}</button></div></details></>}</footer></article>; }
function TemplateThumbnail({ document }: { document: StructuredEmailDocument }) { return <div className="template-thumbnail" aria-hidden="true">{document.blocks.filter(block => block.type !== "compliance_footer").slice(0, 8).map(block => <ThumbnailBlock key={block.id} block={block} />)}</div>; }
function ThumbnailBlock({ block }: { block: StructuredBlock }) { if (block.type === "custom_html") return <span className="thumbnail-block html" />; if (block.type === "image") return <span className="thumbnail-block image" />; if (block.type === "button") return <span className="thumbnail-block button" />; if (block.type === "columns") return <span className="thumbnail-columns"><i /><i /></span>; if (block.type === "divider") return <span className="thumbnail-block divider" />; if (block.type === "spacer") return <span className="thumbnail-block spacer" />; return <span className={`thumbnail-block ${block.type}`} />; }
function TemplatePreviewModal({ item, onClose, onUse }: { item: GalleryItem; onClose: () => void; onUse: () => void }) { return <div className="modal-backdrop"><section className="template-preview-modal" role="dialog" aria-modal="true" aria-labelledby="template-preview-title"><header><div><span>{item.source === "system" ? "Starter template" : "Workspace template"}</span><h2 id="template-preview-title">{item.template.name}</h2><p>{metadata(item.template).useCase}</p></div><button type="button" className="modal-close" onClick={onClose}>×</button></header><div className="template-preview-large"><TemplateThumbnail document={item.template.document} /></div><footer><button type="button" className="button-secondary" onClick={onClose}>Close</button><button type="button" className="button-primary" onClick={onUse}>{item.source === "system" ? "Use template" : "Open template"}</button></footer></section></div>; }
function GallerySkeleton() { return <article className="template-gallery-card template-library-skeleton"><div className="template-thumbnail" /><div className="gallery-card-body"><span /><span /></div></article>; }
