'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import { phase1Api } from '../lib/phase1-api';

type IconName = 'home' | 'profiles' | 'audiences' | 'content' | 'flows' | 'deliverability' | 'analytics' | 'settings';
type Health = { state: string; verifiedDomains: number; feedback: string; lastCheckedAt: string | null };
type SearchData = { profiles: Array<{ id: string; originalEmail: string }>; flows: Array<{ id: string; name: string }>; messages: Array<{ id: string; state: string }> };

const navItems: Array<{ label: string; path: string; icon: IconName }> = [
  { label: 'Home', path: 'home', icon: 'home' },
  { label: 'Marketing', path: 'content/templates', icon: 'content' },
  { label: 'Automations', path: 'flows', icon: 'flows' },
  { label: 'Transactional', path: 'deliverability/overview', icon: 'deliverability' },
  { label: 'Analytics', path: 'analytics', icon: 'analytics' },
  { label: 'Settings', path: 'settings/general', icon: 'settings' },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 9 9-6 9 6" /><path d="M5 8v11h14V8M9 19v-5h6v5" /></>,
    profiles: <><circle cx="9" cy="8" r="3" /><path d="M3 20c.4-3.2 2.4-5 6-5s5.6 1.8 6 5" /><circle cx="17" cy="9" r="2" /><path d="M15 15c2.8-.1 4.8 1.5 5 4" /></>,
    audiences: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.8 20c.4-3.2 2.1-5 5.2-5s4.8 1.8 5.2 5M15 15c2.8.1 4.5 1.7 4.8 4" /></>,
    content: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    flows: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 7.1 10.6 16M17.2 6.1 13.4 16M7 6h10" /></>,
    deliverability: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z" /></>,
    analytics: <><path d="M4 19V9M10 19V5M16 19v-8M22 19V3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5a2 2 0 0 0 0-7h-.2a2 2 0 0 1-3.4-1.4v-.2a2 2 0 0 0-4 0v.2A2 2 0 0 1 8 8.5h-.2a2 2 0 0 0 0 4H8A2 2 0 0 1 9.4 16v.2a2 2 0 0 0 4 0V16a2 2 0 0 1 3.4-1.4Z" /></>,
  };
  return <span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{paths[name]}</svg></span>;
}

