"use client";
import { useEffect,useState } from "react";
import { phase1Api } from "../lib/phase1-api";
import { ValidationSummary,type ValidationItem } from "./validation-summary";
export function ReadinessPanel({workspaceId}:{workspaceId:string}){const [data,setData]=useState<{ready:boolean;checks:ValidationItem[]}|null>(null);const [error,setError]=useState("");useEffect(()=>{phase1Api<any>(`/api/v1/workspaces/${workspaceId}/readiness`).then(setData).catch(e=>setError(e.message))},[workspaceId]);if(error)return <div role="alert">{error}</div>;if(!data)return <p>Checking readiness…</p>;return <><p><strong>{data.ready?"Platform foundation ready":"Production sending remains locked"}</strong></p><ValidationSummary items={data.checks}/></>}
