"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { phase1Api } from "../../lib/phase1-api";

type TraceDetail = Record<string, unknown>;
type TraceEvent = { kind: string; occurredAt: string; detail: unknown };
type TraceMessage = { id?: string; state: string; profileId: string; emailVersionId: string | null; submittedAt?: string | null; firstOpenedAt?: string | null; lastOpenedAt?: string | null; openCount?: number };
type TraceResponse = { message: TraceMessage; events: TraceEvent[] };

const label = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ").replace(/\b\w/g, letter => letter.toUpperCase());
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const asRecord = (value: unknown): TraceDetail => value !== null && typeof value === "object" && !Array.isArray(value) ? value as TraceDetail : {};
const string = (value: unknown) => typeof value === "string" ? value : null;

function eventView(event: TraceEvent) {
  const detail = asRecord(event.detail), reason = string(detail.reason), outcome = string(detail.outcome), provider = string(detail.provider);
  const views: Record<string, { title: string; text: string; tone: "success" | "neutral" | "warning" | "danger"; glyph: string }> = {
    "message.intent_created": { title: "Email queued", text: "A Flow or campaign created this message for delivery.", tone: "neutral", glyph: "✦" },
    "policy.evaluated": { title: outcome === "allow" ? "Ready to send" : "Sending policy evaluated", text: outcome === "allow" ? `All delivery checks passed${reason ? ` · ${reason.toLowerCase()}` : ""}.` : reason ? `Sending decision: ${reason.replaceAll("_", " ").toLowerCase()}.` : "The sending policy was evaluated.", tone: outcome === "allow" ? "success" : outcome === "hold" ? "warning" : "danger", glyph: outcome === "allow" ? "✓" : "!" },
    "message.rendered": { title: "Email prepared", text: "Personalization, compliance content, and tracked links were rendered.", tone: "neutral", glyph: "✉" },
    "provider.submitted": { title: "Handed to email provider", text: `${provider ? provider.toUpperCase() : "The email provider"} accepted the message for delivery.`, tone: "success", glyph: "↗" },
    "feedback.delivery": { title: "Delivered", text: "The recipient’s mail server accepted the message.", tone: "success", glyph: "✓" },
    "engagement.open": { title: "Email opened", text: "The recipient’s email client loaded the tracked email image.", tone: "success", glyph: "◉" },
    "engagement.click": { title: "Link clicked", text: "The recipient followed a tracked link in the email.", tone: "success", glyph: "↗" },
    "feedback.bounce": { title: "Bounced", text: "The provider reported that delivery could not be completed.", tone: "danger", glyph: "×" },
    "feedback.complaint": { title: "Spam complaint", text: "The provider reported a recipient complaint.", tone: "danger", glyph: "!" },
  };
  return views[event.kind] ?? { title: label(event.kind), text: "A delivery-system event was recorded.", tone: "neutral" as const, glyph: "•" };
}

export function MessageTrace({ workspaceId, messageId }: { workspaceId: string; messageId: string }) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await phase1Api<TraceResponse>(`/api/v1/workspaces/${workspaceId}/messages/${messageId}/trace`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load this message trace."); }
    finally { setLoading(false); }
  }, [messageId, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  const summary = useMemo(() => {
    const events = data?.events ?? [];
    return { delivered: events.some(event => event.kind === "feedback.delivery"), opened: events.filter(event => event.kind === "engagement.open").length, clicked: events.filter(event => event.kind === "engagement.click").length };
  }, [data]);
  if (loading && !data) return <section className="message-trace message-trace-loading"><div/><div/><div/></section>;
  if (!data) return <section className="message-trace-error" role="alert"><strong>We could not load this message trace.</strong><p>{error || "Try again in a moment."}</p><button className="button-primary" onClick={() => void load()}>Retry</button></section>;
  const message = data.message, state = message.state.toLowerCase();
  return <section className="message-trace">
    <nav className="message-trace-breadcrumb"><Link href={`/w/${workspaceId}/analytics`}>Analytics</Link><span>/</span><span>Message trace</span></nav>
    <header className="message-trace-hero"><div><span className="message-trace-eyebrow">Delivery record</span><h1>Message trace</h1><p>Follow this email from the Flow or campaign through delivery and recipient engagement.</p></div><div><span className={`message-trace-state ${state}`}>{label(message.state)}</span><button className="button-secondary" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></header>
    <section className="message-trace-summary"><article><span className="message-trace-icon sent">↗</span><div><small>Message ID</small><strong><code>{messageId.slice(0, 12)}…</code></strong></div></article><article><span className="message-trace-icon delivery">✓</span><div><small>Delivery</small><strong>{summary.delivered ? "Delivered" : "Awaiting provider feedback"}</strong></div></article><article><span className="message-trace-icon engagement">◉</span><div><small>Engagement</small><strong>{summary.opened ? `${summary.opened} open${summary.opened === 1 ? "" : "s"}` : "Not opened yet"}</strong></div></article><article><span className="message-trace-icon click">↗</span><div><small>Clicks</small><strong>{summary.clicked ? `${summary.clicked} tracked click${summary.clicked === 1 ? "" : "s"}` : "No clicks yet"}</strong></div></article></section>
    <div className="message-trace-layout">
      <main className="message-trace-timeline"><header><div><span>Event timeline</span><h2>What happened</h2></div><small>{data.events.length} recorded event{data.events.length === 1 ? "" : "s"}</small></header><ol>{data.events.map((event, index) => <TraceRow event={event} key={`${event.kind}-${event.occurredAt}-${index}`} isLast={index === data.events.length - 1}/>)}</ol></main>
      <aside className="message-trace-side"><section><span>Recipient</span><strong>Profile record</strong><Link href={`/w/${workspaceId}/profiles/${message.profileId}`}>Open recipient profile →</Link></section><section><span>Email version</span><strong>{message.emailVersionId ? "Published version" : "Test snapshot"}</strong><code>{message.emailVersionId ? `${message.emailVersionId.slice(0, 12)}…` : "Not applicable"}</code></section><section><span>Tracking note</span><p>Opens depend on remote images loading. Tracked clicks are stronger engagement evidence.</p></section></aside>
    </div>
  </section>;
}

function TraceRow({ event, isLast }: { event: TraceEvent; isLast: boolean }) {
  const view = eventView(event);
  return <li className={`message-trace-row ${view.tone}`}><div className="message-trace-marker"><i>{view.glyph}</i>{!isLast && <b/>}</div><article><header><div><strong>{view.title}</strong><span>{view.text}</span></div><time>{date(event.occurredAt)}</time></header><details><summary>Technical details</summary><pre>{JSON.stringify(event.detail, null, 2)}</pre></details></article></li>;
}
