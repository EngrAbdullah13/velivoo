import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";
import { loadEmailPlatformConfig } from "../../../packages/config/src/env.js";

const DEV_PORTS = [
  { port: 4000, label: "API gateway" },
  { port: 4001, label: "Public feedback/unsubscribe API" },
  { port: 3000, label: "Next.js web" },
  { port: 4101, label: "Phase 1 API" },
  { port: 4102, label: "Phase 2 API" },
  { port: 4103, label: "Phase 3 API" },
  { port: 4104, label: "Phase 4 API" },
] as const;

function portInUse(port: number, host = "127.0.0.1") {
  return new Promise<boolean>((resolvePort) => {
    const probe = net.createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolvePort(error.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => resolvePort(false)));
    probe.listen(port, host);
  });
}

function parseRedisEndpoint(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url.includes("://") ? url : `redis://${url}`);
    return { host: parsed.hostname || "127.0.0.1", port: parsed.port ? Number(parsed.port) : 6379 };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

function redisReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  const { host, port } = parseRedisEndpoint(url);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (value: string) => value.split(".").map((part) => Number(part) || 0);
  const current = parts(version);
  const required = parts(minimum);
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const left = current[index] ?? 0;
    const right = required[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

async function withRedisClient<T>(url: string, run: (client: import("ioredis").Redis) => Promise<T>): Promise<T | null> {
  try {
    const { Redis } = await import("ioredis");
    const client = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    // Connection failures are handled by this function's null result. Without
    // an error listener ioredis also writes an unhandled-error stack for an
    // expected local-development Redis outage.
    client.on("error", () => undefined);
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.quit();
    }
  } catch {
    return null;
  }
}

async function redisServerVersion(url: string): Promise<string | null> {
  return withRedisClient(url, async (client) => {
    const info = await client.info("server");
    return info.match(/redis_version:(\S+)/)?.[1] ?? null;
  });
}

async function redisWriteHealthy(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const probeKey = `velivoo:dev-all:write-probe:${process.pid}`;
  const result = await withRedisClient(url, async (client) => {
    await client.set(probeKey, "1", "EX", 30);
    await client.del(probeKey);
    return true as const;
  });
  if (result) return { ok: true };
  return {
    ok: false,
    reason:
      "Redis accepts connections but rejected writes (often MISCONF / RDB snapshot failure on Windows). Queue workers cannot run until writes succeed.",
  };
}

async function assertDevPortsAvailable() {
  const blocked = [];
  for (const entry of DEV_PORTS) {
    if (await portInUse(entry.port)) blocked.push(entry);
  }
  if (!blocked.length) return;
  console.error("Cannot start dev stack because these ports are already in use:");
  for (const entry of blocked) console.error(`  ${entry.port} (${entry.label})`);
  console.error("");
  console.error("Stop the existing server with Ctrl+C in its terminal, or run:");
  console.error("  npm run dev:stop");
  process.exit(1);
}

const config = loadEmailPlatformConfig();
const root = process.cwd();
const programs: Array<{ name: string; command: string; args: string[]; cwd: string }> = [
  { name: "API", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/api/src/app-server.ts"], cwd: root },
  { name: "Public feedback/unsubscribe API", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/public-api/src/real-server.ts"], cwd: root },
  // Pass the web app directory explicitly.  Calling Next's binary from the
  // repository node_modules folder while changing cwd makes Turbopack resolve
  // imports relative to the repository, not the web application.
  { name: "Web", command: process.execPath, args: [resolve("node_modules/next/dist/bin/next"), "dev", resolve("frontend"), "-p", "3000"], cwd: root },
  { name: "Domain verification worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/worker/src/branded-domain-verification-worker.ts"], cwd: root },
];

const redisUrl = process.env.REDIS_URL?.trim();
const REDIS_MIN_VERSION = "5.0.0";
let queueAutomationStarted = false;

if (redisUrl) {
  const { host, port } = parseRedisEndpoint(redisUrl);
  if (await redisReachable(redisUrl)) {
    const version = await redisServerVersion(redisUrl);
    if (version && versionAtLeast(version, REDIS_MIN_VERSION)) {
      const writeHealth = await redisWriteHealthy(redisUrl);
      if (!writeHealth.ok) {
        console.warn("");
        console.warn(`Redis at ${host}:${port} is reachable but not writable.`);
        console.warn(writeHealth.reason);
        console.warn("Fix Redis, or set EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED=false and restart to use local proof automation.");
        console.warn("Quick Redis fix (run in a separate terminal):");
        console.warn("  redis-cli CONFIG SET stop-writes-on-bgsave-error no");
        console.warn("Or install Memurai (recommended on Windows): winget install Memurai.MemuraiDeveloper");
        console.warn("");
      } else {
        programs.push(
          { name: "Feedback worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/worker/src/real-main.ts"], cwd: root },
          { name: "Feedback scheduler", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/scheduler/src/real-main.ts"], cwd: root },
        );
        if (config.deliveryQueueEnabled) {
          programs.push(
            { name: "Delivery worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/worker/src/real-phase2-main.ts"], cwd: root },
            { name: "Flow worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/worker/src/real-phase3-main.ts"], cwd: root },
            { name: "Flow scheduler", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/scheduler/src/real-phase3-main.ts"], cwd: root },
          );
          queueAutomationStarted = true;
        }
      }
    } else {
      console.warn("");
      console.warn(`Redis at ${host}:${port} is version ${version ?? "unknown"}. BullMQ requires ${REDIS_MIN_VERSION}+.`);
      console.warn("Queue workers will not start; falling back to local proof automation when allowed.");
      console.warn("On Windows, replace legacy Redis 3.x with Memurai (Redis 6 compatible):");
      console.warn("  winget uninstall Redis.Redis");
      console.warn("  winget install Memurai.MemuraiDeveloper");
      console.warn("Then start the Memurai service and run npm run dev:all again.");
      console.warn("");
    }
  } else {
    console.warn("");
    console.warn(`Redis is not running at ${host}:${port}. Queue workers will not start.`);
    console.warn("Install Memurai (recommended on Windows, no Docker):");
    console.warn("  winget install Memurai.MemuraiDeveloper");
    console.warn("Then start Memurai and run npm run dev:all again.");
    console.warn("");
  }
}

// Proof/development mode keeps a PostgreSQL-backed runner so list-triggered flows
// and message policy still progress when Redis is missing or queue mode is off.
if (config.runtimeMode !== "production" && !queueAutomationStarted) {
  programs.push({ name: "Local proof automation", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "backend/worker/src/local-proof-automation.ts"], cwd: root });
}

if (config.runtimeMode === "production") {
  console.warn("");
  console.warn("EMAIL_PLATFORM_RUNTIME_MODE=production disables local proof automation.");
  console.warn("List-triggered flows require Redis-backed workers. Ensure Redis 5+ is running and EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED=true.");
  console.warn("");
}

await assertDevPortsAvailable();

const children: ChildProcess[] = programs.map(({ name, command, args, cwd }) => {
  // Keep the Node executable path intact on Windows (it commonly lives under
  // Program Files).  Routing it through cmd.exe splits that path and prevents
  // the dev stack from starting.
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("error", (error) => console.error(`${name} could not start: ${error.message}`));
  child.on("exit", (code, signal) => console.log(`${name} stopped (${signal ?? code ?? "unknown"}).`));
  return child;
});

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
