import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";

test("local object store prevents path traversal",async()=>{const root=await mkdtemp(join(tmpdir(),"email-object-"));try{const s=new LocalObjectStore(root);await s.put("imports/a.txt","ok");assert.equal((await s.get("imports/a.txt")).toString(),"ok");await assert.rejects(()=>s.put("../escape.txt","bad"),/OBJECT_KEY_OUTSIDE_ROOT/)}finally{await rm(root,{recursive:true,force:true})}});
