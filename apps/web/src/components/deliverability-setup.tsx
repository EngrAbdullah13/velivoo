"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { phase1Api } from "../lib/phase1-api";

type Setup={
  runtimeMode:string;publicBaseUrl:string;publicHttps:boolean;
  feedback:{callbackUrl:string;emailProvider:string;sendingEnabled:boolean;snsTopicConfigured:boolean;configurationSetConfigured:boolean;ready:boolean};
  unsubscribe:{endpointUrl:string;publicHttps:boolean;ready:boolean};
};

function State({ready}:{ready:boolean}){return <span className={`pill ${ready?"pill-success":"pill-warning"}`}>{ready?"Ready":"Action required"}</span>}

export function DeliverabilitySetup({workspaceId}:{workspaceId:string}){
  const [data,setData]=useState<Setup|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setError("");setData(await phase1Api<Setup>(`/api/v1/workspaces/${workspaceId}/deliverability/setup`))}catch(e){setError(e instanceof Error?e.message:"Unable to load deliverability setup.")}},[workspaceId]);
  useEffect(()=>{void load()},[load]);
  if(!data&&!error)return <section className="panel empty-state"><strong>Loading deliverability setup…</strong></section>;
  if(!data)return <section className="panel empty-state" role="alert"><strong>Deliverability setup could not be loaded.</strong><p>{error}</p><button className="button-secondary" onClick={()=>void load()}>Try again</button></section>;
  const base=`/w/${workspaceId}`;
  return <section className="deliverability-stack">
    <header className="page-heading"><div><span className="eyebrow">Internal administration</span><h1>Feedback & unsubscribe setup</h1><p>These are platform-wide public endpoints. They cannot be completed by changing a domain’s DNS records or by entering AWS credentials in the browser.</p></div><div className="button-row"><Link className="button-secondary" href={`${base}/deliverability/infrastructure`}>Infrastructure readiness</Link><Link className="button-secondary" href={`${base}/deliverability/overview`}>Back to deliverability</Link></div></header>
    {data.runtimeMode!=="production"&&<section className="panel suppressions-note"><strong>Local development mode</strong><p>This installation is using <code>{data.publicBaseUrl}</code>. It can render and test unsubscribe links, but localhost cannot receive SNS callbacks or provide a public unsubscribe page. Production activation remains correctly blocked.</p></section>}
    <div className="dashboard-grid">
      <article className="panel delivery-summary"><div className="panel-heading"><div><h2>Bounce & complaint feedback</h2><p className="panel-subtitle">Amazon SES sends signed events to the platform; the platform stores them before applying suppressions.</p></div><State ready={data.feedback.ready}/></div><dl><dt>Provider</dt><dd>{data.feedback.emailProvider.toUpperCase()}</dd><dt>Sending enabled</dt><dd>{data.feedback.sendingEnabled?"Yes":"No"}</dd><dt>SNS topic configured</dt><dd>{data.feedback.snsTopicConfigured?"Configured":"Missing"}</dd><dt>SES configuration set</dt><dd>{data.feedback.configurationSetConfigured?"Configured":"Missing"}</dd><dt>Public callback</dt><dd><code>{data.feedback.callbackUrl}</code></dd></dl></article>
      <article className="panel delivery-summary"><div className="panel-heading"><div><h2>Unsubscribe experience</h2><p className="panel-subtitle">Published mail automatically includes the compliance footer and List-Unsubscribe headers.</p></div><State ready={data.unsubscribe.ready}/></div><dl><dt>Public HTTPS URL</dt><dd>{data.publicHttps?"Configured":"Required"}</dd><dt>Confirmation endpoint</dt><dd><code>{data.unsubscribe.endpointUrl}</code></dd><dt>One-click POST</dt><dd>Handled by the same endpoint</dd><dt>Published-email footer</dt><dd>Added at send time</dd></dl></article>
    </div>
    <article className="panel action-center"><div className="panel-heading"><div><h2>Complete feedback setup</h2><p className="panel-subtitle">Do this once for the deployed platform, not once per workspace or sender domain.</p></div></div><ol className="setup-checklist"><li>Deploy the public API to an internet-reachable HTTPS address, then set <code>EMAIL_PLATFORM_PUBLIC_BASE_URL</code> to that address.</li><li>Create an SNS topic in the same AWS region as SES and set its ARN in <code>EMAIL_PLATFORM_SNS_TOPIC_ARN</code> on the server.</li><li>Add an HTTPS subscription to the topic using the callback URL above. The platform confirms the SNS subscription after validating its signature.</li><li>In Amazon SES, configure the active configuration set to publish bounce, complaint, and delivery events to that SNS topic. Set <code>SES_CONFIGURATION_SET</code> on the server if your deployment uses one.</li><li>Restart the public API and send a controlled message. The Bounces &amp; Complaints page must show the real provider event before production readiness can pass.</li></ol><p className="panel-subtitle">AWS access keys stay server-side. Never put them in a browser form or a <code>NEXT_PUBLIC_*</code> variable.</p></article>
    <article className="panel action-center"><div className="panel-heading"><div><h2>Complete unsubscribe setup</h2><p className="panel-subtitle">There is no manual “mark ready” switch: the route must be publicly reachable.</p></div></div><ol className="setup-checklist"><li>Use the same public HTTPS base URL as feedback.</li><li>Make sure the public API serves <code>/public/v1/unsubscribe</code> on that host. A GET shows a confirmation page; the one-click POST applies the protected unsubscribe.</li><li>Publish an email and send a safe test. Confirm that its footer contains the business name, physical address, and unsubscribe link.</li><li>Only after the public endpoint is deployed and checked should production sending be considered for activation.</li></ol><div className="button-row"><Link className="button-secondary" href={`${base}/settings/general`}>Check business identity</Link><Link className="button-secondary" href={`${base}/content/emails`}>Open email content</Link><Link className="button-secondary" href={`${base}/deliverability/bounces`}>View provider feedback</Link></div></article>
  </section>;
}
