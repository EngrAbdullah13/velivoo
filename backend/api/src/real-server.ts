import { createServer } from "node:http";
import { config } from "../../../packages/config/src/env.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";

function json(res: any, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function idFromPath(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const id = decodeURIComponent(path.slice(prefix.length));
  return id && !id.includes("/") ? id : null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      await prisma.$queryRaw`SELECT 1`;
      return json(res, 200, { ok: true, service: "api", runtime: "real-phase0" });
    }

    if (req.method === "GET" && url.pathname === "/dev/phase0/real/gate-evidence") {
      const evidence = await prisma.phase0GateEvidence.findMany({ orderBy: { checkKey: "asc" } });
      return json(res, 200, { evidence });
    }

    const workspaceId = url.searchParams.get("workspaceId") ?? "";
    if (!workspaceId) return json(res, 400, { error: "workspaceId is required" });

    const flowRunId = idFromPath(url.pathname, "/dev/phase0/real/flow-runs/");
    if (req.method === "GET" && flowRunId) {
      const run = await prisma.flowRun.findFirst({ where: { id: flowRunId, workspaceId } });
      if (!run) return json(res, 404, { error: "not found" });
      const [trace, messages, nodeExecutions] = await Promise.all([
        prisma.traceEvent.findMany({ where: { workspaceId, aggregateId: run.id }, orderBy: { occurredAt: "asc" } }),
        prisma.message.findMany({ where: { workspaceId, flowRunId: run.id }, orderBy: { createdAt: "asc" } }),
        prisma.flowNodeExecution.findMany({ where: { workspaceId, flowRunId: run.id }, orderBy: { attemptSequence: "asc" } }),
      ]);
      return json(res, 200, { run, nodeExecutions, messages, trace });
    }

    const messageId = idFromPath(url.pathname, "/dev/phase0/real/messages/");
    if (req.method === "GET" && messageId) {
      const message = await prisma.message.findFirst({ where: { id: messageId, workspaceId } });
      if (!message) return json(res, 404, { error: "not found" });
      const [attempts, events, trace] = await Promise.all([
        prisma.deliveryAttempt.findMany({ where: { workspaceId, messageId: message.id }, orderBy: { attemptNumber: "asc" } }),
        prisma.deliveryEvent.findMany({ where: { workspaceId, messageId: message.id }, orderBy: { occurredAt: "asc" } }),
        prisma.traceEvent.findMany({ where: { workspaceId, aggregateId: message.id }, orderBy: { occurredAt: "asc" } }),
      ]);
      return json(res, 200, { message, attempts, events, trace });
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "internal error" });
  }
}).listen(config.apiPort, "127.0.0.1", () => {
  console.log(`Phase 0 real trace API: http://localhost:${config.apiPort}`);
});
