// Cross-tenant authorization acceptance tests.
//
// These run against the RUNNING gateway (default 127.0.0.1:4000) and a real
// PostgreSQL database, not in-memory repositories. The gateway is the correct
// target because ordered-regex route selection in backend/api/src/app-server.ts
// decides which child API actually serves a path; testing a child port
// directly can pass while the same request 404s or reaches a different module
// through port 4000.
//
// Start the stack first (npm run dev:all), then: npm run test:integration
//
// The suite is excluded from the default `npm test` glob because it requires
// live processes. It skips with an explanatory message rather than failing
// when the gateway or development identity is unavailable.
import test from "node:test";
import assert from "node:assert/strict";

const gateway = (process.env.EMAIL_PLATFORM_TEST_GATEWAY_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const deliveryApi = (process.env.EMAIL_PLATFORM_TEST_DELIVERY_URL ?? "http://127.0.0.1:4102").replace(/\/$/, "");
const userA = `xtenant-a-${Date.now()}@local.test`;
const userB = `xtenant-b-${Date.now()}@local.test`;

type Call = { status: number; body: any };

async function call(base: string, path: string, devUser: string, init: RequestInit = {}): Promise<Call> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-dev-user": devUser, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* Non-JSON bodies (CSV, plain text) are asserted on status alone. */ }
  return { status: response.status, body };
}

async function reachable(base: string) {
  try { return (await fetch(`${base}/health`)).ok; } catch { return false; }
}

async function createWorkspace(devUser: string, name: string) {
  const created = await call(gateway, "/api/v1/workspaces", devUser, {
    method: "POST",
    body: JSON.stringify({ name, legalName: `${name} Legal`, businessAddress: "1 Test Street", timezone: "UTC", locale: "en" }),
  });
  assert.equal(created.status, 201, `workspace creation failed: ${JSON.stringify(created.body)}`);
  return String(created.body.id);
}

// A cross-tenant request must be refused. 403 is the documented behavior for a
// non-member; 404 is accepted so that a future change to non-enumerable
// resources does not have to rewrite these assertions.
function assertDenied(result: Call, description: string) {
  assert.ok([403, 404].includes(result.status), `${description} returned ${result.status} instead of 403/404: ${JSON.stringify(result.body)}`);
}

const gatewayUp = await reachable(gateway);
const devIdentity = gatewayUp && (await call(gateway, "/api/v1/me/workspaces", userA)).status !== 401;
const skip = !gatewayUp
  ? `Gateway ${gateway} is not reachable. Start the stack with: npm run dev:all`
  : !devIdentity
    ? "Development identity is disabled. Set EMAIL_PLATFORM_ALLOW_DEV_IDENTITY=true (non-production only)."
    : false;

test("workspace B member cannot read workspace A resources through the gateway", { skip }, async (t) => {
  const workspaceA = await createWorkspace(userA, "Cross tenant A");
  const workspaceB = await createWorkspace(userB, "Cross tenant B");
  assert.notEqual(workspaceA, workspaceB);

  await t.test("positive control: the owner can read their own workspace", async () => {
    const own = await call(gateway, `/api/v1/workspaces/${workspaceA}`, userA);
    assert.equal(own.status, 200, `owner was denied their own workspace: ${JSON.stringify(own.body)}`);
    const search = await call(gateway, `/api/v1/workspaces/${workspaceA}/home/search?q=test`, userA);
    assert.equal(search.status, 200, `owner was denied their own search: ${JSON.stringify(search.body)}`);
  });

  await t.test("home search does not leak another workspace's profiles, flows or messages", async () => {
    assertDenied(await call(gateway, `/api/v1/workspaces/${workspaceA}/home/search?q=test`, userB), "GET /home/search");
  });

  await t.test("export metadata is not readable across tenants", async () => {
    const created = await call(gateway, `/api/v1/workspaces/${workspaceA}/exports`, userA, {
      method: "POST",
      body: JSON.stringify({ purpose: "cross tenant test", fields: ["email"], ttlSeconds: 900 }),
    });
    assert.equal(created.status, 202, `export creation failed: ${JSON.stringify(created.body)}`);
    const exportId = String(created.body.id);
    assertDenied(await call(gateway, `/api/v1/workspaces/${workspaceA}/exports/${exportId}`, userB), "GET /exports/:id");
    assertDenied(await call(gateway, `/api/v1/workspaces/${workspaceA}/exports/${exportId}/download?token=guess`, userB), "GET /exports/:id/download");
  });

  await t.test("export metadata never returns the download token hash", async () => {
    const created = await call(gateway, `/api/v1/workspaces/${workspaceA}/exports`, userA, {
      method: "POST",
      body: JSON.stringify({ purpose: "token hash test", fields: ["email"], ttlSeconds: 900 }),
    });
    assert.equal(created.status, 202);
    const metadata = await call(gateway, `/api/v1/workspaces/${workspaceA}/exports/${created.body.id}`, userA);
    assert.equal(metadata.status, 200, `owner was denied export metadata: ${JSON.stringify(metadata.body)}`);
    assert.equal(metadata.body.tokenHash, undefined);
  });

  // Regression coverage for routes that were already guarded, so that a future
  // refactor cannot silently remove their membership checks.
  await t.test("already-guarded workspace reads stay guarded", async () => {
    for (const path of ["", "/home", "/profiles", "/lists", "/suppressions", "/audit", "/sender-domains", "/readiness"]) {
      assertDenied(await call(gateway, `/api/v1/workspaces/${workspaceA}${path}`, userB), `GET ${path || "/"}`);
    }
  });
});

// The gateway routes every /deliverability path to platform-api (app-server.ts
// ordered regexes), so delivery-api's own deliverability handlers are currently
// unreachable through port 4000. They are still reachable by anything that can
// talk to the child port, so this case is asserted directly against 4102.
// Remove this direct-port exception once ROUTE-01 is fixed.
test("delivery-api deliverability diagnostics require workspace membership", async (t) => {
  if (skip) return t.skip(skip);
  if (!(await reachable(deliveryApi))) return t.skip(`delivery-api ${deliveryApi} is not reachable.`);
  const workspaceA = await createWorkspace(userA, "Cross tenant A delivery");
  for (const kind of ["overview", "bounces", "complaints"]) {
    assertDenied(await call(deliveryApi, `/api/v1/workspaces/${workspaceA}/deliverability/${kind}`, userB), `GET /deliverability/${kind}`);
  }
});
