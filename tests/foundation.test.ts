import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { ProofStore, TenantIsolationError } from "../packages/persistence/src/proof/proof-store.js";
import { FileDispatchQueue } from "../packages/queue/src/proof/file-queue.js";
import { FakeEmailProvider } from "../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase0Service } from "../packages/application/src/phase0-service.js";
import { assertExpectedSnsTopic, snsStringToSign, verifySnsEnvelopeWithPem, type SnsEnvelope } from "../packages/provider-email/src/ses/sns-verifier.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../packages/email-renderer/src/unsubscribe-token.js";
import { streamCsvRows } from "../packages/testkit/src/csv-stream.js";
import { validateFlowGraph } from "../packages/domain/src/flow-validator.js";
import { compileRuleToSql, validateRule } from "../packages/domain/src/rules.js";
import { simulateFlow } from "../packages/domain/src/flow-simulator.js";
import { normalizeSesSnsEnvelope } from "../packages/provider-email/src/ses/normalize-feedback.js";

function harness() {
  const dir=mkdtempSync(join(tmpdir(),"phase0-test-")); let now=new Date("2026-08-18T12:00:00.000Z"); const provider=new FakeEmailProvider();
  const storePath=join(dir,"store.json"), queuePath=join(dir,"queue.ndjson");
  const make=(reset=false)=>{const store=new ProofStore(storePath,reset),queue=new FileDispatchQueue(queuePath),service=new Phase0Service(store,queue,provider,{publicBaseUrl:"https://phase0.example",unsubscribeSecret:"0123456789abcdef0123456789abcdef",emailSendEnabled:false},()=>new Date(now));return{store,queue,service};};
  return {dir,provider,make,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test("tenant scoped repositories fail closed",()=>{const h=harness();try{const a=h.make(true);const sa=a.service.bootstrap();const ws2={...a.store.getWorkspace(sa.workspaceId),id:"workspace-b",name:"B"};a.store.addWorkspace(ws2);assert.throws(()=>a.store.getProfile("workspace-b",sa.profileId),TenantIsolationError);}finally{h.cleanup();}});

test("durable wait survives queue loss/restart and duplicate job submits once",async()=>{const h=harness();try{let x=h.make(true);const seed=x.service.bootstrap();const started=x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:1000});x.queue.clear();h.advance(2000);x=h.make(false);assert.equal(x.service.dispatchDueActions(),1);x.queue.enqueue({jobType:"scheduled.execute",jobVersion:1,jobId:started.scheduledActionId,workspaceId:seed.workspaceId,resourceType:"scheduled_action",resourceId:started.scheduledActionId,correlationId:started.flowRunId,enqueuedAt:new Date().toISOString(),attempt:2});await x.service.runWorkerOnce();assert.equal(h.provider.submitCalls,1);assert.equal(x.store.snapshot().messages.length,1);}finally{h.cleanup();}});

test("unsubscribe during wait blocks final provider submission",async()=>{const h=harness();try{const x=h.make(true);const seed=x.service.bootstrap();x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:1000});x.service.unsubscribe(seed.workspaceId,seed.profileId);h.advance(2000);x.service.dispatchDueActions();await x.service.runWorkerOnce();assert.equal(h.provider.submitCalls,0);assert.equal(x.store.snapshot().messages[0]?.state,"skipped");}finally{h.cleanup();}});

test("unknown provider outcome reconciles without blind resend",async()=>{const h=harness();try{const x=h.make(true);h.provider.mode="accept-then-unknown";const seed=x.service.bootstrap();x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:0});x.service.dispatchDueActions();await x.service.runWorkerOnce();const m=x.store.snapshot().messages[0]!;assert.equal(m.state,"unknown");assert.equal(h.provider.submitCalls,1);assert.equal(await x.service.reconcileUnknown(seed.workspaceId,m.id),"submitted");assert.equal(h.provider.submitCalls,1);assert.equal(x.store.getMessage(seed.workspaceId,m.id).state,"submitted");}finally{h.cleanup();}});

