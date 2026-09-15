"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useState } from "react";
import { ConfirmationDialog } from "./confirmation-dialog";
import { phase1Api } from "../lib/phase1-api";

type List = { id: string; name: string };
type Row = { id: string; name: string; originalEmail: string; source: string; createdAt: string; lastActivityAt: string | null; eligibility: { eligible: boolean; code: string }; lists: List[] };
type Overview = { items: Row[]; limit: number; cursor: string | null; nextCursor: string | null; summary: { total: number; reachable: number; withdrawn: number; suppressed: number }; sources: string[]; partial?: boolean };
type PropertyDefinition = { key: string; displayName: string; dataType: "text" | "number" | "boolean" | "datetime" | "text_array" };

const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const eligibilityLabel = (code: string) => code === "ELIGIBLE" ? "Subscribed" : code.replace(/^SUPPRESSED_/, "Blocked · ").replaceAll("_", " ").replace(/\b\w/g, value => value.toUpperCase());

export function ProfileManager({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState({ eligibility: "", list: "", source: "" });
  const [limit, setLimit] = useState(20);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columns, setColumns] = useState({ lists: true, activity: true, source: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      if (deferredQuery.trim()) params.set("q", deferredQuery.trim());
      Object.entries(filter).forEach(([key, value]) => value && params.set(key, value));
      const [overview, availableLists] = await Promise.all([
        phase1Api<Overview>(`/api/v1/workspaces/${workspaceId}/profiles/overview?${params}`),
        phase1Api<{ items: List[] }>(`/api/v1/workspaces/${workspaceId}/lists`),
      ]);
      setData(overview); setLists(availableLists.items); setError("");
    } catch (caught: any) { setError(caught.message ?? "Unable to load profiles."); } finally { setLoading(false); }
  }, [cursor, deferredQuery, filter, limit, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setCursor(null); setHistory([]); }, [deferredQuery, filter, limit]);

  const allSelected = Boolean(data?.items.length) && data!.items.every(row => selected.includes(row.id));
  const count = data?.summary.total ?? 0;
  const deleteProfiles = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await Promise.all(selected.map(id => phase1Api(`/api/v1/workspaces/${workspaceId}/profiles/${id}`, { method: "DELETE" })));
      setSelected([]); setDeleteOpen(false); await load();
    } catch (caught: any) { setDeleteError(caught.message ?? "Unable to delete profiles."); } finally { setDeleting(false); }
  };
  return <main className="profiles-modern">
    <header className="profiles-modern-header">
      <div><h1>Profiles</h1><nav className="profiles-tabs" aria-label="Profile views"><button className="active">All profiles <span>{count}</span></button></nav></div>
      <div className="profiles-cta-group"><button className="profile-create-button" onClick={() => setDrawerOpen(true)}>Create profile</button><a className="profile-import-button" href={`/w/${workspaceId}/imports`}>Import profiles</a></div>
    </header>
    <section className="profiles-filter-row" aria-label="Profile filters">
      <select aria-label="Load a list or segment" value={filter.list} onChange={event => setFilter(current => ({ ...current, list: event.target.value }))}><option value="">Load a list or segment</option>{lists.map(list => <option value={list.id} key={list.id}>{list.name}</option>)}</select>
      <select aria-label="Add filter" value={filter.eligibility} onChange={event => setFilter(current => ({ ...current, eligibility: event.target.value }))}><option value="">Add filter</option><option value="eligible">Subscribed</option><option value="suppressed">Blocked</option><option value="no_marketing_consent">No marketing consent</option></select>
      <select aria-label="Profile source" value={filter.source} onChange={event => setFilter(current => ({ ...current, source: event.target.value }))}><option value="">Any source</option>{data?.sources.map(source => <option value={source} key={source}>{source}</option>)}</select>
      {(filter.list || filter.eligibility || filter.source || query) && <button className="profiles-clear" onClick={() => { setQuery(""); setFilter({ eligibility: "", list: "", source: "" }); }}>Clear</button>}
    </section>
    <section className="profiles-list-toolbar"><span>{count} {count === 1 ? "profile" : "profiles"}</span><div><div className="profiles-column-menu"><button onClick={() => setColumnsOpen(open => !open)} aria-expanded={columnsOpen}>▣ Customize columns</button>{columnsOpen && <div className="profiles-column-popover">{Object.entries(columns).map(([key, checked]) => <label key={key}><input type="checkbox" checked={checked} onChange={() => setColumns(current => ({ ...current, [key]: !current[key as keyof typeof current] }))} />{key}</label>)}</div>}</div><label className="profiles-search"><span>⌕</span><input aria-label="Search profiles" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" /></label></div></section>
    {error ? <section className="profiles-error"><strong>Unable to load profiles.</strong><p>{error}</p><button onClick={load}>Retry</button></section> : <section className="profiles-table-card"><div className="profiles-table-wrap"><table><thead><tr><th><input aria-label="Select page" type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : data?.items.map(row => row.id) ?? [])} /></th><th>Profile</th><th>Subscribed</th><th>Blocked</th><th>Email</th>{columns.lists && <th>Lists</th>}{columns.activity && <th>Last changed</th>}{columns.source && <th>Source</th>}<th aria-label="Actions" /></tr></thead><tbody>{loading ? <tr><td colSpan={9}><div className="profiles-empty">Loading profiles…</div></td></tr> : data?.items.length ? data.items.map(row => <ProfileRow key={row.id} row={row} workspaceId={workspaceId} selected={selected.includes(row.id)} onSelect={() => setSelected(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])} columns={columns} />) : <tr><td colSpan={9}><div className="profiles-empty"><strong>{query || Object.values(filter).some(Boolean) ? "No profiles match these filters." : "No profiles yet."}</strong><p>{query || Object.values(filter).some(Boolean) ? "Try a different search or clear a filter." : "Create a profile or import a CSV to get started."}</p></div></td></tr>}</tbody></table></div><footer className="profiles-pagination"><label><select aria-label="Rows per page" value={limit} onChange={event => setLimit(Number(event.target.value))}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select> Rows per page</label><span>{data?.items.length ? `${history.length * limit + 1}-${history.length * limit + data.items.length} of ${count}` : `0 of ${count}`}</span><button aria-label="Previous page" disabled={!history.length} onClick={() => { const previous = history.at(-1) ?? null; setHistory(items => items.slice(0, -1)); setCursor(previous); }}>‹</button><button aria-label="Next page" disabled={!data?.nextCursor} onClick={() => { setHistory(items => [...items, cursor]); setCursor(data!.nextCursor); }}>›</button></footer></section>}
    {selected.length > 0 && <div className="profiles-bulk-bar" role="status">{selected.length} selected <button onClick={() => setSelected([])}>Clear</button><button onClick={() => setExportOpen(true)}>Export</button><button className="profiles-bulk-delete" onClick={() => { setDeleteError(""); setDeleteOpen(true); }}>Delete</button></div>}
    {drawerOpen && <ProfileDrawer workspaceId={workspaceId} onClose={() => setDrawerOpen(false)} onSaved={async () => { setDrawerOpen(false); await load(); }} />}{exportOpen && <ExportDialog workspaceId={workspaceId} ids={selected} total={count} onClose={() => setExportOpen(false)} />}
    <ConfirmationDialog open={deleteOpen} title={`Delete ${selected.length} profile${selected.length === 1 ? "" : "s"}?`} consequence="Deleted profiles are removed from lists and hidden from the workspace. Message history and audit records are retained." confirmLabel="Delete" pendingLabel="Deleting…" pending={deleting} error={deleteError} onCancel={() => { setDeleteOpen(false); setDeleteError(""); }} onConfirm={() => void deleteProfiles()} />
  </main>;
}

