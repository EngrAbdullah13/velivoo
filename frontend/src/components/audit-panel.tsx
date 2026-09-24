"use client";
import { useEffect,useState } from "react";
import { phase1Api } from "../lib/phase1-api";
import { DataTable } from "./data-table";
export function AuditPanel({workspaceId}:{workspaceId:string}){const [items,setItems]=useState<any[]>([]),[error,setError]=useState("");useEffect(()=>{phase1Api<any>(`/api/v1/workspaces/${workspaceId}/audit`).then(d=>setItems(d.items??[])).catch(e=>setError(e.message))},[workspaceId]);return <>{error&&<div role="alert">{error}</div>}<DataTable columns={[{key:"action",label:"Action"},{key:"objectType",label:"Object"},{key:"riskLevel",label:"Risk"},{key:"occurredAt",label:"Time"}]} rows={items}/></>}
