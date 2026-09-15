"use client";

import {useCallback,useEffect,useState} from "react";

import {phase1Api} from "../lib/phase1-api";

const names=["Upload","Map fields","Choose rules","Validate","Commit","Results"];
const apiBase=process.env.NEXT_PUBLIC_EMAIL_PLATFORM_API_URL??"http://localhost:4000";

export function ImportManager({workspaceId,importId,targetListId}:{workspaceId:string;
importId?:string;targetListId?:string}){const [jobs,setJobs]=useState<any[]>([]),[job,setJob]=useState<any>(null),[preview,setPreview]=useState<any>(null),[lists,setLists]=useState<any[]>([]),[file,setFile]=useState<File|null>(null),[mapping,setMapping]=useState<any>({email:"",firstName:"",lastName:"",properties:{}}),[policy,setPolicy]=useState<any>({source:"csv import",upsert:true,blankPolicy:"ignore",destinationListId:targetListId??"",consentEnabled:false,consentSource:"",evidenceNote:""}),[stage,setStage]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false),[ledger,setLedger]=useState<any[]|null>(null);
const load=useCallback(async()=>{try{const [imports,available]=await Promise.all([phase1Api<{items:any[]}>(`/api/v1/workspaces/${workspaceId}/imports`),phase1Api<{items:any[]}>(`/api/v1/workspaces/${workspaceId}/lists`)]);
setJobs(imports.items);
setLists(available.items);
if(importId){const j=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}`);
setJob(j);
const p=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/preview`);
setPreview(p);
setMapping(j.mapping??{email:p.headers.find((h:string)=>h.toLowerCase()==="email")??"",firstName:p.headers.find((h:string)=>h.toLowerCase().includes("first"))??"",lastName:p.headers.find((h:string)=>h.toLowerCase().includes("last"))??"",properties:{}});
setPolicy({...policy,...(j.policy??{}),destinationListId:j.policy?.destinationListId??targetListId??"",consentEnabled:Boolean(j.policy?.consent),consentSource:j.policy?.consent?.source??"",evidenceNote:j.policy?.consent?.evidenceNote??""});
setStage(j.state==="uploaded"?1:j.state==="mapping"?2:j.state==="validated"?3:["approved","processing"].includes(j.state)?4:5)}setError("")}catch(e:any){setError(e.message)}},[workspaceId,importId,targetListId]);
useEffect(()=>{void load()},[load]);
const upload=async()=>{if(!file)return;
setBusy(true);
try{const created=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/uploads`,{method:"POST",headers:{"content-type":"text/csv","x-file-name":file.name},body:file});
window.location.href=`/w/${workspaceId}/imports/${created.id}${targetListId?`?targetListId=${encodeURIComponent(targetListId)}`:""}`}catch(e:any){setError(e.message)}finally{setBusy(false)}};
if(!importId)return <><div className="page-heading"><div><h1>Import profiles</h1><p>Upload a CSV, map fields, validate changes, and commit only reviewed data.</p></div></div><section className="panel upload-card"><h2>Upload CSV</h2><p className="panel-subtitle">Files are stored privately. Importing a profile or adding it to a list never grants marketing consent.</p><input type="file" accept=".csv,text/csv" onChange={e=>setFile(e.target.files?.[0]??null)}/>{file&&<p>{file.name} · {new Intl.NumberFormat().format(file.size)} bytes</p>}<div className="modal-actions"><button className="button-primary" disabled={!file||busy} onClick={upload}>{busy?"Uploading…":"Upload CSV"}</button></div></section>{error&&<div role="alert">{error}</div>}<section className="panel import-history"><h2>Import history</h2>{jobs.length?<div className="table-wrap"><table><thead><tr><th>File</th><th>State</th><th>Created</th><th/></tr></thead><tbody>{jobs.map(x=><tr key={x.id}><td>{x.originalName??"CSV import"}</td><td><span className="pill pill-neutral">{x.state.replaceAll("_"," ")}</span></td><td>{new Date(x.createdAt).toLocaleString()}</td><td><a className="row-action" href={`/w/${workspaceId}/imports/${x.id}`}>Resume</a></td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>No imports yet.</strong><p>Upload a CSV to start a persisted import job.</p></div>}</section></>;
const configure=async(next=2)=>{if(!mapping.email)throw new Error("Map a primary email column before continuing.");
setBusy(true);
try{const savedPolicy={source:policy.source,upsert:policy.upsert,blankPolicy:policy.blankPolicy,destinationListId:policy.destinationListId||undefined,consent:policy.consentEnabled?{status:"granted",source:policy.consentSource,evidenceNote:policy.evidenceNote}:undefined};
const saved=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/mapping`,{method:"POST",body:JSON.stringify({mapping,policy:savedPolicy})});
setJob(saved);
setStage(next);
setError("")}catch(e:any){setError(e.message)}finally{setBusy(false)}};
const validate=async()=>{try{await configure(3);
const result=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/validate`,{method:"POST"});
setJob(result);
setStage(3)}catch(e:any){setError(e.message)}};
const commit=async()=>{setBusy(true);
try{const accepted=await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/commit`,{method:"POST"});
setJob(accepted);
setStage(4);
await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}};
const rollback=async()=>{if(!confirm("Rollback restores only safe profile changes and removes import memberships. Consent and later edits are preserved."))return;
setBusy(true);
try{setJob(await phase1Api<any>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/rollback`,{method:"POST"}));
await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}};
return <><div className="page-heading"><div><h1>{stage===1?"Import profiles":stage===3?"Import validation":stage>=5?"Import results":"Import profiles"}</h1><p>{stage===1?"Map incoming columns to profile fields before validation or commit.":stage===3?"Review duplicates, consent implications, and estimated mutations before anything changes.":stage>=5?"Inspect exactly what changed, what failed, and which recovery options remain safe.":"Use the persisted import job to safely prepare a profile import."}</p></div><a className="button-secondary" href={`/w/${workspaceId}/imports`}>Save & exit</a></div><div className="import-steps">{names.map((name,index)=><div className={index===stage?"active":index<stage?"complete":""} key={name}><i>{index<stage?"✓":index+1}</i><span>{name}</span></div>)}</div>{error&&<div role="alert">{error}</div>}{stage===1&&<MapFields preview={preview} mapping={mapping} setMapping={setMapping} onContinue={()=>configure(2)} busy={busy}/>} {stage===2&&<Rules lists={lists} policy={policy} setPolicy={setPolicy} onBack={()=>setStage(1)} onValidate={validate} busy={busy}/>} {stage===3&&<Validation job={job} preview={preview} onBack={()=>setStage(2)} onCommit={commit} busy={busy} workspaceId={workspaceId} importId={importId}/>} {stage===4&&<section className="panel import-progress"><h2>{job?.state==="processing"?"Processing import":"Import queued"}</h2><p className="panel-subtitle">The server processes the persisted file; reload this page to obtain the latest state.</p><button className="button-secondary" onClick={load}>Refresh status</button></section>} {stage>=5&&<Results job={job} lists={lists} workspaceId={workspaceId} importId={importId} ledger={ledger} setLedger={setLedger} onRollback={rollback} busy={busy}/>}</>}
function MapFields({preview,mapping,setMapping,onContinue,busy}:{preview:any;
mapping:any;
setMapping:any;
onContinue:()=>void;
busy:boolean}){const headers:string[]=preview?.headers??[];
const sample=(h:string)=>preview?.samples?.[0]?.[headers.indexOf(h)]??"—";
const assign=(key:string,value:string)=>setMapping((x:any)=>({...x,[key]:value}));
return <div className="import-map-grid"><section className="panel side-card"><h2>Incoming columns</h2><p className="panel-subtitle">{preview?.fileName??"CSV"} · {preview?.rowCount??0} rows</p><div className="incoming-columns">{headers.map(h=><div key={h}><strong>{h}</strong><small>{sample(h)}</small><em>text</em></div>)}</div></section><section className="panel side-card"><div className="panel-heading"><div><h2>Map to profile fields</h2><p className="panel-subtitle">Email mapping is required. Suggestions remain editable.</p></div><span className="pill pill-success">{[mapping.email,mapping.firstName,mapping.lastName].filter(Boolean).length} mapped</span></div><div className="table-wrap"><table><thead><tr><th>Incoming column</th><th>Map to</th><th>Sample</th></tr></thead><tbody>{headers.map(h=><tr key={h}><td>{h}</td><td><select value={mapping.email===h?"email":mapping.firstName===h?"firstName":mapping.lastName===h?"lastName":mapping.properties?.[h]?`property:${mapping.properties[h]}`:""} onChange={e=>{const v=e.target.value;
const next:any={...mapping,properties:{...mapping.properties}};
["email","firstName","lastName"].forEach(k=>{if(next[k]===h)next[k]=""});
delete next.properties[h];
if(v.startsWith("property:"))next.properties[h]=v.slice(9);
else if(v)next[v]=h;
setMapping(next)}}><option value="">Do not import</option><option value="email">Primary email</option><option value="firstName">First name</option><option value="lastName">Last name</option><option value={`property:${h}`}>Custom property · {h}</option></select></td><td>{sample(h)}</td></tr>)}</tbody></table></div><div className="modal-actions"><button className="button-primary" disabled={!mapping.email||busy} onClick={onContinue}>{busy?"Saving…":"Continue to rules"}</button></div></section></div>}
function Rules({lists,policy,setPolicy,onBack,onValidate,busy}:{lists:any[];
policy:any;
setPolicy:any;
onBack:()=>void;
onValidate:()=>void;
busy:boolean}){const set=(k:string,v:any)=>setPolicy((x:any)=>({...x,[k]:v}));
return <section className="panel rules-card"><h2>Choose rules</h2><p className="panel-subtitle">CSV membership and import provenance do not grant marketing consent.</p><div className="form-grid"><label>Import behavior<select value={String(policy.upsert)} onChange={e=>set("upsert",e.target.value==="true")}><option value="true">Upsert existing profiles</option><option value="false">Create new only</option></select></label><label>Blank value behavior<select value={policy.blankPolicy} onChange={e=>set("blankPolicy",e.target.value)}><option value="ignore">Ignore blanks</option><option value="clear">Clear mapped values</option></select></label><label>Target static list<select value={policy.destinationListId} onChange={e=>set("destinationListId",e.target.value)}><option value="">No target list</option>{lists.filter(x=>x.status==="active").map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Import source<input value={policy.source} onChange={e=>set("source",e.target.value)}/></label></div><label className="consent-check"><input type="checkbox" checked={policy.consentEnabled} onChange={e=>set("consentEnabled",e.target.checked)}/> Import consent evidence</label>{policy.consentEnabled&&<div className="form-grid"><label>Consent source<input value={policy.consentSource} onChange={e=>set("consentSource",e.target.value)}/></label><label>Evidence declaration<input value={policy.evidenceNote} onChange={e=>set("evidenceNote",e.target.value)}/></label></div>}<div className="modal-actions"><button className="button-secondary" onClick={onBack}>Back</button><button className="button-primary" disabled={busy} onClick={onValidate}>{busy?"Validating…":"Validate import"}</button></div></section>}
function Validation({job,preview,onBack,onCommit,busy,workspaceId,importId}:{job:any;
preview:any;
onBack:()=>void;
onCommit:()=>void;
busy:boolean;
workspaceId:string;
importId:string}){const t=job?.totals??job?.preview?.totals??{};
const cards=[["Total rows",t.total??preview?.rowCount??0,"violet"],["Valid",t.valid??0,"mint"],["Invalid",t.invalid??0,"peach"],["Duplicates",t.duplicateInFile??0,"blue"]];
return <><div className="metric-grid">{cards.map(([n,v,c])=><div className={`metric-card ${c}`} key={String(n)}><div className="metric-label">{n}</div><div className="metric-value">{String(v)}</div></div>)}</div><div className="validation-grid"><section className="panel side-card"><h2>Validation summary</h2><div className="table-wrap"><table><thead><tr><th>Check</th><th>Result</th><th>Rows affected</th><th>Action</th></tr></thead><tbody><tr><td>Email format</td><td><span className={`pill ${(t.invalid??0)===0?"pill-success":"pill-danger"}`}>{(t.invalid??0)===0?"Passed":"Errors"}</span></td><td>{t.invalid??0}</td><td>{(t.invalid??0)>0?<a href={`${apiBase}/api/v1/workspaces/${workspaceId}/imports/${importId}/errors`}>Download rows</a>:"—"}</td></tr><tr><td>Duplicate in file</td><td><span className="pill pill-warning">Handled</span></td><td>{t.duplicateInFile??0}</td><td>Review rules</td></tr><tr><td>Consent evidence</td><td><span className="pill pill-neutral">{job?.policy?.consent?"Review":"Not selected"}</span></td><td>—</td><td>Append-only</td></tr></tbody></table></div></section><section className="panel side-card"><h2>Estimated changes</h2><div className="estimate-list"><div><span>New profiles</span><strong>Calculated during commit</strong></div><div><span>Existing profiles</span><strong>Calculated during commit</strong></div><div><span>List memberships</span><strong>{job?.policy?.destinationListId?"Target list selected":"No target list"}</strong></div></div>{job?.policy?.consent&&<div className="consent-warning">Review consent source before commit. This import appends evidence; it never rewrites consent history.</div>}</section></div><div className="modal-actions import-bottom"><button className="button-secondary" onClick={onBack}>Back</button>{(t.invalid??0)>0&&<a className="button-secondary" href={`${apiBase}/api/v1/workspaces/${workspaceId}/imports/${importId}/errors`}>Download errors</a>}<button className="button-primary" disabled={busy} onClick={onCommit}>{busy?"Committing…":"Continue to commit"}</button></div></>}
function Results({job,lists,workspaceId,importId,ledger,setLedger,onRollback,busy}:{job:any;
lists:any[];
workspaceId:string;
importId:string;
ledger:any[]|null;
setLedger:any;
onRollback:()=>void;
busy:boolean}){const t=job?.totals??{};
const state=job?.state??"completed";
const getLedger=async()=>{try{setLedger((await phase1Api<{items:any[]}>(`/api/v1/workspaces/${workspaceId}/imports/${importId}/changes`)).items)}catch{setLedger([])}};
const target=lists.find(x=>x.id===job?.policy?.destinationListId);
return <><section className="import-complete"><strong>{state==="completed"?"Import completed":state==="rolled_back"?"Import rolled back":"Import completed with issues"}</strong><p>{state==="rolled_back"?"Only safe profile changes and import memberships were reverted; consent records and later changes remain protected.":"Results are calculated from persisted row outcomes."}</p></section><div className="metric-grid">{[["Created",t.created??0,"violet"],["Updated",t.updated??0,"mint"],["Unchanged",t.skipped??0,"peach"],["Failed",t.invalid??0,"blue"]].map(([n,v,c])=><div className={`metric-card ${c}`} key={String(n)}><div className="metric-label">{n}</div><div className="metric-value">{String(v)}</div></div>)}</div><div className="validation-grid"><section className="panel side-card"><h2>Import summary</h2><div className="estimate-list"><div><span>Target list</span><strong>{target?.name??"Not selected"}</strong></div><div><span>Consent source</span><strong>{job?.policy?.consent?.source??"No consent change"}</strong></div><div><span>Blank value policy</span><strong>{job?.policy?.blankPolicy??"—"}</strong></div><div><span>Duplicate policy</span><strong>{job?.policy?.upsert?"Upsert existing":"Create new only"}</strong></div></div></section><section className="panel side-card"><h2>Artifacts & recovery</h2><div className="recovery-list"><a href={`${apiBase}/api/v1/workspaces/${workspaceId}/imports/${importId}/errors`}>Download error rows CSV</a><button onClick={getLedger}>View change ledger</button>{["completed","completed_with_errors"].includes(state)&&<button onClick={onRollback} disabled={busy}>Review rollback</button>}</div></section></div>{target&&<a className="button-primary" href={`/w/${workspaceId}/audiences/lists/${target.id}`}>Open imported list</a>}{ledger&&<section className="panel ledger-panel"><h2>Immutable change ledger</h2>{ledger.length?<div className="table-wrap"><table><thead><tr><th>Profile</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{ledger.map((x:any,index:number)=><tr key={index}><td>{x.profileId}</td><td>{x.changeType}</td><td>{x.before?JSON.stringify(x.before):"—"}</td><td>{x.after?JSON.stringify(x.after):"—"}</td></tr>)}</tbody></table></div>:<div className="empty-state">No change records exist for this import.</div>}</section>}</>}
