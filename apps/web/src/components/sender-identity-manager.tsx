"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { phase1Api } from "../lib/phase1-api";

type Domain = {
  id: string;
  domain: string;
  rootDomain?: string | null;
  sendingDomain?: string | null;
  delegatedSubdomain?: string | null;
  provisioningMode?: "legacy_ses_records" | "branded_delegation" | "static_branded";
  provisioningVersion?: "V1_LEGACY_SEND_SUBDOMAIN" | "V2_ROOT_SENDER_DELEGATED_INFRA" | "V3_ROOT_SENDER_DELEGATED_EASY_DKIM" | "V3_ROOT_SENDER_PLATFORM_DKIM" | "V4_STATIC_BRANDED_BYODKIM" | "V5_STATIC_BRANDED_KLAVIYO";
  status?: string;
  authenticationStatus?: string;
  lifecycleState?: string | null;
  readinessStatus?: string;
  readinessReasons?: string[];
};

function isBrandedMode(mode?: Domain["provisioningMode"]) {
  return mode === "branded_delegation" || mode === "static_branded";
}

function isRootSenderVersion(version?: Domain["provisioningVersion"]) {
  return version === "V2_ROOT_SENDER_DELEGATED_INFRA"
    || version === "V3_ROOT_SENDER_DELEGATED_EASY_DKIM"
    || version === "V3_ROOT_SENDER_PLATFORM_DKIM"
    || version === "V4_STATIC_BRANDED_BYODKIM"
    || version === "V5_STATIC_BRANDED_KLAVIYO";
}

function normalizeLocalPartInput(value: string, domain: string) {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const suffix = trimmed.slice(at + 1).toLowerCase();
  const expected = domain.toLowerCase();
  if (suffix === expected || suffix.endsWith(`.${expected}`)) return local;
  return trimmed;
}

function senderIdentityErrorMessage(cause: unknown, domain?: string) {
  const message = cause instanceof Error ? cause.message : "Unable to create sender identity";
  if (message.includes("SENDER_LOCAL_PART_INVALID")) {
    const suffix = domain ? ` @${domain}` : " the domain";
    return `Enter only the part before @ (for example: engr). Do not include${suffix} — it is added automatically.`;
  }
  return message;
}
type Identity = { id: string; domainId: string; fromName: string; fromEmail: string; replyTo: string; status: string };

