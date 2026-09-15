import { createServer } from "node:http";
import { config } from "../../../packages/config/src/env.js";
import { ProofStore } from "../../../packages/persistence/src/proof/proof-store.js";
import { FileDispatchQueue } from "../../../packages/queue/src/proof/file-queue.js";
import { FakeEmailProvider } from "../../../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase0Service } from "../../../packages/application/src/phase0-service.js";
import { fetchAndVerifySnsEnvelope, safelyConfirmSubscription, type SnsEnvelope } from "../../../packages/provider-email/src/ses/sns-verifier.js";
import { normalizeSesSnsEnvelope } from "../../../packages/provider-email/src/ses/normalize-feedback.js";
import { verifyUnsubscribeToken } from "../../../packages/email-renderer/src/unsubscribe-token.js";

const store = new ProofStore(config.storePath); const queue = new FileDispatchQueue(config.queuePath); const provider = new FakeEmailProvider();
const service = new Phase0Service(store, queue, provider, { publicBaseUrl: config.publicBaseUrl, unsubscribeSecret: config.unsubscribeSecret, emailSendEnabled: false });
function send(res:any,status:number,body:string,type="text/plain; charset=utf-8"){res.writeHead(status,{"content-type":type});res.end(body)}
function read(req:any):Promise<string>{return new Promise((resolve,reject)=>{let raw="";req.on("data",(c:any)=>{raw+=c;if(raw.length>1_000_000){reject(new Error("BODY_TOO_LARGE"));req.destroy();}});req.on("end",()=>resolve(raw));req.on("error",reject);});}

createServer(async (req,res)=>{
  try{
    const url=new URL(req.url??"/",`http://${req.headers.host??"localhost"}`);
    if(req.method==="GET"&&url.pathname==="/health")return send(res,200,JSON.stringify({ok:true,service:"public-api"}),"application/json");
    if(url.pathname==="/public/v1/unsubscribe"&&(req.method==="GET"||req.method==="POST")){
      let token=url.searchParams.get("token")??""; if(req.method==="POST"&&!token){const raw=await read(req);token=new URLSearchParams(raw).get("token")??"";}
      const payload=verifyUnsubscribeToken(token,config.unsubscribeSecret);service.unsubscribe(payload.workspaceId,payload.profileId,"one_click");return send(res,200,"Unsubscribed");
    }
    if(req.method==="POST"&&url.pathname==="/public/v1/provider/ses"){
      const raw=await read(req);const envelope=JSON.parse(raw) as SnsEnvelope;
      const verified=await fetchAndVerifySnsEnvelope(envelope, config.snsTopicArn);if(!verified)return send(res,401,"invalid signature");
      if(envelope.Type==="SubscriptionConfirmation"){await safelyConfirmSubscription(envelope);return send(res,200,"confirmed");}
      for(const event of normalizeSesSnsEnvelope(envelope))service.applyProviderFeedback(event);return send(res,200,"ok");
    }
    send(res,404,"not found");
  }catch(error){send(res,400,error instanceof Error?error.message:"bad request");}
}).listen(config.publicApiPort,"127.0.0.1",()=>console.log(`Phase 0 public API: http://localhost:${config.publicApiPort}`));
