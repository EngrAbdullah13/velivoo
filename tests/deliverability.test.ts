import test from "node:test";
import assert from "node:assert/strict";
import { assessDeliverabilityHealth, buildDeliverabilityMetrics } from "../packages/domain/src/phase2/deliverability.js";

test("deliverability health is transparent and fails closed for missing domain, feedback, and holds", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const setup = assessDeliverabilityHealth({ domainCount: 0, verifiedDomainCount: 0, activeHoldCount: 0, submitted: 0, hardBounces: 0, complaints: 0 }, now);
  assert.equal(setup.state, "setup");
  assert.equal(setup.reasons[0]?.code, "DOMAIN_MISSING");
  const restricted = assessDeliverabilityHealth({ domainCount: 1, verifiedDomainCount: 1, activeHoldCount: 0, submitted: 3, hardBounces: 0, complaints: 0, feedbackLatestAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) }, now);
  assert.equal(restricted.state, "restricted");
  assert.ok(restricted.reasons.some(reason => reason.code === "FEEDBACK_STALE"));
  const paused = assessDeliverabilityHealth({ domainCount: 1, verifiedDomainCount: 1, activeHoldCount: 1, submitted: 0, hardBounces: 0, complaints: 0 }, now);
  assert.equal(paused.state, "paused");
});

test("deliverability metrics always disclose numerator and denominator", () => {
  const metrics = buildDeliverabilityMetrics({ submitted: 100, delivered: 97, hardBounces: 2, softBounces: 1, complaints: 0, unsubscribes: 4 });
  assert.equal(metrics.find(metric => metric.key === "delivery_rate")?.rate, 0.97);
  assert.equal(metrics.find(metric => metric.key === "hard_bounce_rate")?.numerator, 2);
  assert.equal(metrics.find(metric => metric.key === "unsubscribe_rate")?.denominator, 100);
  assert.equal(buildDeliverabilityMetrics({ submitted: 0, delivered: 0, hardBounces: 0, softBounces: 0, complaints: 0, unsubscribes: 0 })[0]?.rate, null);
});
