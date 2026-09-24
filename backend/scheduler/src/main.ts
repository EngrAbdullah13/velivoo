import { config } from "../../../packages/config/src/env.js";
import { ProofStore } from "../../../packages/persistence/src/proof/proof-store.js";
import { FileDispatchQueue } from "../../../packages/queue/src/proof/file-queue.js";
import { FakeEmailProvider } from "../../../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase0Service } from "../../../packages/application/src/phase0-service.js";
const store=new ProofStore(config.storePath);const queue=new FileDispatchQueue(config.queuePath);const service=new Phase0Service(store,queue,new FakeEmailProvider(),{publicBaseUrl:config.publicBaseUrl,unsubscribeSecret:config.unsubscribeSecret,emailSendEnabled:false});
const count=service.dispatchDueActions();console.log(JSON.stringify({dispatched:count}));if(!process.argv.includes("--once"))setInterval(()=>console.log(JSON.stringify({dispatched:service.dispatchDueActions()})),1000);
