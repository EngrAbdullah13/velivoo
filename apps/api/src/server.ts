import { createServer } from "node:http";
import { config } from "../../../packages/config/src/env.js";
import { ProofStore } from "../../../packages/persistence/src/proof/proof-store.js";
import { FileDispatchQueue } from "../../../packages/queue/src/proof/file-queue.js";
import { FakeEmailProvider } from "../../../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase0Service } from "../../../packages/application/src/phase0-service.js";

const store = new ProofStore(config.storePath);
const queue = new FileDispatchQueue(config.queuePath);
const provider = new FakeEmailProvider();
const service = new Phase0Service(store, queue, provider, { publicBaseUrl: config.publicBaseUrl, unsubscribeSecret: config.unsubscribeSecret, emailSendEnabled: false });

function json(res: any, status: number, body: unknown) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function body(req: any): Promise<any> { return new Promise((resolve, reject) => { let raw=""; req.on("data",(c:any)=>{raw+=c;if(raw.length>1_000_000){reject(new Error("BODY_TOO_LARGE"));req.destroy();}}); req.on("end",()=>resolve(raw?JSON.parse(raw):{})); req.on("error",reject); }); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "api" });
    if (req.method === "POST" && url.pathname === "/dev/phase0/bootstrap") return json(res, 200, service.bootstrap());
    if (req.method === "POST" && url.pathname === "/dev/phase0/flows/start") { const b = await body(req); return json(res, 200, service.startFlow(b)); }
    if (req.method === "GET" && url.pathname.startsWith("/dev/phase0/flow-runs/")) { const id=url.pathname.split("/").pop()!; const ws=url.searchParams.get("workspaceId"); if(!ws) return json(res,400,{error:"workspaceId required"}); return json(res,200,{run:store.getFlowRun(ws,id),trace:store.traceFor(ws,id)}); }
    if (req.method === "GET" && url.pathname.startsWith("/dev/phase0/messages/")) { const id=url.pathname.split("/").pop()!; const ws=url.searchParams.get("workspaceId"); if(!ws) return json(res,400,{error:"workspaceId required"}); return json(res,200,{message:store.getMessage(ws,id),trace:store.traceFor(ws,id),attempts:store.attemptsForMessage(ws,id)}); }
    if (req.method === "POST" && url.pathname === "/dev/phase0/reset") { store.reset(); queue.clear(); return json(res,200,{ok:true}); }
    json(res,404,{error:"not_found"});
  } catch (error) { json(res,500,{error:error instanceof Error?error.message:"internal_error"}); }
}).listen(config.apiPort, "127.0.0.1", () => console.log(`Phase 0 API: http://localhost:${config.apiPort}`));