export function SenderIdentityManager({ workspaceId }: { workspaceId: string }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [domainId, setDomainId] = useState("");
  const [fromName, setFromName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [legacyFromEmail, setLegacyFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const eligibleDomains = useMemo(() => domains.filter((domain) => isBrandedMode(domain.provisioningMode)
    ? domain.authenticationStatus === "verified" || String(domain.lifecycleState ?? "").toUpperCase() === "READY"
    : domain.status === "verified"), [domains]);
  const selectedDomain = useMemo(() => domains.find((domain) => domain.id === domainId), [domains, domainId]);
  const rootSender = isRootSenderVersion(selectedDomain?.provisioningVersion);
  const fixedDomain = rootSender ? (selectedDomain?.rootDomain ?? selectedDomain?.domain) : (selectedDomain?.sendingDomain ?? selectedDomain?.delegatedSubdomain ?? selectedDomain?.domain ?? "");

  async function load() {
    setLoading(true);
    try {
      const [domainResponse, identityResponse] = await Promise.all([
        phase1Api<{ items: Domain[] }>(`/api/v1/workspaces/${workspaceId}/sender-domains`),
        phase1Api<{ items: Identity[] }>(`/api/v1/workspaces/${workspaceId}/sender-identities`),
      ]);
      setDomains(domainResponse.items ?? []);
      setDomainId(domainResponse.items?.[0]?.id ?? "");
      setIdentities(identityResponse.items ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load sender identities");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspaceId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const normalizedLocalPart = normalizeLocalPartInput(localPart, fixedDomain);
      await phase1Api(`/api/v1/workspaces/${workspaceId}/sender-identities`, {
        method: "POST",
        body: JSON.stringify(isBrandedMode(selectedDomain?.provisioningMode)
          ? { domainId, fromName: fromName.trim(), localPart: normalizedLocalPart, replyTo: replyTo.trim() }
          : { domainId, fromName: fromName.trim(), fromEmail: legacyFromEmail.trim(), replyTo: replyTo.trim() }),
      });
      setFromName(""); setLocalPart(""); setLegacyFromEmail(""); setReplyTo("");
      setMessage("Sender identity saved");
      await load();
    } catch (cause) {
      setError(senderIdentityErrorMessage(cause, fixedDomain));
    }
  }

  function domainName(id: string) { const domain = domains.find((item) => item.id === id); const rootSender = isRootSenderVersion(domain?.provisioningVersion); return rootSender ? (domain?.rootDomain ?? domain?.domain) : (domain?.sendingDomain ?? domain?.delegatedSubdomain ?? domain?.domain ?? "Unknown domain"); }

  return <div>
    {error && <div role="alert">{error}</div>}
    <div className="dashboard-grid" style={{ marginTop: 0 }}>
      <section className="panel" style={{ padding: 20 }}>
        <div className="panel-heading"><div><h2>Sender identities</h2><p className="panel-subtitle">From addresses approved for marketing email on verified domains.</p></div><span className="pill pill-neutral">{identities.length} configured</span></div>
        <div className="table-wrap" style={{ marginTop: 18 }}><table><thead><tr><th>Identity</th><th>Domain</th><th>Reply-to</th><th>Status</th></tr></thead><tbody>
          {identities.map((identity) => <tr key={identity.id}><td><strong>{identity.fromName}</strong><br /><small>{identity.fromEmail}</small></td><td>{domainName(identity.domainId)}</td><td>{identity.replyTo}</td><td><span className={`pill ${identity.status === "active" ? "pill-success" : "pill-neutral"}`}>{identity.status}</span></td></tr>)}
        </tbody></table>{!loading && identities.length === 0 && <div className="empty-state"><strong>No sender identities yet.</strong><p>Create one after verifying a sending domain.</p></div>}{loading && <p className="panel-subtitle" style={{ padding: 16 }}>Loading sender identities…</p>}</div>
      </section>
      <section className="panel" style={{ padding: 20 }}>
        <div className="panel-heading"><div><h2>Add sender identity</h2><p className="panel-subtitle">This workspace has one sending domain. The platform fixes the domain portion so the sender cannot accidentally use an unrelated address.</p></div></div>
        <form onSubmit={submit} style={{ maxWidth: "none", marginBottom: 0 }}>
          <div className="filter-summary"><small>Sending domain</small><strong>{selectedDomain ? fixedDomain : "No sending domain configured"}</strong></div>
          <label>From name<input value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Your team" required /></label>
          {isBrandedMode(selectedDomain?.provisioningMode)
            ? <label>From address<div className="sender-address-field"><input value={localPart} onChange={(event) => setLocalPart(event.target.value)} onBlur={() => fixedDomain && setLocalPart((current) => normalizeLocalPartInput(current, fixedDomain))} placeholder="engr" pattern="[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+" aria-describedby="sender-address-help" required/><span>@{fixedDomain}</span></div><small id="sender-address-help">Enter only the part before @ (example: <code>engr</code>). The domain <code>@{fixedDomain}</code> is added automatically.</small></label>
            : <label>From email<input type="email" value={legacyFromEmail} onChange={(event) => setLegacyFromEmail(event.target.value)} placeholder="hello@your-domain.com" required /></label>}
          <label>Reply-to<input type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="support@your-domain.com" required /></label>
          <button className="button-primary" type="submit" disabled={!selectedDomain || !eligibleDomains.length}>Create sender identity</button>
          {!eligibleDomains.length && <p className="panel-subtitle">Domain authentication is not complete yet. <a className="panel-link" href={`/w/${workspaceId}/deliverability/domains`}>Open domain setup, finish DNS verification, then recheck</a>.</p>}
          {message && <p className="panel-subtitle" aria-live="polite">{message}</p>}
        </form>
      </section>
    </div>
    <section className="panel" style={{ padding: 20, marginTop: 16 }}><div className="panel-heading"><div><h2>Identity readiness</h2><p className="panel-subtitle">Sender identities inherit verification from their domain. Provider and DNS checks remain server-controlled.</p></div></div><div className="health-list">
      <div className="health-row"><span className="health-icon">✓</span><div><strong>Domain authorization</strong><small>{eligibleDomains.length ? "The workspace sending domain is ready for sender identities." : "The workspace sending domain has not completed authentication and operational readiness yet."}</small></div><span className={`pill ${eligibleDomains.length ? "pill-success" : "pill-warning"}`}>{eligibleDomains.length ? "Ready" : "Action required"}</span></div>
      <div className="health-row"><span className="health-icon">@</span><div><strong>Reply-to policy</strong><small>Every identity stores an explicit reply-to address for traceable responses.</small></div><span className="pill pill-neutral">Required</span></div>
    </div></section>
  </div>;
}
