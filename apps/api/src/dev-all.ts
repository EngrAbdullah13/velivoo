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

async function redisServerVersion(url: string): Promise<string | null> {
  try {
    const { default: IORedis } = await import("ioredis");
    const client = new IORedis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    await client.connect();
    const info = await client.info("server");
    await client.quit();
    return info.match(/redis_version:(\S+)/)?.[1] ?? null;
  } catch {
    return null;
  }
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
  { name: "API", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/api/src/app-server.ts"], cwd: root },
  { name: "Public feedback/unsubscribe API", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/public-api/src/real-server.ts"], cwd: root },
  // Pass the web app directory explicitly.  Calling Next's binary from the
  // repository node_modules folder while changing cwd makes Turbopack resolve
  // imports relative to the repository, not the web application.
  { name: "Web", command: process.execPath, args: [resolve("node_modules/next/dist/bin/next"), "dev", resolve("apps/web"), "-p", "3000"], cwd: root },
  { name: "Domain verification worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/worker/src/branded-domain-verification-worker.ts"], cwd: root },
];

if (config.deliveryQueueEnabled) {
  programs.push({ name: "Delivery worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/worker/src/real-phase2-main.ts"], cwd: root });
}

const redisUrl = process.env.REDIS_URL?.trim();
const REDIS_MIN_VERSION = "5.0.0";
if (redisUrl) {
  const { host, port } = parseRedisEndpoint(redisUrl);
  if (await redisReachable(redisUrl)) {
    const version = await redisServerVersion(redisUrl);
    if (version && versionAtLeast(version, REDIS_MIN_VERSION)) {
      programs.push(
        { name: "Feedback worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/worker/src/real-main.ts"], cwd: root },
        { name: "Feedback scheduler", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/scheduler/src/real-main.ts"], cwd: root },
      );
      if (config.deliveryQueueEnabled) {
        programs.push(
          { name: "Flow worker", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/worker/src/real-phase3-main.ts"], cwd: root },
          { name: "Flow scheduler", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/scheduler/src/real-phase3-main.ts"], cwd: root },
        );
      }
    } else {
      console.warn("");
      console.warn(`Redis at ${host}:${port} is version ${version ?? "unknown"}. BullMQ requires ${REDIS_MIN_VERSION}+.`);
      console.warn("Skipping feedback worker and scheduler.");
      console.warn("On Windows, replace legacy Redis 3.x with Memurai (Redis 6 compatible):");
      console.warn("  winget uninstall Redis.Redis");
      console.warn("  winget install Memurai.MemuraiDeveloper");
      console.warn("Then start the Memurai service and run npm run dev:all again.");
      console.warn("");
    }
  } else {
    console.warn("");
    console.warn(`Redis is not running at ${host}:${port}. Skipping feedback worker and scheduler.`);
    console.warn("Install Memurai (recommended on Windows, no Docker):");
    console.warn("  winget install Memurai.MemuraiDeveloper");
    console.warn("Then start Memurai and run npm run dev:all again.");
    console.warn("");
  }
}

// The production services use Redis-backed workers.  Proof/development mode
// also has a durable PostgreSQL-backed runner so Flow tests work on a normal
// local machine when Redis is intentionally not installed.
if (config.runtimeMode !== "production" && !config.deliveryQueueEnabled) {
  programs.push({ name: "Local proof automation", command: process.execPath, args: ["--env-file=.env", "--import", "tsx", "apps/worker/src/local-proof-automation.ts"], cwd: root });
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