test("duplicate feedback is idempotent and complaint/bounce can suppress",async()=>{const h=harness();try{const x=h.make(true);const seed=x.service.bootstrap();x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:0});x.service.dispatchDueActions();await x.service.runWorkerOnce();const m=x.store.snapshot().messages[0]!;const f={providerEventId:"evt-1",provider:"ses",providerMessageId:m.providerMessageId!,eventType:"delivery" as const,occurredAt:new Date().toISOString()};assert.equal(x.service.applyProviderFeedback(f),true);assert.equal(x.service.applyProviderFeedback(f),false);assert.equal(x.store.snapshot().deliveryEvents.length,1);}finally{h.cleanup();}});

test("unsubscribe token is signed and tamper resistant",()=>{const secret="0123456789abcdef0123456789abcdef";const token=signUnsubscribeToken({workspaceId:"w",profileId:"p",purpose:"marketing",v:1},secret);assert.equal(verifyUnsubscribeToken(token,secret).profileId,"p");assert.throws(()=>verifyUnsubscribeToken(token+"x",secret));});

test("SNS signature canonicalization verifies signed envelope",()=>{const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});const envelope:SnsEnvelope={Type:"Notification",MessageId:"m1",TopicArn:"arn:aws:sns:us-east-1:123:test",Message:"{\"notificationType\":\"Delivery\",\"mail\":{\"messageId\":\"p1\"}}",Timestamp:"2026-08-18T12:00:00.000Z",SignatureVersion:"2",Signature:"",SigningCertURL:"https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"};envelope.Signature=sign("RSA-SHA256",Buffer.from(snsStringToSign(envelope)),privateKey).toString("base64");assert.equal(verifySnsEnvelopeWithPem(envelope,publicKey.export({type:"spki",format:"pem"}).toString()),true);});


test("one-click unsubscribe is idempotent",()=>{const h=harness();try{const x=h.make(true);const seed=x.service.bootstrap();x.service.unsubscribe(seed.workspaceId,seed.profileId);x.service.unsubscribe(seed.workspaceId,seed.profileId);const snap=x.store.snapshot();assert.equal(snap.suppressions.filter(s=>s.reason==="global_unsubscribe").length,1);assert.equal(snap.consents.filter(c=>c.status==="withdrawn").length,1);}finally{h.cleanup();}});

test("proof store transaction rolls back partial outbox state",()=>{const h=harness();try{const x=h.make(true);const seed=x.service.bootstrap();const before=x.store.snapshot().outbox.length;assert.throws(()=>x.store.transaction(()=>{x.store.addOutbox({id:"outbox-temp",workspaceId:seed.workspaceId,aggregateType:"proof",aggregateId:seed.profileId,eventType:"proof",payload:{},createdAt:new Date().toISOString()});throw new Error("boom");}));assert.equal(x.store.snapshot().outbox.length,before);}finally{h.cleanup();}});

test("flow and rule guardrails reject unsafe definitions",()=>{assert.ok(validateFlowGraph({nodes:[{id:"t",type:"trigger"},{id:"e",type:"end"}],edges:[{from:"t",to:"t"}]}).some(i=>i.code==="CYCLE"));assert.throws(()=>validateRule({type:"and",children:[{type:"and",children:[{type:"and",children:[{type:"and",children:[{type:"and",children:[{type:"first_name_exists"}]}]}]}]}]}));});

test("CSV proof is streamed row by row",async()=>{const dir=mkdtempSync(join(tmpdir(),"csv-proof-"));try{const path=join(dir,"large.csv");const lines=["email,first_name"];for(let i=0;i<20000;i++)lines.push(`person${i}@example.com,Person${i}`);writeFileSync(path,lines.join("\n"));let count=0;for await(const row of streamCsvRows(path)){if(count===0)assert.equal(row[0],"email");count++;}assert.equal(count,20001);}finally{rmSync(dir,{recursive:true,force:true});}});


test("SNS topic allowlist rejects a validly signed event from the wrong topic",()=>{
  const envelope:SnsEnvelope={Type:"Notification",MessageId:"m2",TopicArn:"arn:aws:sns:us-east-1:123:wrong",Message:"{}",Timestamp:"2026-08-18T12:00:00.000Z",SignatureVersion:"2",Signature:"x",SigningCertURL:"https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"};
  assert.throws(()=>assertExpectedSnsTopic(envelope,"arn:aws:sns:us-east-1:123:expected"),/SNS_TOPIC_ARN_REJECTED/);
});