function ProfileRow({ row, workspaceId, selected, onSelect, columns }: { row: Row; workspaceId: string; selected: boolean; onSelect: () => void; columns: { lists: boolean; activity: boolean; source: boolean } }) {
  const href = `/w/${workspaceId}/profiles/${row.id}`, blocked = row.eligibility.code.includes("SUPPRESSED");
  return <tr><td><input aria-label={`Select ${row.originalEmail}`} type="checkbox" checked={selected} onChange={onSelect} /></td><td><a className="profiles-person" href={href}><span>{initials(row.name)}</span><strong>{row.name}</strong></a></td><td>{row.eligibility.eligible && <span className="profiles-channel">✉ Email</span>}</td><td>{blocked && <span className="profiles-blocked">{eligibilityLabel(row.eligibility.code)}</span>}</td><td><a className="profiles-email" href={href}>{row.originalEmail}</a></td>{columns.lists && <td className="profiles-truncate">{row.lists.map(list => list.name).join(", ") || "—"}</td>}{columns.activity && <td>{formatDate(row.lastActivityAt || row.createdAt)}</td>}{columns.source && <td>{row.source}</td>}<td><a className="profiles-view-link" href={href}>View</a></td></tr>;
}

function ProfileDrawer({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", locale: "", timezone: "", countryCode: "", region: "", city: "", source: "manual", consent: false, consentSource: "" });
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]); const [properties, setProperties] = useState<Record<string, unknown>>({}); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { void phase1Api<{ items: PropertyDefinition[] }>(`/api/v1/workspaces/${workspaceId}/property-definitions`).then(result => setDefinitions(result.items)).catch(() => setDefinitions([])); }, [workspaceId]);
  const set = (key: keyof typeof form, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const profile = await phase1Api<{ id: string }>(`/api/v1/workspaces/${workspaceId}/profiles`, { method: "POST", body: JSON.stringify({ ...form, properties }) }); if (form.consent) await phase1Api(`/api/v1/workspaces/${workspaceId}/profiles/${profile.id}/consent-records`, { method: "POST", body: JSON.stringify({ status: "granted", source: form.consentSource, occurredAt: new Date().toISOString() }) }); await onSaved(); } catch (caught: any) { setError(caught.message ?? "Unable to create profile."); } finally { setSaving(false); } };
  return <div className="profile-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><form className="profile-drawer" onSubmit={submit} aria-label="Create profile"><header><h2>Create a profile</h2><button type="button" aria-label="Close create profile" onClick={onClose}>×</button></header><div className="profile-drawer-body"><Field label="First name"><input value={form.firstName} placeholder="Enter first name" onChange={event => set("firstName", event.target.value)} /></Field><Field label="Last name"><input value={form.lastName} placeholder="Enter last name" onChange={event => set("lastName", event.target.value)} /></Field><Field label="Email"><input required type="email" value={form.email} placeholder="Enter email address" onChange={event => set("email", event.target.value)} /></Field><div className="profile-drawer-grid"><Field label="Country"><input value={form.countryCode} placeholder="Country code" onChange={event => set("countryCode", event.target.value)} /></Field><Field label="Locale"><input value={form.locale} placeholder="e.g. en-PK" onChange={event => set("locale", event.target.value)} /></Field><Field label="Timezone"><input value={form.timezone} placeholder="e.g. Asia/Karachi" onChange={event => set("timezone", event.target.value)} /></Field><Field label="City"><input value={form.city} placeholder="Enter city" onChange={event => set("city", event.target.value)} /></Field></div><Field label="Profile source"><input required value={form.source} onChange={event => set("source", event.target.value)} /></Field>{definitions.length > 0 && <section className="profile-custom-fields"><h3>Custom profile fields</h3>{definitions.map(definition => <Field label={definition.displayName} key={definition.key}><CustomField definition={definition} value={properties[definition.key]} onChange={value => setProperties(current => ({ ...current, [definition.key]: value }))} /></Field>)}</section>}<label className="profile-consent"><input type="checkbox" checked={form.consent} onChange={event => set("consent", event.target.checked)} /><span><strong>Record marketing consent</strong><small>Consent is stored separately from creating a profile.</small></span></label>{form.consent && <Field label="Consent source"><input required value={form.consentSource} placeholder="How consent was collected" onChange={event => set("consentSource", event.target.value)} /></Field>}{error && <p className="profile-drawer-error" role="alert">{error}</p>}</div><footer><button type="button" className="profile-cancel-button" onClick={onClose}>Cancel</button><button className="profile-save-button" disabled={saving}>{saving ? "Creating…" : "Create profile"}</button></footer></form></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="profile-field"><span>{label}</span>{children}</label>; }
