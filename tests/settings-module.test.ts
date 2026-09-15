import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "../packages/domain/src/phase1/permissions.js";
import { isQuietHour, validateSendPolicyConfig } from "../packages/domain/src/phase2/send-policy.js";
import { issueApiKey, verifyApiKey } from "../packages/domain/src/phase3/api-key.js";

test("Settings permission bundles keep destructive and credential controls server-restricted",()=>{
  assert.equal(hasPermission("owner","workspace.delete"),true);
  assert.equal(hasPermission("admin","workspace.delete"),false);
  assert.equal(hasPermission("marketer","api_keys.manage"),false);
  assert.equal(hasPermission("analyst","members.manage"),false);
  assert.equal(hasPermission("admin","operations.pause"),true);
});

test("Settings send-policy validation and quiet-hour fallback semantics are deterministic",()=>{
  validateSendPolicyConfig({version:2,frequencyWindowSeconds:86400,frequencyMax:3,quietHours:{startHour:20,endHour:8},warmingDailyLimit:100});
  assert.equal(isQuietHour(new Date("2026-08-24T22:00:00.000Z"),"UTC",{startHour:20,endHour:8}),true);
  assert.equal(isQuietHour(new Date("2026-08-24T12:00:00.000Z"),"UTC",{startHour:20,endHour:8}),false);
  assert.throws(()=>validateSendPolicyConfig({version:1,frequencyWindowSeconds:10,frequencyMax:1}),/SEND_POLICY_INVALID/);
  assert.throws(()=>validateSendPolicyConfig({version:1,frequencyWindowSeconds:3600,frequencyMax:1,quietHours:{startHour:25,endHour:8}}),/SEND_POLICY_QUIET_HOURS_INVALID/);
});

test("Settings API credential material is verifiable without persisting plaintext",()=>{
  const issued=issueApiKey("p".repeat(32));
  assert.equal(issued.secret.startsWith("em_"),true);
  assert.equal(issued.hash.includes(issued.secret),false);
  assert.equal(verifyApiKey(issued.secret,issued.hash,"p".repeat(32)),true);
  assert.equal(verifyApiKey(`${issued.secret}x`,issued.hash,"p".repeat(32)),false);
});
