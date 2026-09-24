import assert from "node:assert/strict";
import test from "node:test";
import { linkifyBareHttpsUrls, rewriteTrackableContent } from "../packages/email-renderer/src/trackable-links.js";

test("bare HTTPS URLs become links without nesting existing anchors or changing attributes", () => {
  const html = '<p style="background:url(https://example.com/bg)">Visit https://example.com/page. <a href="https://other.example/path">https://other.example/path</a></p>';
  const linked = linkifyBareHttpsUrls(html);
  assert.match(linked, /Visit <a href="https:\/\/example\.com\/page">https:\/\/example\.com\/page<\/a>\./);
  assert.match(linked, /<a href="https:\/\/other\.example\/path">https:\/\/other\.example\/path<\/a>/);
  assert.equal((linked.match(/<a\b/g) ?? []).length, 2);
  assert.match(linked, /background:url\(https:\/\/example\.com\/bg\)/);
});

test("tracked links cover HTML and plain-text URLs while excluding unsubscribe", async () => {
  const destinations: string[] = [];
  const html = '<p>Read https://example.com/?a=1&amp;b=2. <a href="https://example.com/?a=1&amp;b=2">Open</a> <a href="https://send.example/u/leave">Unsubscribe</a></p>';
  const text = 'Read https://example.com/?a=1&b=2. Unsubscribe: https://send.example/u/leave';
  const result = await rewriteTrackableContent(html, text, async destination => {
    destinations.push(destination);
    return "https://track.example/t/c/opaque";
  }, destination => destination.includes("/u/"));
  assert.deepEqual(destinations, ["https://example.com/?a=1&b=2"]);
  assert.equal((result.html.match(/href="https:\/\/track\.example\/t\/c\/opaque"/g) ?? []).length, 2);
  assert.match(result.html, /href="https:\/\/send\.example\/u\/leave"/);
  assert.match(result.text, /https:\/\/track\.example\/t\/c\/opaque\./);
  assert.match(result.text, /https:\/\/send\.example\/u\/leave$/);
});

test("unfinished URL placeholders do not block rendering", async () => {
  const result = await rewriteTrackableContent("<p>URL: https://...</p>", "URL: https://...", async () => {
    throw new Error("placeholder must not create a tracking link");
  }, () => false);
  assert.equal(result.html, "<p>URL: https://...</p>");
  assert.equal(result.text, "URL: https://...");
});
