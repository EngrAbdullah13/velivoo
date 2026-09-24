import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { phaseFor, phasePorts } from "./gateway-routing.js";

const root=dirname(fileURLToPath(import.meta.url));
const localSourceRoot=join(root,"../../../backend/api/src");
// Production runs the compiled gateway children without requiring tsx at
// runtime. Local development keeps using the TypeScript sources via tsx.
const compiled=existsSync(join(root,"platform-api.js"));
const sourceRoot=compiled?root:existsSync(join(localSourceRoot,"platform-api.ts"))?localSourceRoot:join(root,"../../../backend/api/src");
const children:ChildProcess[]=[];
function start(entry:string,env:Record<string,string>){const file=join(sourceRoot,`${entry}.${compiled?"js":"ts"}`);const args=compiled?[file]:["--import","tsx",file];const child=spawn(process.execPath,args,{env:{...process.env,...env},stdio:"inherit"});children.push(child);child.on("exit",(code,signal)=>{if(code&&code!==0)console.error(`${entry} exited with code ${code}${signal?` (${signal})`:""}`)});return child}
function cors(res:ServerResponse){res.setHeader("access-control-allow-origin",process.env.EMAIL_PLATFORM_WEB_ORIGIN??"http://localhost:3000");res.setHeader("access-control-allow-credentials","true");res.setHeader("access-control-allow-headers","authorization,content-type,x-dev-user,x-request-id,x-file-name");res.setHeader("access-control-allow-methods","GET,POST,PATCH,PUT,DELETE,OPTIONS")}
function proxy(req:IncomingMessage,res:ServerResponse,port:number){const headers={...req.headers,host:`127.0.0.1:${port}`,"x-request-id":req.headers["x-request-id"]??randomUUID()};const upstream=httpRequest({hostname:"127.0.0.1",port,path:req.url,method:req.method,headers},up=>{res.statusCode=up.statusCode??502;for(const [key,value] of Object.entries(up.headers))if(value!==undefined&&key!=="connection")res.setHeader(key,value as any);cors(res);up.pipe(res)});upstream.on("error",error=>{if(!res.headersSent){res.statusCode=502;res.setHeader("content-type","application/json; charset=utf-8");cors(res);res.end(JSON.stringify({error:{code:"API_UPSTREAM_UNAVAILABLE",message:error.message,retryable:true}}))}else res.destroy(error)});req.pipe(upstream)}

start("platform-api",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase1)});
start("delivery-api",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase2)});
start("automation-api",{EMAIL_PLATFORM_API_PORT:String(phasePorts.phase3)});
start("governance-api",{EMAIL_PLATFORM_PHASE4_API_PORT:String(phasePorts.phase4)});

function phaseName(port:number){return port===phasePorts.phase1?"phase1":port===phasePorts.phase2?"phase2":port===phasePorts.phase3?"phase3":port===phasePorts.phase4?"phase4":`port:${port}`}
function guessedHandler(path:string){return /\/deliverability\/domains\/[^/]+$/.test(path)?"deliverabilityDomainDetail":/\/deliverability\/domains\/?$/.test(path)?"deliverabilityDomains":/\/deliverability\/dashboard/.test(path)?"deliverabilityDashboard":/\/deliverability(\/|$)/.test(path)?"phase1.deliverability":/\/sender-domains\//.test(path)?"senderDomains":"gateway.phaseFor"}
const server=createServer((req,res)=>{if(req.method==="OPTIONS"){res.statusCode=204;cors(res);return res.end()}if(req.url==="/health")return proxy(req,res,phasePorts.phase1);const pathname=new URL(req.url??"/","http://localhost").pathname,port=phaseFor(pathname);if(/\/deliverability(\/|$)/.test(pathname)||req.method==="DELETE"&&/\/sender-domains\//.test(pathname))console.error(JSON.stringify({event:"route.trace",incomingPath:pathname,matchedService:phaseName(port),routeHandler:guessedHandler(pathname),method:req.method,upstreamPort:port}));return proxy(req,res,port)});
const port=Number(process.env.EMAIL_PLATFORM_API_PORT??(process.env.NODE_ENV==="production"?4100:4000));
server.on("error",(error:NodeJS.ErrnoException)=>{if(error.code==="EADDRINUSE"){console.error(`Port ${port} is already in use. Stop the existing dev server (Ctrl+C) or run: npm run dev:stop`);process.exit(1)}throw error});
server.listen(port,"127.0.0.1",()=>console.log(`Omni Present API: http://localhost:${port}`));
function shutdown(){server.close();for(const child of children)child.kill("SIGTERM")}
for(const sig of ["SIGINT","SIGTERM"] as const)process.on(sig,shutdown);
