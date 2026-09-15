import test from "node:test";
import assert from "node:assert/strict";
import { Phase1Service } from "../packages/application/src/phase1/phase1-service.js";

test("branded-domain removal accepts case-insensitive rootDomain confirmation", async () => {
  const calls:string[]=[];
  const domain:any={id:"domain-a",workspaceId:"workspace-a",domain:"Example.com",rootDomain:"example.com",provisioningMode:"branded_delegation"};
  const repo:any={
    findMember:async()=>({id:"member-a",workspaceId:"workspace-a",userId:"user-a",role:"owner",status:"active"}),
    findDomain:async()=>domain,
    listDomains:async()=>[domain],
    deleteSenderIdentitiesForDomain:async()=>{calls.push("platform-identities");return 0},
    audit:async()=>undefined,
  };
  const branded:any={archive:async()=>{calls.push("aws-cleanup");return {ok:true,archived:true}}};
  const service=new Phase1Service(repo,{put:async()=>undefined,get:async()=>Buffer.alloc(0)} as any,undefined,branded,"branded");
  await service.removeSenderDomain("workspace-a",{userId:"user-a",email:"owner@example.com"},"domain-a",{confirmDomain:"EXAMPLE.COM"});
  assert.deepEqual(calls,["aws-cleanup","platform-identities"]);
});

test("confirmed branded-domain removal cleans platform identities after AWS cleanup", async () => {
  const calls:string[]=[];
  const domain:any={id:"domain-a",workspaceId:"workspace-a",domain:"example.com",rootDomain:"example.com",provisioningMode:"branded_delegation"};
  const repo:any={
    findMember:async()=>({id:"member-a",workspaceId:"workspace-a",userId:"user-a",role:"owner",status:"active"}),
    findDomain:async()=>domain,
    listDomains:async()=>[domain],
    deleteSenderIdentitiesForDomain:async()=>{calls.push("platform-identities");return 2},
    audit:async(input:any)=>calls.push(`audit:${input.after.removedSenderIdentities}`),
  };
  const branded:any={archive:async()=>{calls.push("aws-cleanup");return {ok:true,archived:true}}};
  const service=new Phase1Service(repo,{put:async()=>undefined,get:async()=>Buffer.alloc(0)} as any,undefined,branded,"branded");

  const result:any=await service.removeSenderDomain("workspace-a",{userId:"user-a",email:"owner@example.com"},"domain-a",{confirmDomain:"example.com"});

  assert.equal(result.removedSenderIdentities,2);
  assert.deepEqual(calls,["aws-cleanup","platform-identities","audit:2"]);
});
