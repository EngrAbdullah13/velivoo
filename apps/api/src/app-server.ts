import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root=dirname(fileURLToPath(import.meta.url));
const localSourceRoot=join(root,"../../../apps/api/src");
// A compiled release server also has a mirrored `dist/apps/api/src` directory.
// Check for the TypeScript entrypoint itself so the gateway does not try to run
// a non-existent `.ts` file from that compiled mirror on Windows or production.
const sourceRoot=existsSync(join(localSourceRoot,"platform-api.ts"))?localSourceRoot:join(root,"../../../../apps/api/src");
const phasePorts={phase1:4101,phase2:4102,phase3:4103,phase4:4104} as const;
const children:ChildProcess[]=[];
function start(entry:string,env:Record<string,string>){const child=spawn(process.execPath,["--import","tsx",join(sourceRoot,entry)],{env:{...process.env,...env},stdio:"inherit"});children.push(child);child.on("exit",(code,signal)=>{if(code&&code!==0)console.error(`${entry} exited with code ${code}${signal?` (${signal})`:""}`)});return child}
function phaseFor(path:string){
 if(path.includes("/phase4/"))return phasePorts.phase4;
 if(/\/(segments|flows|events|event-schemas|api-keys|dead-letters|flow-runs)(\/|$)/.test(path))return phasePorts.phase3;
 // The analytics console is composed by the Phase 1 API.  Route these
 // specific dashboard/export endpoints before the Phase 2 analytics summary
 // endpoint below; otherwise the dashboard receives a misleading 404.
 if(/\/analytics\/(dashboard|export)(\/|$)/.test(path))return phasePorts.phase1;
 // The complete Deliverability dashboard, domain setup, holds, and warming
 // endpoints are composed by the Phase 1 API. Route this module before the
 // generic Phase 2 content/delivery boundary.
 if(/\/deliverability(\/|$)/.test(path))return phasePorts.phase1;
 // Flow subresources such as `/flows/:id/messages` and `/flows/:id/analytics`
 // belong to Phase 3. Check their parent route before generic Phase 2 terms.
 if(/\/(content|emails|email-versions|messages|send-policy|holds|analytics)(\/|$)/.test(path))return phasePorts.phase2;
 if(/^\/api\/v1\/public\/content-assets\//.test(path))return phasePorts.phase2;
 return phasePorts.phase1;
}
function cors(res:ServerResponse){res.setHeader("access-control-allow-origin",process.env.EMAIL_PLATFORM_WEB_ORIGIN??"http://localhost:3000");res.setHeader("access-control-allow-credentials","true");res.setHeader("access-control-allow-headers","authorization,content-type,x-dev-user,x-request-id,x-file-name");res.setHeader("access-control-allow-methods","GET,POST,PATCH,PUT,DELETE,OPTIONS")}
function proxy(req:IncomingMessage,res:ServerResponse,port:number){const headers={...req.headers,host:`127.0.0.1:${port}`,"x-request-id":req.headers["x-request-id"]??randomUUID()};const upstream=httpRequest({hostname:"127.0.0.1",port,path:req.url,method:req.method,headers},up=>{res.statusCode=up.statusCode??502;for(const [key,value] of Object.entries(up.headers))if(value!==undefined&&key!=="connection")res.setHeader(key,value as any);cors(res);up.pipe(res)});upstream.on("error",error=>{if(!res.headersSent){res.statusCode=502;res.setHeader("content-type","application/json; charset=utf-8");cors(res);res.end(JSON.stringify({error:{code:"API_UPSTREAM_UNAVAILABLE",message:error.message,retryable:true}}))}else res.destroy(error)});req.pipe(upstream)}

start("platform-api.ts",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase1)});
start("delivery-api.ts",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase2)});
start("automation-api.ts",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase3)});
start("governance-api.ts",{EMAIL_PLATFORM_PHASE4_API_PORT:String(phasePorts.phase4)});

function phaseName(port:number){return port===phasePorts.phase1?"phase1":port===phasePorts.phase2?"phase2":port===phasePorts.phase3?"phase3":port===phasePorts.phase4?"phase4":`port:${port}`}
function guessedHandler(path:string){return /\/deliverability\/domains\/[^/]+$/.test(path)?"deliverabilityDomainDetail":/\/deliverability\/domains\/?$/.test(path)?"deliverabilityDomains":/\/deliverability\/dashboard/.test(path)?"deliverabilityDashboard":/\/deliverability(\/|$)/.test(path)?"phase1.deliverability":/\/sender-domains\//.test(path)?"senderDomains":"gateway.phaseFor"}
const server=createServer((req,res)=>{if(req.method==="OPTIONS"){res.statusCode=204;cors(res);return res.end()}if(req.url==="/health")return proxy(req,res,phasePorts.phase1);const pathname=new URL(req.url??"/","http://localhost").pathname,port=phaseFor(pathname);if(/\/deliverability(\/|$)/.test(pathname)||req.method==="DELETE"&&/\/sender-domains\//.test(pathname))console.error(JSON.stringify({event:"route.trace",incomingPath:pathname,matchedService:phaseName(port),routeHandler:guessedHandler(pathname),method:req.method,upstreamPort:port}));return proxy(req,res,port)});
const port=Number(process.env.EMAIL_PLATFORM_API_PORT??4000);
server.on("error",(error:NodeJS.ErrnoException)=>{if(error.code==="EADDRINUSE"){console.error(`Port ${port} is already in use. Stop the existing dev server (Ctrl+C) or run: npm run dev:stop`);process.exit(1)}throw error});
server.listen(port,"127.0.0.1",()=>console.log(`Omni Present API: http://localhost:${port}`));
function shutdown(){server.close();for(const child of children)child.kill("SIGTERM")}
for(const sig of ["SIGINT","SIGTERM"] as const)process.on(sig,shutdown);
