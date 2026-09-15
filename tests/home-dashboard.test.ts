import test from "node:test";
import assert from "node:assert/strict";
import { homePeriod, homeRecommendations } from "../packages/application/src/home/home-dashboard.js";

test("home period accepts only supported bounded ranges",()=>{
  const now=new Date("2026-08-21T12:00:00Z");
  assert.equal(homePeriod("1",now).days,1);
  assert.equal(homePeriod("30",now).days,30);
  assert.equal(homePeriod("365",now).days,7);
  assert.equal(homePeriod("bad",now).from.toISOString(),"2026-08-14T12:00:00.000Z");
});

test("home recommendations prioritize safety blockers and remain deterministic",()=>{
  const items=homeRecommendations({readinessReady:false,profileCount:0,listCount:0,segmentCount:0,emailCount:0,publishedEmailCount:0,flowCount:0,draftFlowCount:0,activeFlowCount:0,activeHoldCount:1,failedImportCount:1,workspaceId:"w",canManageOperations:false});
  assert.deepEqual(items.slice(0,3).map(x=>x.id),["complete-readiness","review-hold","review-import"]);
  assert.equal(items.find(x=>x.id==="review-hold")?.action.available,false);
  assert.ok(items.length<=5);
});
