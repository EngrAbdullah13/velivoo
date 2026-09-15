import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JobEnvelope } from "../../../contracts/src/types.js";

export class FileDispatchQueue {
  constructor(public readonly filePath: string) { mkdirSync(dirname(filePath), { recursive: true }); if (!existsSync(filePath)) writeFileSync(filePath, ""); }
  enqueue(job: JobEnvelope): void { appendFileSync(this.filePath, JSON.stringify(job) + "\n"); }
  drain(): JobEnvelope[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8"); writeFileSync(this.filePath, "");
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JobEnvelope);
  }
  clear(): void { writeFileSync(this.filePath, ""); }
  count(): number { if (!existsSync(this.filePath)) return 0; return readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean).length; }
}
