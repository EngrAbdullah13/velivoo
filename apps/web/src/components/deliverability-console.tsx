"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { phase1Api } from "../lib/phase1-api";

type View = "overview" | "domains" | "domainDetail" | "suppressions" | "diagnostics" | "holds";
type Props = { workspaceId: string; view: View; initialDomainId?: string };
const nav: Array<{ key: View; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "overview" },
  { key: "domains", label: "Domains", href: "domains" },
  { key: "suppressions", label: "Suppressions", href: "suppressions" },
  { key: "diagnostics", label: "Bounces & Complaints", href: "bounces" },
  { key: "holds", label: "Holds & Warming", href: "holds" },
];
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "Not available";
const rate = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(value * 100 >= 10 ? 1 : 2)}%` : "—";
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const stateTone = (value: string) => {const state=value.toLowerCase();return state === "healthy" || state === "verified" || state === "ready" || state === "current" || state === "ownership_verified" ? "success" : state === "managed" || state === "not_applicable" ? "neutral" : state === "attention" || state === "warning" || state === "processing" || state === "awaiting_customer_dns" || state === "waiting_for_dns" || state === "authentication_verifying" || state === "ses_verifying" || state === "dkim_verifying" || state === "awaiting_production_data" ? "warning" : state === "setup" || state === "created" || state === "domain_created" || state === "aws_resources_prepared" || state === "dns_verified" || state === "dns_delegated" || state === "ses_verified" || state === "mail_from_configuring" || state === "mail_from_ready" || state === "tracking_ready" || state === "infrastructure_provisioning" || state === "provider_provisioning" || state === "delegation_verified" ? "violet" : "danger"};
const displayError = (value: string) => { const marker=" Diagnostic code: ",diagnostic=value.lastIndexOf(marker);if(diagnostic>0)return {message:value.slice(0,diagnostic),code:value.slice(diagnostic+marker.length)};const separator = value.indexOf(": "); return separator > 0 ? { message: value.slice(separator + 2), code: value.slice(0, separator) } : { message: value, code: null }; };
const customerReason:Record<string,string>={DNS_DELEGATION_PENDING:"Waiting for your nameserver records to appear in public DNS.",DNS_DELEGATION_MISMATCH:"The nameserver records do not yet match the records shown above.",OWNERSHIP_VERIFICATION_PENDING:"Waiting for the Velivoo ownership TXT record at your domain root.",STATIC_SEND_ROUTING_PENDING:"Waiting for the send routing CNAME to point at Velivoo.",STATIC_DKIM_DNS_PENDING:"Waiting for the vm1 DKIM CNAME to appear in public DNS.",STATIC_DKIM_VM2_PENDING:"Waiting for the vm2 DKIM CNAME to appear in public DNS.",DKIM_ROTATION_PENDING:"Velivoo is completing DKIM key rotation.",VELIVOO_DNS_TARGET_PENDING:"Velivoo is publishing branded DNS infrastructure.",BYODKIM_PENDING:"Velivoo is verifying BYODKIM signing.",STATIC_DNS_PENDING:"Add the branded DNS records shown below, then recheck.",EMAIL_IDENTITY_PENDING:"Email authentication is still verifying.",DKIM_PENDING:"Velivoo is verifying Easy DKIM inside the delegated zone.",DKIM_RECORDS_PENDING:"Email authentication records are not visible in public DNS yet.",SES_VERIFICATION_PENDING:"DNS is visible. Email identity verification is still processing.",MAIL_FROM_PENDING:"Waiting for bounce return-path MX/SPF records and SES MAIL FROM verification.",TRACKING_CERTIFICATE_PENDING:"Setting up secure link tracking.",TRACKING_HTTPS_PENDING:"Setting up secure link tracking.",FEEDBACK_NOT_READY:"Platform feedback safety is not ready yet.",UNSUBSCRIBE_NOT_READY:"The public unsubscribe experience is not ready yet.",SENDER_IDENTITY_MISSING:"Create a sender identity after the domain is ready.",ROUTE_NOT_ACTIVE:"The sending route is still being activated.",WORKSPACE_HELD:"Sending is currently on hold for this workspace.",BUSINESS_INFORMATION_MISSING:"Add your legal business name and address in Settings.",DMARC_WARNING:"DMARC needs review before launch.",DNS_PROVIDER_NOT_CONFIGURED:"Branded domain setup is not available yet. Our platform team needs to finish infrastructure setup.",STATIC_DNS_NOT_CONFIGURED:"Static branded DNS setup is not available yet. Platform DNS infrastructure must be configured first.",VANITY_NAMESERVERS_NOT_CONFIGURED:"Branded domain setup is not available yet. Our platform team needs to finish nameserver setup.",VANITY_NAMESERVER_MAPPING_INVALID:"Branded nameserver setup needs attention from the platform team."};
const friendlyReason=(value:string)=>customerReason[value]??"This sending-domain check needs attention.";
const lifecycleCopy=(value:string)=>({created:"Preparing your sending domain",domain_created:"Preparing your sending domain",waiting_for_dns:"Waiting for DNS",dns_verified:"DNS verified",ownership_verified:"Ownership verified",ses_verifying:"Verifying email identity",dkim_verifying:"Verifying DKIM",aws_resources_prepared:"DNS records are ready",infrastructure_provisioning:"Preparing your sending domain",awaiting_customer_dns:"Waiting for DNS",dns_delegated:"Delegation detected",ses_verified:"Email identity verified",mail_from_configuring:"Configuring branded return-path",mail_from_ready:"Return-path ready",tracking_ready:"Secure tracking ready",delegation_verified:"Checking delegation",provider_provisioning:"Setting up authentication",authentication_verifying:"DNS and email authentication verified — finishing platform setup",ready:"Ready",warning:"Needs attention",failed:"Setup needs attention",deleting:"Removing domain",deleted:"Removed",held:"Sending on hold",archived:"Archived"}[value.toLowerCase()]??title(value));
const staticProgressMessage=(domain:any)=>{const checks=domain.readinessChecks??[];for(const key of ["ownership","send_routing","dkim","mail_from"]){const check=checks.find((item:any)=>item.key===key);if(check&&check.status!=="ready"&&check.status!=="managed")return `${check.label} is still being verified.`}for(const key of ["identity","dkim"]){const check=checks.find((item:any)=>item.key===key);if(check&&check.status!=="ready"&&check.status!=="managed")return `${check.label} is still being verified.`}const reason=Array.isArray(domain.readinessReasons)?domain.readinessReasons[0]:null;if(reason)return friendlyReason(String(reason));return String(domain.readinessStatus??"").toLowerCase()==="ready"?"Ready to send.":"Finish remaining platform checks."};
function CustomerProgress({domain,isStatic=false}:{domain:any;isStatic?:boolean}){const lifecycle=String(domain.lifecycleState??domain.status??"created").toLowerCase();if(isStatic){const checks=domain.readinessChecks??[],ready=String(domain.readinessStatus??"").toLowerCase()==="ready"||lifecycle==="ready",ownershipReady=checks.find((check:any)=>check.key==="ownership")?.status==="ready",sendReady=checks.find((check:any)=>check.key==="send_routing")?.status==="ready",dkimDnsReady=checks.find((check:any)=>check.key==="dkim")?.status==="ready",mailFromReady=checks.find((check:any)=>check.key==="mail_from")?.status==="ready",identityReady=checks.find((check:any)=>check.key==="identity")?.status==="ready",items=[{label:"DNS records",done:ownershipReady&&sendReady&&dkimDnsReady},{label:"Email identity",done:identityReady&&dkimDnsReady},{label:"Return-path",done:mailFromReady},{label:"Ready",done:ready}];return <div className="onboarding-steps domain-progress">{items.map((item,index)=><div className="onboarding-step" key={item.label}><span>{item.done?"✓":index+1}</span><div><strong>{item.label}</strong>{!item.done&&index===items.findIndex(x=>!x.done)&&<p>{staticProgressMessage(domain)}</p>}</div></div>)}</div>}const rank:Record<string,number>={created:0,domain_created:0,infrastructure_provisioning:0,aws_resources_prepared:1,waiting_for_dns:1,awaiting_customer_dns:1,dns_verified:2,dns_delegated:2,delegation_verified:2,ownership_verified:3,ses_verifying:4,ses_verified:4,provider_provisioning:4,dkim_verifying:5,mail_from_configuring:5,authentication_verifying:5,mail_from_ready:6,tracking_ready:6,ready:7},current=rank[lifecycle]??0,items=[{label:"DNS records",done:current>=1},{label:"Delegation",done:current>=2},{label:"Ownership",done:current>=3},{label:"Email identity",done:current>=4},{label:"Ready",done:current>=7}];return <div className="onboarding-steps domain-progress">{items.map((item,index)=><div className="onboarding-step" key={item.label}><span>{item.done?"✓":index+1}</span><div><strong>{item.label}</strong>{!item.done&&index===items.findIndex(x=>!x.done)&&<p>{lifecycleCopy(lifecycle)}</p>}</div></div>)}</div>}
function StaticDnsGuidance({domain}:{domain:any}){
  const root=domain.rootDomain??domain.domain;
  const dmarcReady=String(domain.readinessChecks?.find((check:any)=>check.key==="dmarc")?.status??"").toLowerCase()==="ready"||String(domain.readinessChecks?.find((check:any)=>check.key==="dmarc")?.status??"").toLowerCase()==="warning";
  const dmarcAdvisory=domain.dmarcAdvisory;
  return <section className="panel"><h2>Static DNS scope</h2><p className="panel-subtitle">Klaviyo-style static branded DNS. Every record below maps to real Velivoo routing, DKIM, return-path, or verification behavior.</p><dl><dt>Send routing CNAME</dt><dd><code>send.{root}</code> → Velivoo tracking/routing endpoint for click and open links.</dd><dt>DKIM vm1</dt><dd><code>vm1._domainkey.{root}</code> → active Velivoo Marketing selector.</dd><dt>DKIM vm2</dt><dd><code>vm2._domainkey.{root}</code> → standby selector for safe key rotation.</dd><dt>Return path MX + SPF</dt><dd><code>bounce.{root}</code> → two records with separate Priority and Mail server copy boxes (Hostinger-style).</dd><dt>Ownership TXT (@)</dt><dd>Root apex TXT <code>velivoo-site-verification=…</code> — verified independently from the email provider.</dd><dt>DMARC at <code>_dmarc.{root}</code></dt><dd>{dmarcReady?"Existing DMARC observed on recheck. Velivoo never creates or overwrites your record.":dmarcAdvisory?.value?`Recommended if missing: ${dmarcAdvisory.value}`:"Optional but recommended: add your own DMARC TXT. Velivoo observes it on recheck and never overwrites an existing record."}</dd></dl></section>;
}
function CustomerReadiness({domain}:{domain:any}){const checks=domain.readinessChecks??[];if(!checks.length)return null;return <section className="panel"><h2>Sending readiness</h2><p className="panel-subtitle">These checks use real DNS and platform evidence. Technical provider details stay private.</p><div className="health-list">{checks.map((check:any)=><div className="health-row" key={check.key}><span className="health-icon">{["ready","managed"].includes(check.status)?"✓":"!"}</span><div><strong>{check.label}</strong><small>{check.key==="dmarc"?(["ready","warning"].includes(String(check.status))?"Observed at _dmarc — Velivoo never overwrites your record":"Add your own DMARC TXT at the root when ready"):["ready","managed"].includes(check.status)?"Ready":"Still being checked"}</small></div><span className={`pill pill-${stateTone(check.status)}`}>{check.status==="managed"?"Platform managed":title(check.status)}</span></div>)}</div></section>}
export function DeliverabilityConsole({ workspaceId, view, initialDomainId }: Props) {
  const [data, setData] = useState<any>();
  const [days, setDays] = useState(30);
  const domainId = initialDomainId ?? "";
  const [flowId, setFlowId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = async () => {
    try {
      setError("");
      const params = new URLSearchParams({ days: String(days) });
      if (view === "domainDetail" && domainId) params.set("domainId", domainId);
      if (flowId) params.set("flowId", flowId);
      setData(await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/deliverability/dashboard?${params}`));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load deliverability data."); }
  };
  useEffect(() => { void load(); }, [workspaceId, days, view, domainId, flowId]);
  const action = async (name: string, path: string, body?: unknown, method = "POST") => {
    try { setBusy(name); setError(""); await phase1Api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); await load(); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed."); await load().catch(() => undefined); return false; }
    finally { setBusy(""); }
  };
  if (!data && !error) return <div className="deliverability-loading"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-subtitle"/><div className="metric-grid"><div className="skeleton skeleton-card"/><div className="skeleton skeleton-card"/><div className="skeleton skeleton-card"/><div className="skeleton skeleton-card"/></div></div>;
  if (!data) return <section className="panel empty-state" role="alert"><strong>Deliverability data could not be loaded.</strong><p>{error}</p><button className="button-secondary" onClick={() => void load()}>Try again</button></section>;
  const base = `/w/${workspaceId}/deliverability`;
  return <section className="deliverability-console">
    <header className="deliverability-header">
      <div><h1>Deliverability</h1><p>Operational sending health, authentication, provider feedback, safeguards, and limits.</p></div>
      <div className="deliverability-filters"><label>Period<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>{data.filters.domain&&<div className="filter-summary"><small>Sending domain</small><strong>{data.filters.domain.domain}</strong></div>}<label>Flow<select value={flowId} onChange={event => setFlowId(event.target.value)}><option value="">All flows</option>{data.filters.flows.map((flow: any) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label></div>
    </header>
    <nav className="deliverability-tabs" aria-label="Deliverability sections">{nav.map(item => <Link key={item.key} href={`${base}/${item.href}`} aria-current={item.key === view ? "page" : undefined}>{item.label}</Link>)}</nav>
    {error && <div className="panel error-state" role="alert"><strong>{displayError(error).message}</strong>{displayError(error).code && <small>Diagnostic code: {displayError(error).code}</small>}</div>}
    {view === "overview" && <Overview data={data} base={base}/>} {view === "domains" && <Domains data={data} workspaceId={workspaceId} busy={busy} action={action} error={error}/>} {view === "domainDetail" && <DomainDetail data={data} workspaceId={workspaceId} busy={busy} action={action} error={error}/>} {view === "suppressions" && <Suppressions data={data} workspaceId={workspaceId} busy={busy} action={action}/>} {view === "diagnostics" && <Diagnostics data={data} workspaceId={workspaceId}/>} {view === "holds" && <Holds data={data} workspaceId={workspaceId} busy={busy} action={action}/>} 
  </section>;
}

function Overview({ data, base }: { data: any; base: string }) {
  if (data.health.state === "setup" && data.volume.submitted === 0) return <Onboarding data={data} base={base}/>;
  const shownMetrics = data.metrics.filter((metric: any) => ["delivery_rate", "hard_bounce_rate", "complaint_rate", "unsubscribe_rate"].includes(metric.key));
  return <div className="deliverability-stack">
    <section className={`delivery-health-banner ${data.health.state}`}><div><span className="eyebrow">Overall sending health</span><h2>{title(data.health.state)}</h2><p>Evaluated {date(data.health.evaluatedAt)} from configured domains, active safeguards, production events, and feedback freshness.</p></div><span className={`pill pill-${stateTone(data.health.state)}`}>{title(data.health.state)}</span><div className="health-reasons">{data.health.reasons.map((reason: any) => <Link key={reason.code} href={`${base}/${reason.action === "verify_domain" || reason.action === "add_domain" ? "domains" : reason.action === "review_holds" ? "holds" : reason.action === "review_bounces" || reason.action === "review_complaints" ? "bounces" : "overview"}`}><strong>{reason.title}</strong><small>{reason.detail}</small></Link>)}</div></section>
    <section className="metric-grid">{shownMetrics.map((metric: any, index: number) => <article key={metric.key} className={`metric-card ${["mint", "peach", "violet", "blue"][index]}`}><span className="metric-label">{metric.label}</span><strong className="metric-value">{rate(metric.rate)}</strong><span className="metric-note">{metric.numerator} / {metric.denominator} · {metric.definition}</span></article>)}</section>
    <div className="dashboard-grid"><Volume data={data}/><section className="panel delivery-summary"><div className="panel-heading"><div><h2>Feedback processing</h2><p className="panel-subtitle">Provider events are durable, duplicate-safe inputs to suppression and health.</p></div><span className={`pill pill-${stateTone(data.feedback.state)}`}>{title(data.feedback.state)}</span></div><dl><dt>Latest received</dt><dd>{date(data.feedback.latestAt)}</dd><dt>Processing lag</dt><dd>{data.feedback.processingLagSeconds === null ? "No events in selected period" : `${data.feedback.processingLagSeconds}s`}</dd><dt>Pending inbox events</dt><dd>{data.feedback.pendingCount}</dd></dl><Link className="panel-link" href={`${base}/bounces`}>Review bounces & complaints →</Link></section></div>
    <div className="dashboard-grid"><section className="panel action-center"><div className="panel-heading"><div><h2>Recommended actions</h2><p className="panel-subtitle">Deterministic recommendations based on live operating conditions.</p></div></div>{data.health.reasons.length ? data.health.reasons.map((reason: any) => <div className="action-row" key={reason.code}><span className={`pill pill-${reason.severity === "critical" ? "danger" : "warning"}`}>{title(reason.severity)}</span><div><strong>{reason.title}</strong><p>{reason.detail}</p></div><Link href={`${base}/${reason.action === "verify_domain" || reason.action === "add_domain" ? "domains" : reason.action === "review_holds" ? "holds" : "bounces"}`}>Open</Link></div>) : <div className="empty-state"><strong>No operational actions are currently required.</strong><p>The health state is based on the latest repository data, not a synthetic score.</p></div>}</section><section className="panel delivery-summary"><h2>Authentication & sending</h2><dl><dt>Sending domain</dt><dd>{data.filters.domain?.domain ?? "Not configured"}</dd><dt>Domain verified</dt><dd>{data.setup.verifiedDomains ? "Yes" : "No"}</dd><dt>Active sender identities</dt><dd>{data.setup.activeSenderIdentities}</dd><dt>Production submitted</dt><dd>{data.volume.submitted}</dd></dl><Link className="panel-link" href={`${base}/domains`}>Inspect DNS records →</Link></section></div>
  </div>;
}

function Onboarding({ data, base }: { data: any; base: string }) { const workspaceRoot = base.slice(0, base.lastIndexOf("/deliverability")); const steps = [{ label: "Add a sending domain", done: data.domains.length > 0, href: `${base}/domains`, note: "Establish the domain that will be authenticated for production sending." }, { label: "Confirm sender identity", done: data.setup.activeSenderIdentities > 0, href: `${workspaceRoot}/settings/sender-identities`, note: "Use an active sender identity on a verified sending domain." }, { label: "Verify bounce & complaint feedback", done: data.setup.feedbackConfigured, href: `${base}/overview`, note: "Provider feedback must be received and processed before production use." }, { label: "Run readiness check", done: data.readiness.every((check: any) => check.status === "passed"), href: `${base}/overview`, note: "Readiness evidence remains separate from activity metrics." }]; return <section className="delivery-onboarding"><span className="eyebrow">Deliverability setup</span><h2>Production sending is not ready</h2><p>Complete the evidence-backed setup below. Production metrics will appear after real messages and provider feedback are recorded.</p><div className="onboarding-steps">{steps.map((step, index) => <div className="onboarding-step" key={step.label}><span>{step.done ? "✓" : index + 1}</span><div><strong>{step.label}</strong><p>{step.note}</p></div><Link href={step.href}>{step.done ? "Review" : "Start"}</Link></div>)}</div><small>No production sending data is available for this workspace and selected scope.</small></section>; }

function Volume({ data }: { data: any }) { const trend = data.volume.trend as Array<any>; const points = useMemo(() => { const max = Math.max(1, ...trend.flatMap(row => [row.submitted, row.delivered])); return trend.map((row, index) => `${trend.length <= 1 ? 0 : index / (trend.length - 1) * 100},${100 - row.delivered / max * 88}`).join(" "); }, [trend]); if (!data.volume.submitted && !data.volume.delivered) return <section className="panel chart-panel chart-empty"><div><h2>Message volume</h2><p>Actual submitted and delivered volume will appear after production sending starts.</p></div></section>; return <section className="panel chart-panel"><div className="panel-heading"><div><h2>Message volume</h2><p className="panel-subtitle">Submitted and delivered messages in the selected window.</p></div><strong>{data.volume.submitted} submitted</strong></div><div className="delivery-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Delivered volume chart"><polyline points={points} className="delivery-chart-line"/></svg></div><div className="chart-legend"><span><i className="legend-dot"/>Delivered</span><span><i className="legend-dot muted"/>Submitted: {data.volume.submitted}</span></div></section>; }

function RemoveDomainButton({ domain, workspaceId, busy, action, error }: any) { const [open, setOpen] = useState(false); const [confirmation, setConfirmation] = useState(""); const key = `remove-${domain.id}`, label=domain.rootDomain??domain.domain; const close = () => { setOpen(false); setConfirmation(""); }; const remove = async (event: FormEvent) => { event.preventDefault(); const path=`/api/v1/workspaces/${workspaceId}/sender-domains/${domain.id}?confirmDomain=${encodeURIComponent(String(label))}`; console.info(JSON.stringify({event:"domain.delete",step:"ui.submit",workspaceId,domainId:domain.id,confirmDomain:label,path})); if (await action(key, path, { confirmDomain: label }, "DELETE")) { close(); if (typeof window!=="undefined" && window.location.pathname.includes(`/deliverability/domains/${domain.id}`)) window.location.assign(`/w/${workspaceId}/deliverability/domains`); } }; return <><button type="button" className="button-secondary" onClick={() => setOpen(true)}>Remove domain</button>{open && <div className="modal-backdrop"><form className="modal-card" onSubmit={remove}><div className="modal-head"><h2>Remove {label}?</h2><button type="button" aria-label="Close" onClick={close}>×</button></div><p>This permanently removes sender identities for this domain from Velivoo, clears them from editable email drafts, and removes platform-managed provider resources. Records at your root DNS provider are not changed.</p><p>Velivoo then deletes the SES identity, Easy DKIM, MAIL FROM, and tracking records, and removes the delegated Route 53 hosted zone. Published email history is retained as a non-sendable audit record.</p>{error && <p className="form-error" role="alert"><strong>{displayError(error).message}</strong>{displayError(error).code && <small> Diagnostic code: {displayError(error).code}</small>}</p>}<label>Type <strong>{label}</strong> to confirm<input autoFocus required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Cancel</button><button className="button-primary" disabled={confirmation.trim().toLowerCase() !== String(label).toLowerCase() || busy === key}>{busy === key ? "Removing…" : "Remove domain"}</button></div></form></div>}</>; }

function Domains({ data, workspaceId, busy, action, error }: any) {
  const [domain, setDomain] = useState("");
  const [setupMode, setSetupMode] = useState<"MANAGED_DELEGATION" | "STATIC_BRANDED">("MANAGED_DELEGATION");
  const currentDomain=data.domains[0]??null,brandedAvailable=Boolean(data.capabilities.brandedDomainSetupAvailable),staticAvailable=Boolean(data.capabilities.staticBrandedSetupAvailable);
  const add = async (event: FormEvent) => { event.preventDefault(); if(currentDomain)return; if(setupMode==="MANAGED_DELEGATION"&&!brandedAvailable)return; if(setupMode==="STATIC_BRANDED"&&!staticAvailable)return; if (await action("domain", `/api/v1/workspaces/${workspaceId}/sender-domains`, { domain, setupMode })) setDomain(""); };
  return <div className="deliverability-stack">
    <section className="panel deliverability-form">
      <h2>{currentDomain?"Your sending domain":"Add a sending domain"}</h2>
      {currentDomain?<p className="panel-subtitle"><strong>One sending domain per workspace.</strong> To use a different domain, remove this setup first. Historical domain records are preserved safely.</p>:<>
        <p className="panel-subtitle">Send from your root domain. Choose how you want to authenticate DNS with Velivoo.</p>
        {data.capabilities.canManageDomains && <form onSubmit={add} className="branded-domain-form">
          <label>Root domain<input required value={domain} onChange={event => setDomain(event.target.value)} placeholder="example.com" aria-describedby="domain-help"/></label>
          <small id="domain-help">Result: visible sender <strong>you@{domain.trim()||"example.com"}</strong> · infrastructure <strong>send.{domain.trim()||"example.com"}</strong></small>
          <div className="domain-setup-cards">
            <button type="button" className={`domain-setup-card${setupMode==="MANAGED_DELEGATION"?" selected":""}`} onClick={()=>setSetupMode("MANAGED_DELEGATION")} disabled={!brandedAvailable}>
              <strong>Managed by Velivoo</strong>
              <span>Recommended</span>
              <p>Delegate <strong>send.{domain.trim()||"your-domain.com"}</strong> with four NS records plus a Velivoo verification TXT. Velivoo manages DKIM, return-path, and tracking inside the delegated zone.</p>
              <small>Requires a DNS provider that supports subdomain NS delegation.</small>
            </button>
            <button type="button" className={`domain-setup-card${setupMode==="STATIC_BRANDED"?" selected":""}`} onClick={()=>setSetupMode("STATIC_BRANDED")} disabled={!staticAvailable}>
              <strong>Static / Branded DNS</strong>
              <span>For Hostinger-style providers</span>
              <p>Add the Velivoo-branded DNS records at your registrar. Each record shows exactly what to paste into Hostinger-style panels — separate fields for MX priority and mail server.</p>
              <small>Return-path records use Velivoo-required mail-routing targets. Copy each field separately; do not combine priority and hostname.</small>
            </button>
          </div>
          <button className="button-primary" disabled={(setupMode==="MANAGED_DELEGATION"?!brandedAvailable:!staticAvailable)||busy === "domain"}>{busy === "domain" ? "Creating…" : setupMode==="MANAGED_DELEGATION"?"Use managed setup":"Use static setup"}</button>
          {!brandedAvailable&&setupMode==="MANAGED_DELEGATION"&&<p className="form-error" role="status"><strong>Managed setup is not available yet.</strong> Platform nameserver infrastructure must be configured first.</p>}
          {!staticAvailable&&setupMode==="STATIC_BRANDED"&&<p className="form-error" role="status"><strong>Static branded setup is not available yet.</strong> Platform static DNS infrastructure must be configured first.</p>}
        </form>}
      </>}
    </section>
    {data.domains.map((item: any) => {
      const lifecycle=item.lifecycleState??item.status,records=item.customerRecords??[],isV2=item.provisioningVersion==="V2_ROOT_SENDER_DELEGATED_INFRA",isV3=item.provisioningVersion==="V3_ROOT_SENDER_DELEGATED_EASY_DKIM"||item.provisioningVersion==="V3_ROOT_SENDER_PLATFORM_DKIM",isStatic=item.provisioningMode==="static_branded"||item.provisioningVersion==="V4_STATIC_BRANDED_BYODKIM"||item.provisioningVersion==="V5_STATIC_BRANDED_KLAVIYO",managed=isV2||isV3||isStatic;
      return <section key={item.id} className="panel domain-card">
        <div className="panel-heading"><div><h2><Link href={`/w/${workspaceId}/deliverability/domains/${item.id}`}>{item.rootDomain??item.domain}</Link></h2><p className="panel-subtitle">Visible sender <strong>@{item.rootDomain??item.domain}</strong> · Infrastructure <strong>{item.infraDomain??item.delegatedSubdomain}</strong> · Last checked {date(item.lastCheckedAt)}</p></div><span className={`pill pill-${stateTone(lifecycle)}`}>{lifecycleCopy(lifecycle)}</span></div>
        {!managed?<p className="suppressions-note">This existing sender remains available in legacy compatibility mode. It is not silently migrated or removed.</p>:<div className="dns-setup">
          <CustomerProgress domain={item} isStatic={isStatic}/>
          <div className="dns-instructions"><span className="setup-step">1</span><div><h3>{isStatic?"Add DNS records":isV3?"Add five DNS records":"Add all seven DNS records"}</h3><p>{isStatic?<>Add each Velivoo-branded record below at your DNS provider. Velivoo verifies ownership, DKIM, and provider authentication from real DNS evidence.</>:isV3?<>Add four NS records that delegate {item.infraDomain??`send.${item.rootDomain??item.domain}`} to Velivoo, plus the ownership TXT record. After delegation, Velivoo manages SES Easy DKIM, MAIL FROM, and tracking inside that zone.</>:<>Add four NS records for the delegated infrastructure subdomain and three DKIM CNAME records at the DNS provider for {item.rootDomain??item.domain}. Velivoo manages MAIL FROM and tracking records after delegation.</>}</p></div></div>
          <RecordList items={records} kind="required"/>
          <div className="dns-instructions verification-summary"><span className="setup-step">2</span><div><h3>Verify DNS</h3><p>{isStatic?"After you publish the records, click Recheck DNS. Velivoo verifies public DNS and live email authentication — no manual provider checks needed.":"After you publish the records, click Recheck DNS to verify nameservers, the ownership TXT record, and email identity. DKIM, return-path, and tracking records are managed by Velivoo inside the delegated zone."}</p></div></div>
          {Array.isArray(item.readinessReasons)&&item.readinessReasons.length>0&&<div className="readiness-reasons">{item.readinessReasons.map((reason:string)=><span key={reason} className="pill pill-warning">{friendlyReason(reason)}</span>)}</div>}
        </div>}
        <div className="button-row"><Link className="button-secondary" href={`/w/${workspaceId}/deliverability/domains/${item.id}`}>View details</Link>{data.capabilities.canManageDomains && <><button className="button-primary" disabled={busy === `verify-${item.id}`||!managed} onClick={() => action(`verify-${item.id}`, `/api/v1/workspaces/${workspaceId}/sender-domains/${item.id}/recheck`)}>{busy === `verify-${item.id}` ? "Checking…" : "Recheck DNS"}</button>{isStatic&&["CREATED","DELETED","WAITING_FOR_DNS","FAILED"].includes(String(lifecycle??"").toUpperCase())&&<button className="button-secondary" disabled={busy === `retry-${item.id}`} onClick={() => action(`retry-${item.id}`, `/api/v1/workspaces/${workspaceId}/sender-domains/${item.id}/retry-provisioning`)}>{busy === `retry-${item.id}` ? "Resuming…" : "Resume setup"}</button>}<RemoveDomainButton domain={item} workspaceId={workspaceId} busy={busy} action={action} error={error}/></>}</div>
      </section>;
    })}
    {!currentDomain && <div className="empty-state"><strong>No sending domain is configured.</strong><p>Add your root domain to begin branded sending-domain setup.</p></div>}
  </div>;
}
function DomainDetail({ data, workspaceId, busy, action, error }: any) {
  const domain = data.domains.find((item: any) => item.id === data.filters.domainId);
  if (!domain) return <div className="empty-state"><strong>Sending domain not found.</strong><p>The selected domain may have been removed or belongs to another workspace.</p><Link href={`/w/${workspaceId}/deliverability/domains`}>Return to domain setup</Link></div>;
  const lifecycle=domain.lifecycleState??domain.status,isV2=domain.provisioningVersion==="V2_ROOT_SENDER_DELEGATED_INFRA",isV3=domain.provisioningVersion==="V3_ROOT_SENDER_DELEGATED_EASY_DKIM"||domain.provisioningVersion==="V3_ROOT_SENDER_PLATFORM_DKIM",isStatic=domain.provisioningMode==="static_branded"||domain.provisioningVersion==="V4_STATIC_BRANDED_BYODKIM"||domain.provisioningVersion==="V5_STATIC_BRANDED_KLAVIYO",managed=isV2||isV3||isStatic;
  return <div className="deliverability-stack">
    <Link className="back-link" href={`/w/${workspaceId}/deliverability/domains`}>← Domain setup</Link>
    <section className="panel domain-card">
      <div className="panel-heading"><div><span className="eyebrow">Branded sending domain</span><h2>{domain.rootDomain??domain.domain}</h2><p className="panel-subtitle">Visible From domain <strong>{domain.rootDomain??domain.domain}</strong> · Infrastructure <strong>{domain.infraDomain??domain.delegatedSubdomain}</strong> · Last evidence check {date(domain.lastCheckedAt)}</p></div><span className={`pill pill-${stateTone(lifecycle)}`}>{lifecycleCopy(lifecycle)}</span></div>
      {managed&&<div className="dns-setup">
        <CustomerProgress domain={domain} isStatic={isStatic}/>
        <div className="dns-instructions"><span className="setup-step">1</span><div><h3>{isStatic?"Publish the branded DNS records":isV3?"Publish five customer DNS records":"Publish the seven customer DNS records"}</h3><p>{isStatic?"Add each record exactly as shown. All records use Velivoo branding.":isV3?`Add four NS records for ${domain.infraDomain} and the Velivoo ownership TXT record. Velivoo manages authentication, mail-from, and tracking records inside the delegated zone.`: `Add four NS records for ${domain.infraDomain} and all three DKIM CNAME records for the root identity. Mail-from and tracking records remain Velivoo-managed.`}</p></div></div>
        <RecordList items={domain.customerRecords??[]} kind="required"/>
      </div>}
      {!managed&&<p className="suppressions-note">This domain uses legacy compatibility mode and remains unchanged until an explicit migration is approved.</p>}
      {data.capabilities.canManageDomains&&managed?<div className="button-row"><button className="button-primary dns-check-button" disabled={busy === `verify-${domain.id}`} onClick={() => action(`verify-${domain.id}`, `/api/v1/workspaces/${workspaceId}/sender-domains/${domain.id}/recheck`)}>{busy === `verify-${domain.id}` ? "Checking public DNS…" : "Recheck DNS"}</button>{isStatic&&["CREATED","DELETED","WAITING_FOR_DNS","FAILED"].includes(String(lifecycle??"").toUpperCase())&&<button className="button-secondary" disabled={busy === `retry-${domain.id}`} onClick={() => action(`retry-${domain.id}`, `/api/v1/workspaces/${workspaceId}/sender-domains/${domain.id}/retry-provisioning`)}>{busy === `retry-${domain.id}` ? "Resuming…" : "Resume setup"}</button>}<Link className="button-secondary" href={`/w/${workspaceId}/deliverability/holds`}>Hold or release sending</Link><RemoveDomainButton domain={domain} workspaceId={workspaceId} busy={busy} action={action} error={error}/></div>:null}
    </section>
    {isStatic&&<StaticDnsGuidance domain={domain}/>}
    <CustomerReadiness domain={domain}/>
    <section className="panel"><h2>What needs attention</h2><p className="panel-subtitle">Production use remains blocked until every required check is complete.</p>{Array.isArray(domain.readinessReasons)&&domain.readinessReasons.length>0?<div className="health-list">{domain.readinessReasons.map((reason:string)=><div className="health-row" key={reason}><span className="health-icon">!</span><div><strong>{friendlyReason(reason)}</strong></div><span className="pill pill-warning">Action required</span></div>)}</div>:<p className="panel-subtitle">No customer action is currently required.</p>}</section>
  </div>;
}
function RecordList({ items, kind }: { items: any[]; kind: "required" | "observed" }) {
  const [copied, setCopied] = useState("");
  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("");
    }
  };
  if (!items?.length) return <p className="muted">DNS records are still being prepared.</p>;
  return (
    <div>
      <ul className={`dns-records dns-records-${kind}`}>
        {items.map((record, index) => {
          const presentation = record.presentation as
            | { title: string; instructions: string; host: { label: string; value: string; fullName: string }; fields: Array<{ key: string; label: string; value: string; hint?: string }> }
            | undefined;
          const host = String(record.name ?? record.host ?? "");
          const value = String(record.value ?? record.target ?? "");
          const key = `${index}-${kind}`;
          const status = String(record.status ?? "pending");
          const verified = status === "verified";
          const statusLabel = verified
            ? "Verified"
            : status === "mismatch"
              ? "Incorrect record"
              : status === "verifying"
                ? "Verifying"
                : status === "timeout" || status === "servfail"
                  ? "Still propagating"
                  : "Waiting for DNS";
          if (presentation) {
            return (
              <li key={key}>
                <div className="dns-record-heading">
                  <span>{presentation.title}</span>
                  <strong>{String(record.type ?? "DNS")}</strong>
                </div>
                <p className="dns-record-instructions">{presentation.instructions}</p>
                <div className="dns-copy-field">
                  <div>
                    <small>{presentation.host.label}</small>
                    <code title={presentation.host.fullName}>{presentation.host.value}</code>
                    {presentation.host.value !== presentation.host.fullName && (
                      <span className="dns-host-full">Full name: {presentation.host.fullName}</span>
                    )}
                  </div>
                  <button type="button" aria-label={`Copy host ${index + 1}`} onClick={() => void copy(presentation.host.value, `${key}-host`)}>
                    {copied === `${key}-host` ? "Copied" : "Copy host"}
                  </button>
                </div>
                {presentation.fields.map(field => (
                  <div className="dns-copy-field" key={`${key}-${field.key}`}>
                    <div>
                      <small>{field.label}</small>
                      <code title={field.value}>{field.value}</code>
                      {field.hint ? <span className="dns-field-hint">{field.hint}</span> : null}
                    </div>
                    <button type="button" aria-label={`Copy ${field.label}`} onClick={() => void copy(field.value, `${key}-${field.key}`)}>
                      {copied === `${key}-${field.key}` ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
                <span className={`pill ${verified ? "pill-success" : "pill-warning"}`}>{statusLabel}</span>
              </li>
            );
          }
          return (
            <li key={key}>
              <div className="dns-record-heading">
                <span>{title(String(record.purpose ?? "sending domain"))}</span>
                <strong>{String(record.type ?? "NS")}</strong>
              </div>
              <div className="dns-copy-field">
                <div>
                  <small>Name</small>
                  <code title={host}>{host}</code>
                </div>
                <button type="button" aria-label={`Copy DNS name ${index + 1}`} onClick={() => void copy(host, `${key}-host`)}>
                  {copied === `${key}-host` ? "Copied" : "Copy name"}
                </button>
              </div>
              <div className="dns-copy-field">
                <div>
                  <small>Value</small>
                  <code title={value}>{value}</code>
                </div>
                <button type="button" aria-label={`Copy DNS value ${index + 1}`} onClick={() => void copy(value, `${key}-value`)}>
                  {copied === `${key}-value` ? "Copied" : "Copy value"}
                </button>
              </div>
              <span className={`pill ${verified ? "pill-success" : "pill-warning"}`}>{statusLabel}</span>
            </li>
          );
        })}
      </ul>
      {kind === "required" && (
        <p className="dns-help">
          Hostinger and similar panels often want the short host (for example <strong>bounce</strong>, not the full domain). MX records need Priority and Mail server in separate boxes — never paste <strong>10 hostname</strong> into the mail server field.
        </p>
      )}
    </div>
  );
}

function Suppressions({ data, workspaceId, busy, action }: any) { return <div className="deliverability-stack"><section className="panel suppressions-note"><h2>Suppression protection</h2><p>Complaints and hard bounces remain protected. Removing any other suppression never restores marketing consent; consent is evaluated separately before a send.</p></section><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Profile</th><th>Scope / reason</th><th>Source</th><th>Related event</th><th>Recorded</th><th>Protection</th><th/></tr></thead><tbody>{data.suppressions.map((item: any) => <tr key={item.id}><td>{item.profileId ? <Link href={`/w/${workspaceId}/profiles/${item.profileId}`}>{item.profileEmail ?? item.profileId}</Link> : "Unknown profile"}</td><td><strong>{title(item.scope)}</strong><br/><small>{title(item.reason)}</small></td><td>{item.source}</td><td>{item.sourceReference ?? "—"}</td><td>{date(item.createdAt)}</td><td>{item.protected ? "Protected" : item.revokedAt ? "Revoked" : item.expiresAt ? `Expires ${date(item.expiresAt)}` : "Active"}</td><td>{!item.protected && !item.revokedAt && data.capabilities.canManageSuppressions && <button className="table-action" disabled={busy === `suppression-${item.id}`} onClick={() => action(`suppression-${item.id}`, `/api/v1/workspaces/${workspaceId}/suppressions/${item.id}/revoke`)}>Revoke</button>}</td></tr>)}</tbody></table></div>{!data.suppressions.length && <div className="empty-state"><strong>No email suppressions are recorded.</strong><p>Future feedback, unsubscribe, administrative, and legal suppressions will appear here with their source.</p></div>}</section></div>; }

function Diagnostics({ data, workspaceId }: any) { const rows = [...data.diagnostics.complaints, ...data.diagnostics.bounces]; return <div className="deliverability-stack"><section className="diagnostic-cards"><article className="panel"><span className="eyebrow">Hard bounces</span><strong>{data.reputation.hardBounces}</strong><p>Permanent failures are protected suppressions and require audience/source investigation.</p></article><article className="panel"><span className="eyebrow">Soft bounces / deferrals</span><strong>{data.reputation.softBounces}</strong><p>Transient provider reports are tracked separately from permanent failures.</p></article><article className="panel"><span className="eyebrow">Complaints</span><strong>{data.reputation.complaints}</strong><p>Complaints are protected suppressions and high-priority operational signals.</p></article></section><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Type / category</th><th>Provider</th><th>Profile</th><th>Message</th><th>Flow</th><th>Occurred</th><th>Received</th></tr></thead><tbody>{rows.map((item: any) => <tr key={item.id}><td><strong>{title(item.eventType)}</strong><br/><small>{title(item.category)}</small></td><td>{item.provider}</td><td>{item.profileId ? <Link href={`/w/${workspaceId}/profiles/${item.profileId}`}>{item.profileEmail ?? item.profileId}</Link> : "—"}</td><td>{item.messageId ? <Link href={`/w/${workspaceId}/messages/${item.messageId}`}>Trace</Link> : "—"}</td><td>{item.flowId ? <Link href={`/w/${workspaceId}/flows/${item.flowId}/builder`}>{item.flowName ?? "Flow"}</Link> : "—"}</td><td>{date(item.occurredAt)}</td><td>{date(item.receivedAt)}</td></tr>)}</tbody></table></div>{!rows.length && <div className="empty-state"><strong>No bounce or complaint events in this period.</strong><p>Provider feedback will appear with its diagnostic category and related message evidence.</p></div>}</section></div>; }

function Holds({ data, workspaceId, busy, action }: any) {
  const [reason, setReason] = useState(""); const [scopeType, setScopeType] = useState("workspace"); const [scopeId, setScopeId] = useState("");
  const currentDomain=data.filters.domain;
  const [ceiling, setCeiling] = useState(data.warming.dailyCeiling?.toString() ?? ""); const [feedbackWindow, setFeedbackWindow] = useState(data.warming.feedbackStaleAfterSeconds?.toString() ?? "");
  const [releasing, setReleasing] = useState<any>(null); const [releaseReason, setReleaseReason] = useState("");
  useEffect(() => { setCeiling(data.warming.dailyCeiling?.toString() ?? ""); setFeedbackWindow(data.warming.feedbackStaleAfterSeconds?.toString() ?? ""); }, [data.warming.dailyCeiling, data.warming.feedbackStaleAfterSeconds]);
  const create = async (event: FormEvent) => { event.preventDefault(); await action("hold", `/api/v1/workspaces/${workspaceId}/deliverability/holds`, { scopeType, scopeId: scopeType === "workspace" ? undefined : scopeType === "domain" ? currentDomain?.id : scopeId, reason }); setReason(""); };
  const updateWarming = async (event: FormEvent) => { event.preventDefault(); await action("warming", `/api/v1/workspaces/${workspaceId}/deliverability/warming`, { dailyLimit: ceiling === "" ? null : Number(ceiling), feedbackStaleAfterSeconds: feedbackWindow === "" ? null : Number(feedbackWindow) }); };
  const release = async (event: FormEvent) => { event.preventDefault(); if (!releasing) return; await action(`release-${releasing.id}`, `/api/v1/workspaces/${workspaceId}/deliverability/holds/${releasing.id}/release`, { reason: releaseReason }); setReleaseReason(""); setReleasing(null); };
  return <div className="deliverability-stack"><div className="dashboard-grid"><section className="panel warming-card"><span className="eyebrow">Daily warming ceiling</span><strong>{data.warming.dailyCeiling ?? "Not set"}</strong><p>{data.warming.usedVolume} production messages used today. Resets {date(data.warming.resetAt)}.</p><p>{data.warming.heldByCapacity} message(s) currently held by capacity.</p>{data.capabilities.canManageOperations && <form onSubmit={updateWarming} className="inline-form"><label>Messages per UTC day<input type="number" min="1" value={ceiling} onChange={event => setCeiling(event.target.value)} placeholder="No ceiling"/></label><label>Feedback safety window (seconds)<input type="number" min="60" value={feedbackWindow} onChange={event => setFeedbackWindow(event.target.value)} placeholder="Disabled"/></label><button className="button-primary" disabled={busy === "warming"}>Save safeguards</button></form>}</section><section className="panel warming-card"><span className="eyebrow">Frequency protection</span><strong>{data.warming.frequencyMax}</strong><p>Maximum production messages per profile every {Math.round(data.warming.frequencyWindowSeconds / 3600)} hours.</p><p>{data.warming.feedbackStaleAfterSeconds ? `No new production delivery when processed feedback is older than ${data.warming.feedbackStaleAfterSeconds}s.` : "Feedback freshness is observable but not configured as a sending gate."}</p></section></div><section className="panel"><div className="panel-heading"><div><h2>Operational holds</h2><p className="panel-subtitle">Every hold is reasoned, scoped, time-stamped, and has measurable message impact.</p></div></div>{data.capabilities.canManageOperations && <form onSubmit={create} className="hold-form"><label>Scope<select value={scopeType} onChange={event => setScopeType(event.target.value)}><option value="workspace">Workspace</option><option value="domain">Current sending domain</option><option value="provider">Provider</option></select></label>{scopeType === "domain" && <p className="panel-subtitle">This hold applies to <strong>{currentDomain?.domain ?? "the workspace sending domain"}</strong>.</p>}{scopeType === "provider" && <label>Provider identifier<input required value={scopeId} onChange={event => setScopeId(event.target.value)} placeholder="Provider name"/></label>}<label className="hold-reason">Reason<textarea required value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is sending being held?"/></label><button className="button-primary" disabled={busy === "hold" || (scopeType === "domain" && !currentDomain)}>Place hold</button></form>}</section><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Scope</th><th>Reason</th><th>Created</th><th>Affected messages</th><th/></tr></thead><tbody>{data.holds.map((hold: any) => <tr key={hold.id}><td>{title(hold.scopeType)}{hold.scopeId ? ` · ${hold.scopeId}` : ""}</td><td>{hold.reason}</td><td>{date(hold.createdAt)}</td><td>{hold.affectedCount}</td><td>{data.capabilities.canManageOperations && <button className="table-action" disabled={busy === `release-${hold.id}`} onClick={() => setReleasing(hold)}>Release</button>}</td></tr>)}</tbody></table></div>{!data.holds.length && <div className="empty-state"><strong>No active operational holds.</strong><p>Sending remains subject to domain readiness, consent, suppression, frequency, and warming controls.</p></div>}</section>{releasing && <div className="modal-backdrop"><form className="modal-card" onSubmit={release}><div className="modal-head"><h2>Release operational hold</h2><button type="button" onClick={() => setReleasing(null)}>×</button></div><p>Releasing this hold may allow new messages to proceed after all remaining canonical policy checks pass.</p><label>Release reason<textarea required value={releaseReason} onChange={event => setReleaseReason(event.target.value)} placeholder="Why is this safe to release now?"/></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setReleasing(null)}>Cancel</button><button className="button-primary" disabled={busy === `release-${releasing.id}`}>Release hold</button></div></form></div>}</div>;
}