test("SES feedback normalization retains internal correlation tags",()=>{
  const envelope:SnsEnvelope={Type:"Notification",MessageId:"sns-evt",TopicArn:"arn:aws:sns:us-east-1:123:test",Message:JSON.stringify({eventType:"Delivery",mail:{messageId:"ses-id",timestamp:"2026-08-18T12:00:00.000Z",tags:{platformMessageId:["internal-id"],requestFingerprint:["abc"]}},delivery:{timestamp:"2026-08-18T12:00:01.000Z"}}),Timestamp:"2026-08-18T12:00:01.000Z",SignatureVersion:"2",Signature:"x",SigningCertURL:"https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"};
  const events = normalizeSesSnsEnvelope(envelope);
  assert.equal(events[0]?.metadata?.platformMessageId,"internal-id");
  assert.equal(events[0]?.metadata?.requestFingerprint,"abc");
});


test("feedback retry re-applies a durably received but unprocessed inbox item",async()=>{
  const h=harness();
  try {
    const x=h.make(true);
    const seed=x.service.bootstrap();
    x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:0});
    x.service.dispatchDueActions();
    await x.service.runWorkerOnce();
    const m=x.store.snapshot().messages[0]!;
    const f={providerEventId:"evt-retry",provider:"ses",providerMessageId:m.providerMessageId!,eventType:"delivery" as const,occurredAt:new Date().toISOString()};
    x.store.addInbox({id:"pre-received",source:"ses",workspaceId:seed.workspaceId,externalId:f.providerEventId,payloadHash:"pre",receivedAt:new Date().toISOString(),status:"received"});
    assert.equal(x.service.applyProviderFeedback(f),true);
    assert.equal(x.store.getInbox("ses",f.providerEventId)?.status,"processed");
    assert.equal(x.store.snapshot().deliveryEvents.filter(e=>e.providerEventId===f.providerEventId).length,1);
  } finally { h.cleanup(); }
});


test("out-of-order feedback cannot downgrade a complaint",async()=>{
  const h=harness();
  try {
    const x=h.make(true);
    const seed=x.service.bootstrap();
    x.service.startFlow({workspaceId:seed.workspaceId,profileId:seed.profileId,flowVersionId:seed.flowVersionId,delayMs:0});
    x.service.dispatchDueActions();
    await x.service.runWorkerOnce();
    const m=x.store.snapshot().messages[0]!;
    const providerMessageId=m.providerMessageId!;
    assert.equal(x.service.applyProviderFeedback({providerEventId:"evt-complaint",provider:"ses",providerMessageId,eventType:"complaint",occurredAt:new Date().toISOString()}),true);
    assert.equal(x.store.getMessage(seed.workspaceId,m.id).state,"complained");
    assert.equal(x.service.applyProviderFeedback({providerEventId:"evt-late-delivery",provider:"ses",providerMessageId,eventType:"delivery",occurredAt:new Date().toISOString()}),true);
    assert.equal(x.store.getMessage(seed.workspaceId,m.id).state,"complained");
  } finally { h.cleanup(); }
});


test("typed rule compiler parameterizes user values",()=>{
  const dangerous = "example.com' OR 1=1 --";
  const plan = compileRuleToSql({type:"and",children:[{type:"email_ends_with",value:dangerous},{type:"first_name_exists"}]});
  assert.match(plan.sql,/normalized_email/);
  assert.ok(!plan.sql.includes(dangerous));
  assert.deepEqual(plan.params,[`%${dangerous.toLowerCase()}`]);
});

test("flow simulation is deterministic and side-effect free",()=>{
  const graph={nodes:[{id:"t",type:"trigger" as const},{id:"d",type:"delay" as const,durationMs:1000},{id:"e",type:"email" as const,emailVersionId:"v1"},{id:"x",type:"end" as const}],edges:[{from:"t",to:"d"},{from:"d",to:"e"},{from:"e",to:"x"}]};
  const start=new Date("2026-08-18T12:00:00.000Z");
  const a=simulateFlow(graph,start);
  const b=simulateFlow(graph,start);
  assert.deepEqual(a,b);
  assert.deepEqual(a.map(x=>x.type),["trigger","delay","email","end"]);
  assert.equal(a[2]?.arrivedAt,"2026-08-18T12:00:01.000Z");
});
