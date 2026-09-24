import test from "node:test";
import assert from "node:assert/strict";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";
import { InMemoryPhase2Repository } from "../packages/persistence/src/proof/in-memory-phase2-repository.js";
import { DisabledEmailProvider } from "../packages/provider-email/src/disabled-email-provider.js";

const logo = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString("base64");
const objects = { put: async () => {}, get: async () => Buffer.alloc(0), delete: async () => {} };
const config = { publicBaseUrl: "https://send.example.test", unsubscribeSecret: "s".repeat(32), trackingSecret: "t".repeat(32), maxMessageBytes: 500_000 };

test("R2 logo upload requires configuration and rejects invalid image bytes", async () => {
  const repo = new InMemoryPhase2Repository();
  repo.members.set("workspace:owner", "owner");
  const actor = { workspaceId: "workspace", userId: "owner" };
  const noR2 = new Phase2Service(repo, objects, new DisabledEmailProvider(), config);
  await assert.rejects(noR2.uploadMediaLogo(actor, { name: "logo.png", mimeType: "image/png", contentBase64: logo }), /R2_MEDIA_NOT_CONFIGURED/);
  const service = new Phase2Service(repo, objects, new DisabledEmailProvider(), { ...config, r2Media: { accountId: "account", bucket: "brand", apiToken: "secret", publicBaseUrl: "https://media.example.test" } });
  await assert.rejects(service.uploadMediaLogo(actor, { name: "logo.png", mimeType: "image/png", contentBase64: Buffer.from("not an image").toString("base64") }), /MEDIA_TYPE_INVALID/);
});

test("R2 logo upload records the public image only after storage accepts it", async () => {
  const repo = new InMemoryPhase2Repository();
  repo.members.set("workspace:owner", "owner");
  const service = new Phase2Service(repo, objects, new DisabledEmailProvider(), { ...config, r2Media: { accountId: "account", bucket: "brand", apiToken: "secret", publicBaseUrl: "https://media.example.test" } });
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/account\/r2\/buckets\/brand\/objects\/content-assets\/workspace\//);
    assert.equal(options?.method, "PUT");
    assert.equal((options?.headers as Record<string,string>)["content-type"], undefined);
    assert.ok(options?.body instanceof FormData);
    assert.equal((options.body.get("body") as File).type, "image/png");
    return new Response(null, { status: 201 });
  };
  try {
    const result = await service.uploadMediaLogo({ workspaceId: "workspace", userId: "owner" }, { name: "logo.png", mimeType: "image/png", contentBase64: logo });
    assert.match(result.url, /^https:\/\/media\.example\.test\/content-assets\/workspace\//);
    assert.equal((await repo.listMediaAssets("workspace", { archived: false })).length, 1);
  } finally { globalThis.fetch = previous; }
});
