import { execSync } from "node:child_process";

const ports = [3000, 4000, 4001, 4101, 4102, 4103, 4104];
const killed = new Set<number>();

for (const port of ports) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const pid = Number(line.trim().split(/\s+/).at(-1));
        if (!pid || killed.has(pid)) continue;
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        killed.add(pid);
        console.log(`Stopped process ${pid} on port ${port}`);
      }
      continue;
    }
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    for (const pidText of output.split(/\s+/)) {
      const pid = Number(pidText);
      if (!pid || killed.has(pid)) continue;
      process.kill(pid, "SIGTERM");
      killed.add(pid);
      console.log(`Stopped process ${pid} on port ${port}`);
    }
  } catch {
    // No listener on this port.
  }
}

if (!killed.size) console.log("No dev server processes were listening on ports 3000, 4000, 4001, or 4101-4104.");
