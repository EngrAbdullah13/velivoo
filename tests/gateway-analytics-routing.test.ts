import test from "node:test";
import assert from "node:assert/strict";
import { phaseFor, phasePorts } from "../apps/api/src/gateway-routing.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const analytics = `/api/v1/workspaces/${workspace}/analytics`;

test("gateway sends recipient activity and CSV export to the analytics API", () => {
  assert.equal(phaseFor(`${analytics}/recipients`), phasePorts.phase1);
  assert.equal(phaseFor(`${analytics}/recipients/export`), phasePorts.phase1);
  assert.equal(phaseFor(`${analytics}/dashboard`), phasePorts.phase1);
  assert.equal(phaseFor(`${analytics}/export`), phasePorts.phase1);
});

test("gateway keeps the existing analytics summary route on Phase 2", () => {
  assert.equal(phaseFor(analytics), phasePorts.phase2);
  assert.equal(phaseFor(`${analytics}/summary`), phasePorts.phase2);
});
