"use client";
import { useEffect,useState } from "react";
import { phase1Api } from "../lib/phase1-api";
export function WorkspaceSwitcher({workspaceId,workspaceName}:{workspaceId:string;workspaceName?:string}){
 const [items,setItems]=useState<Array<{id:string;name:string}>>([]);
 useEffect(()=>{phase1Api<{items:Array<{id:string;name:string}>}>("/api/v1/me/workspaces").then(d=>setItems(d.items)).catch(()=>undefined)},[]);
 function change(id:string){if(id&&id!==workspaceId)window.location.href=`/w/${id}/home`}
 return <details className="workspace-switcher"><summary aria-label="Switch workspace" title="Switch workspace">Workspaces</summary><label><span>{workspaceName??items.find(w=>w.id===workspaceId)?.name??"Workspace"}</span><small>Active workspace</small><select aria-label="Active workspace" value={workspaceId} onChange={e=>change(e.target.value)}>{items.length?items.map(w=><option key={w.id} value={w.id}>{w.name}</option>):<option value={workspaceId}>{workspaceName??"Workspace"}</option>}</select></label></details>
}
