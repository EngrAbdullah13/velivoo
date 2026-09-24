import { existsSync } from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webPort = Number(process.env.PORT);
const internalApiPort = 4100;
const apiEntry = join(root, "dist", "apps", "api", "src", "app-server.js");
const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");

if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  throw new Error("Heroku must provide a valid PORT for the web server.");
}
if (webPort === internalApiPort) {
  throw new Error("PORT conflicts with EMAIL_PLATFORM_INTERNAL_API_PORT; configure a different internal API port.");
}
if (!existsSync(apiEntry) || !existsSync(nextCli)) {
  throw new Error("Production build is incomplete. Run the Heroku build so the API and Next.js app are compiled.");
}

async function findAvailablePort(startAt, reserved) {
  for (let port = startAt; port < startAt + 200; port += 1) {
    if (reserved.has(port)) continue;
    const available = await new Promise(resolvePort => {
      const server = net.createServer();
      server.once("error", () => resolvePort(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
    });
    if (available) return port;
  }
  throw new Error("Could not allocate a private port for an API service.");
}

const reserved = new Set([webPort, internalApiPort]);
const phasePorts = [];
for (let index = 0; index < 4; index += 1) {
  const port = await findAvailablePort(4110 + index, reserved);
  reserved.add(port);
  phasePorts.push(port);
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  EMAIL_PLATFORM_API_PORT: String(internalApiPort),
  EMAIL_PLATFORM_INTERNAL_API_URL: `http://127.0.0.1:${internalApiPort}`,
  EMAIL_PLATFORM_PHASE1_API_PORT: String(phasePorts[0]),
  EMAIL_PLATFORM_PHASE2_API_PORT: String(phasePorts[1]),
  EMAIL_PLATFORM_PHASE3_API_PORT: String(phasePorts[2]),
  EMAIL_PLATFORM_PHASE4_API_PORT: String(phasePorts[3]),
};
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const forceExit = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 8000);
  forceExit.unref();
  Promise.all(children.map(child => new Promise(resolveExit => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    child.once("exit", resolveExit);
  }))).then(() => process.exit(code));
}

function launch(name, command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.once("error", error => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} exited unexpectedly (${signal ?? code ?? "unknown"}).`);
      stop(code && code !== 0 ? code : 1);
    }
  });
  return child;
}

launch("API gateway", process.execPath, [apiEntry]);
launch("Next.js", process.execPath, [nextCli, "start", join(root, "apps", "web"), "--hostname", "0.0.0.0", "--port", String(webPort)]);

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop(0));