export function AppShell({ workspaceId, children, initialSidebarCompact = false }: { workspaceId: string; children: ReactNode; initialSidebarCompact?: boolean }) {
  const root = `/w/${workspaceId}`;
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<{ name?: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [query, setQuery] = useState('');
  const [searchData, setSearchData] = useState<SearchData | null>(null);
  const [sidebarCompact, setSidebarCompact] = useState(initialSidebarCompact);

  const setSidebarMode = (compact: boolean) => {
    setSidebarCompact(compact);
    window.sessionStorage.setItem('velivoo-sidebar-compact', compact ? 'true' : 'false');
    document.cookie = `velivoo-sidebar-compact=${compact ? 'true' : 'false'}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  useEffect(() => {
    void phase1Api<{ name?: string }>(`/api/v1/workspaces/${workspaceId}`).then(setWorkspace).catch(() => undefined);
    void phase1Api<{ sendingHealth: Health }>(`/api/v1/workspaces/${workspaceId}/home`).then(data => setHealth(data.sendingHealth)).catch(() => undefined);
  }, [workspaceId]);

  const audienceActive = Boolean(pathname?.includes('/profiles') || pathname?.includes('/audiences'));
  const current = audienceActive ? (pathname?.includes('/profiles') ? 'Contacts' : pathname?.includes('/segments') ? 'Segments' : 'Lists') : navItems.find(item => pathname?.includes(`/${item.path.split('/')[0]}`))?.label ?? 'Home';
  const isTemplateEditor = Boolean(pathname?.includes('/content/templates/') && pathname.endsWith('/edit'));
  const isFlowBuilder = Boolean(pathname?.includes('/flows/') && pathname.endsWith('/builder'));
  const isFullscreenEditor = isTemplateEditor || isFlowBuilder;
  const hasResults = Boolean(searchData && (searchData.profiles.length || searchData.flows.length || searchData.messages.length));
  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) { setSearchData(null); return; }
    try { setSearchData(await phase1Api<SearchData>(`/api/v1/workspaces/${workspaceId}/home/search?q=${encodeURIComponent(value)}`)); } catch { setSearchData(null); }
  };

  return <div className={`app-shell${sidebarCompact ? ' sidebar-compact' : ''}`}>
    <aside className="app-sidebar">
      <div className="sidebar-brand-row">
        <button className="brand" type="button" aria-label="Expand navigation" title={sidebarCompact ? 'Expand navigation' : undefined} disabled={!sidebarCompact} onClick={() => setSidebarMode(false)}><span className="brand-logo-frame"><img src="/brand/velivoo-logo.png?v=original" alt="Velivoo" /></span><img className="brand-mark-image" src="/brand/velivoo-mark.png?v=mark" alt="Velivoo" /></button>
        <button className="sidebar-collapse" type="button" aria-label="Collapse navigation" title="Collapse navigation" onClick={() => setSidebarMode(true)}><span className="sidebar-toggle-glyph" aria-hidden="true" /></button>
      </div>
      <WorkspaceSwitcher workspaceId={workspaceId} workspaceName={workspace?.name} />
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Primary">
        {navItems.slice(0, 1).map(item => <a key={item.path} href={`${root}/${item.path}`} aria-current={current === item.label ? 'page' : undefined} title={sidebarCompact ? item.label : undefined}><Icon name={item.icon} /><span className="nav-item-label">{item.label}</span></a>)}
        <div className={`audience-nav${audienceActive ? ' active' : ''}`}>
          <a className="audience-parent" href={`${root}/profiles`} aria-current={audienceActive ? 'page' : undefined} aria-expanded={audienceActive} title={sidebarCompact ? 'Audiences' : undefined}><Icon name="profiles" /><span className="nav-item-label">Audiences</span></a>
          {audienceActive && <div className="audience-subnav" aria-label="Audience pages">
            <a href={`${root}/profiles`} aria-current={pathname?.includes('/profiles') ? 'page' : undefined}>Contacts</a>
            <a href={`${root}/audiences/lists`} aria-current={pathname?.includes('/audiences/lists') ? 'page' : undefined}>Lists</a>
            <a href={`${root}/audiences/segments`} aria-current={pathname?.includes('/audiences/segments') ? 'page' : undefined}>Segments</a>
          </div>}
        </div>
        {navItems.slice(1).map(item => <a key={item.path} href={`${root}/${item.path}`} aria-current={current === item.label ? 'page' : undefined} title={sidebarCompact ? item.label : undefined}><Icon name={item.icon} /><span className="nav-item-label">{item.label}</span></a>)}
      </nav>
      <div className="sidebar-spacer" />
      <a className="health-card" href={`${root}/deliverability/overview`}>
        <div className="health-head"><span>Sending {health?.state === 'healthy' ? 'healthy' : 'status'}</span><i className="health-dot" style={{ background: health?.state === 'healthy' ? '#35d4ac' : health ? '#e0a34b' : '#c8bfdc' }} /></div>
        <p>{health ? `${health.verifiedDomains} verified domain${health.verifiedDomains === 1 ? '' : 's'} · feedback ${health.feedback}` : 'Checking sending health…'}</p>
      </a>
      <div className="user-card"><span className="avatar">—</span><span><strong>Workspace member</strong><small>Local development access</small></span></div>
    </aside>
    <div className={`app-main${isFullscreenEditor ? ' app-main-editor' : ''}`}>
      {!isFullscreenEditor && <header className="topbar">
        <div className="breadcrumbs">{workspace?.name ?? 'Workspace'} <span>/</span> <strong>{current}</strong></div>
        <div className="top-actions"><div className="search-wrap">
          <form className="global-search" onSubmit={submitSearch}><span aria-hidden="true">⌕</span><input aria-label="Global search" placeholder="Search profiles, flows, messages" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.length < 2) setSearchData(null); }} /><span className="shortcut">⌘ K</span></form>
          {searchData && <div className="search-results" role="listbox">{hasResults ? <>{searchData.profiles.map(item => <a key={`p-${item.id}`} href={`${root}/profiles/${item.id}`}>Profile · {item.originalEmail}</a>)}{searchData.flows.map(item => <a key={`f-${item.id}`} href={`${root}/flows/${item.id}/builder`}>Flow · {item.name}</a>)}{searchData.messages.map(item => <a key={`m-${item.id}`} href={`${root}/messages/${item.id}`}>Message · {item.id} · {item.state}</a>)}</> : <span>No matching profiles, flows, or messages.</span>}</div>}
        </div><button className="icon-button" aria-label="Notifications" onClick={() => { window.location.href = `${root}/notifications`; }}><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-3-3-9M10 21h4" /></svg></button></div>
      </header>}
      <div className={`page-content${isFullscreenEditor ? ' page-content-editor' : ''}${isFlowBuilder ? ' page-content-flow-editor' : ''}`}>{children}</div>
    </div>
  </div>;
}
