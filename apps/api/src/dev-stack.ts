import { execSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const PUBLIC_API_PORT = Number(process.env.EMAIL_PLATFORM_PUBLIC_API_PORT ?? 4001);
const REDIS_PORT = 6379;

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function portReachable(port: number, host = "127.0.0.1", timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function findRedisServer(): string {
  const configured = process.env.REDIS_SERVER_PATH?.trim();
  if (configured) return configured;
  try {
    if (process.platform === "win32") {
      const output = execSync("where redis-server", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const first = output.split(/\r?\n/).find(Boolean);
      if (first) return first;
    } else {
      const output = execSync("command -v redis-server", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (output) return output;
    }
  } catch {
    // Ignore and fall back below.
  }
  return "redis-server";
}

async function ensureRedis(): Promise<boolean> {
  if (await portReachable(REDIS_PORT)) {
    console.log(`Redis already running on 127.0.0.1:${REDIS_PORT}`);
    return true;
  }
  const redisServer = findRedisServer();
  console.log(`Starting Redis (${redisServer})...`);
  let launchErrorMessage = "";
  try {
    const child = spawn(redisServer, [], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => { launchErrorMessage = error.message; });
    child.unref();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown Windows process error";
    console.warn(`Redis could not start: ${reason}`);
    console.warn("The web/API stack will continue, but queue workers require a permitted Redis 5+ service on localhost:6379.");
    return false;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (launchErrorMessage) {
      console.warn(`Redis could not start: ${launchErrorMessage}`);
      console.warn("The web/API stack will continue, but queue workers require a permitted Redis 5+ service on localhost:6379.");
      return false;
    }
    if (await portReachable(REDIS_PORT)) {
      console.log(`Redis ready on 127.0.0.1:${REDIS_PORT}`);
      return true;
    }
    await sleep(250);
  }
  console.warn(`Redis did not start on 127.0.0.1:${REDIS_PORT}. Set REDIS_SERVER_PATH or start a permitted Redis service manually.`);
  return false;
}

async function ngrokForwardingToPublicApi(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { tunnels?: Array<{ config?: { addr?: string } }> };
    return Boolean(
      payload.tunnels?.some((tunnel) => {
        const addr = tunnel.config?.addr ?? "";
        return addr.includes(String(PUBLIC_API_PORT)) || addr.includes(`localhost:${PUBLIC_API_PORT}`);
      }),
    );
  } catch {
    return false;
  }
}

async function ensureNgrok() {
  if (await ngrokForwardingToPublicApi()) {
    console.log(`ngrok already forwarding to localhost:${PUBLIC_API_PORT}`);
    return;
  }
  console.log(`Starting ngrok http ${PUBLIC_API_PORT}...`);
  try {
    const child = spawn("ngrok", ["http", String(PUBLIC_API_PORT)], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown Windows process error";
    console.warn(`ngrok could not start: ${reason}`);
    return;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await ngrokForwardingToPublicApi()) {
      console.log(`ngrok ready for public API on port ${PUBLIC_API_PORT}`);
      console.log("Check the public URL at http://127.0.0.1:4040");
      return;
    }
    await sleep(500);
  }
  console.warn("ngrok did not confirm a tunnel to the public API. Start it manually: ngrok http 4001");
}

const redisReady = await ensureRedis();
await ensureNgrok();

if (!redisReady) {
  console.warn("Queue workers will remain unavailable until Redis is running. The local web/API services will still start.");
}

console.log("");
console.log("Starting application stack (npm run dev:all)...");
console.log("");

const child: ChildProcess = spawn(
  process.execPath,
  ["--env-file=.env", "--import", "tsx", "apps/api/src/dev-all.ts"],
  {
    cwd: root,
    env: redisReady ? process.env : {
      ...process.env,
      REDIS_URL: "",
      EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED: "false",
      EMAIL_PLATFORM_PHASE3_QUEUE_ENABLED: "false",
      EMAIL_PLATFORM_IMPORT_QUEUE_ENABLED: "false",
    },
    stdio: "inherit",
    windowsHide: false,
  },
);

child.on("error", (error) => {
  console.error(`dev:all could not start: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