function CustomField({ definition, value, onChange }: { definition: PropertyDefinition; value: unknown; onChange: (value: unknown) => void }) { if (definition.dataType === "boolean") return <select value={String(value ?? "")} onChange={event => onChange(event.target.value === "true")}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>; return <input type={definition.dataType === "number" ? "number" : definition.dataType === "datetime" ? "datetime-local" : "text"} value={String(value ?? "")} onChange={event => onChange(definition.dataType === "number" && event.target.value ? Number(event.target.value) : event.target.value)} />; }

function ExportDialog({ workspaceId, ids, total, onClose }: { workspaceId: string; ids: string[]; total: number; onClose: () => void }) { const [purpose, setPurpose] = useState("profile export"), [status, setStatus] = useState(""), [url, setUrl] = useState(""); const generate = async () => { try { setStatus("Generating export…"); const job = await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/exports`, { method: "POST", body: JSON.stringify({ profileIds: ids.length ? ids : undefined, purpose, fields: ["email", "first_name", "last_name"], ttlSeconds: 900 }) }); setUrl(`${process.env.NEXT_PUBLIC_EMAIL_PLATFORM_API_URL ?? "http://localhost:4000"}/api/v1/workspaces/${workspaceId}/exports/${job.id}/download?token=${encodeURIComponent(job.token)}`); setStatus("Export ready. The download link expires in 15 minutes."); } catch (caught: any) { setStatus(caught.message); } }; return <div className="modal-backdrop"><section className="modal-card"><div className="modal-head"><h2>Export profiles</h2><button onClick={onClose}>×</button></div><p>{ids.length ? `${ids.length} selected profile${ids.length === 1 ? "" : "s"}` : `${total} profiles in this workspace`}</p><label>Purpose / reason<input value={purpose} onChange={event => setPurpose(event.target.value)} /></label>{status && <p aria-live="polite">{status}</p>}<div className="modal-actions"><button className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" onClick={generate}>Generate export</button>{url && <a className="button-primary" href={url}>Download</a>}</div></section></div>; }
