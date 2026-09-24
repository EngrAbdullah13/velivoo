import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { config } from "../../../packages/config/src/env.js";
import { prisma } from "../../../packages/persistence/src/prisma/phase0-client.js";
import { fetchAndVerifySnsEnvelope, safelyConfirmSubscription, type SnsEnvelope } from "../../../packages/provider-email/src/ses/sns-verifier.js";
import { normalizeSesSnsEnvelope } from "../../../packages/provider-email/src/ses/normalize-feedback.js";
import { enqueueFeedbackInbox, phase0ProducerQueue } from "../../../packages/queue/src/bullmq/phase0-runtime.js";
import { applyOneClickUnsubscribe } from "./real-unsubscribe-handler.js";
import { isUnsubscribePath, readUnsubscribeToken, renderUnsubscribeConfirmPage, renderUnsubscribeErrorPage, renderUnsubscribeSuccessPage } from "./unsubscribe-page.js";
import { verifyTrackingToken, classifyClick, assertSafeTrackingDestination } from "../../../packages/domain/src/phase2/tracking.js";
import { PrismaPhase3Repository } from "../../../packages/persistence/src/prisma/phase3-repository.js";
import { Phase3Service } from "../../../packages/application/src/phase3/phase3-service.js";
import { Phase3ApiKeyService } from "../../../packages/application/src/phase3/api-key-service.js";

if (!config.snsTopicArn) console.warn("EMAIL_PLATFORM_SNS_TOPIC_ARN is not set; real SES callback route will reject requests until it is configured.");
const phase3Repo=new PrismaPhase3Repository(prisma);
const phase3=new Phase3Service(phase3Repo);
const phase3Keys=new Phase3ApiKeyService(phase3Repo,process.env.EMAIL_PLATFORM_API_KEY_PEPPER??"change-this-local-api-key-pepper-1234567890");

function send(res: any, status: number, body: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}
function read(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: any) => {
      raw += chunk;
      if (raw.length > 1_000_000) { reject(new Error("BODY_TOO_LARGE")); req.destroy(); }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}
function p2002(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as any).code === "P2002";
}
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

async function findMessageForFeedback(event: ReturnType<typeof normalizeSesSnsEnvelope>[number]) {
  const attempt = await prisma.deliveryAttempt.findFirst({ where: { provider: "ses", providerMessageId: event.providerMessageId } });
  if (!attempt) return null;
  const message = await prisma.message.findUnique({ where: { id: attempt.messageId } });
  if (!message || message.workspaceId !== attempt.workspaceId) throw new Error("FEEDBACK_AUTHORITY_MISMATCH");
  if (attempt.routeId) {
    const route = await prisma.emailDeliveryRoute.findUnique({ where: { id: attempt.routeId } });
    if (!route || route.workspaceId !== attempt.workspaceId || route.id !== attempt.routeId) throw new Error("FEEDBACK_ROUTE_AUTHORITY_MISMATCH");
  }
  // SES tags remain useful diagnostics, but never select or authorize a tenant.
  return message;
}

async function receiveFeedback(event: ReturnType<typeof normalizeSesSnsEnvelope>[number]): Promise<"queued" | "deferred" | "duplicate" | "unmatched"> {
  const receivedAt = new Date();
  const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  // Persist the verified provider envelope before correlation. This is the
  // acknowledgement boundary even when an authoritative route/workspace chain
  // is missing or inconsistent.
  let inbox = await prisma.inboxMessage.findUnique({
    where: { source_externalId: { source: "ses", externalId: event.providerEventId } },
  });
  if (inbox?.status === "processed") return "duplicate";
  if (!inbox) {
    try {
      inbox = await prisma.inboxMessage.create({ data: {
        id: randomUUID(), source: "ses", workspaceId: null,
        externalId: event.providerEventId, payloadHash,
        payloadJson: { messageId: null, event } as any,
        status: "received", receivedAt,
      }});
    } catch (error) {
      if (!p2002(error)) throw error;
      inbox = await prisma.inboxMessage.findUnique({
        where: { source_externalId: { source: "ses", externalId: event.providerEventId } },
      });
      if (inbox?.status === "processed") return "duplicate";
    }
  }
  if (!inbox) throw new Error("FEEDBACK_INBOX_RECEIPT_FAILED");

  let message;
  try {
    message = await findMessageForFeedback(event);
  } catch (error) {
    const errorCode=error instanceof Error?error.message:"FEEDBACK_AUTHORITY_MISMATCH";
    await prisma.inboxMessage.update({where:{id:inbox.id},data:{status:"rejected",errorCode}});
    return "unmatched";
  }
  if (!message) {
    await prisma.inboxMessage.update({where:{id:inbox.id},data:{status:"unmatched",errorCode:"PROVIDER_MESSAGE_NOT_CORRELATED"}});
    return "unmatched";
  }
  inbox=await prisma.inboxMessage.update({where:{id:inbox.id},data:{workspaceId:message.workspaceId,payloadJson:{messageId:message.id,event} as any,status:"received",errorCode:null}});

  // Durable receipt is the acknowledgement boundary. Redis is only dispatch;
  // if enqueue fails, the scheduler/reconciler can rebuild it from this row.
  if (!config.redisUrl) return "deferred";
  const producer = phase0ProducerQueue(config.redisUrl);
  try {
    await enqueueFeedbackInbox(producer.queue, {
      workspaceId: message.workspaceId,
      inboxId: inbox.id,
      correlationId: message.id,
    });
    return "queued";
  } catch (error) {
    console.error("feedback enqueue deferred", error);
    return "deferred";
  } finally {
    await producer.queue.close().catch(() => undefined);
    await producer.connection.quit().catch(() => undefined);
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health/tracking") return send(res, 200, "tracking ready");
    if (req.method === "GET" && url.pathname === "/health/unsubscribe") {
      let publicUrl: URL | null = null;
      try { publicUrl = new URL(config.publicBaseUrl); } catch { /* Report an unavailable capability below. */ }
      const configuredSecret=process.env.EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET??"";
      const secretReady = Buffer.byteLength(configuredSecret) >= 32;
      const publicHttps = publicUrl?.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname.toLowerCase());
      if (!secretReady || !publicHttps) return send(res, 503, "unsubscribe not publicly ready");
      return send(res, 200, "unsubscribe ready");
    }
    if (req.method === "GET" && url.pathname === "/health") {
      await prisma.$queryRaw`SELECT 1`;
      return send(res, 200, JSON.stringify({ ok: true, service: "public-api", runtime: "real" }), "application/json; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/public/v1/events/batch") {
      const auth=String(req.headers.authorization??"");if(!auth.startsWith("Bearer "))return send(res,401,"API key required");
      const principal=await phase3Keys.authenticate(auth.slice(7),"events.write");
      const raw=await read(req);const parsed=JSON.parse(raw||"{}");const items=Array.isArray(parsed.events)?parsed.events:[];if(items.length<1||items.length>100)return send(res,400,"events must contain 1-100 items");
      const results=[] as any[];
      for(const item of items){try{let profileId=String(item.profileId??"");if(!profileId&&item.profile?.email){const email=String(item.profile.email).trim(),at=email.lastIndexOf("@");if(at>0){const normalized=email.slice(0,at)+"@"+email.slice(at+1).toLowerCase();const p=await prisma.profile.findFirst({where:{workspaceId:principal.workspaceId,normalizedEmail:normalized,deletedAt:null},select:{id:true}});profileId=p?.id??""}}if(!profileId)throw new Error("PROFILE_NOT_FOUND");
        const input={eventId:String(item.eventId??""),name:String(item.name??""),occurredAt:String(item.occurredAt??""),profileId,source:`api:${principal.credentialId}`,schemaVersion:Number(item.schemaVersion??1),properties:item.properties&&typeof item.properties==="object"?item.properties:{},idempotencyKey:String(item.idempotencyKey??item.eventId??"")};const out=await phase3.ingestEvent(principal.workspaceId,input);results.push({eventId:input.eventId,status:out.duplicate?"duplicate":"accepted",storedEventId:out.event.id});
      }catch(e){results.push({eventId:String(item?.eventId??""),status:"rejected",error:e instanceof Error?e.message:"EVENT_REJECTED"})}}
      return send(res,202,JSON.stringify({results}),"application/json; charset=utf-8");
    }
    if (isUnsubscribePath(url.pathname)) {
      const token = await readUnsubscribeToken(req, url, () => read(req));
      if (!token) return send(res, 400, renderUnsubscribeErrorPage(), "text/html; charset=utf-8");
      if (req.method === "GET") return send(res, 200, renderUnsubscribeConfirmPage(token), "text/html; charset=utf-8");
      if (req.method === "POST") {
        try {
          const result = await applyOneClickUnsubscribe(token, "ONE_CLICK");
          const accept = String(req.headers.accept ?? "");
          if (accept.includes("text/html")) return send(res, 200, renderUnsubscribeSuccessPage(result.brandName), "text/html; charset=utf-8");
          return send(res, 200, "Unsubscribed");
        } catch {
          return send(res, 400, renderUnsubscribeErrorPage(), "text/html; charset=utf-8");
        }
      }
      return send(res, 405, "Method not allowed");
    }
    if (req.method === "GET" && url.pathname.startsWith("/t/c/")) {
      const token=url.pathname.slice("/t/c/".length);
      const secret=process.env.EMAIL_PLATFORM_TRACKING_SIGNING_SECRET??""; if(Buffer.byteLength(secret)<32)return send(res,503,"tracking not configured");
      const payload=verifyTrackingToken(token,secret); if(payload.purpose!=="click"||!payload.trackingLinkId)return send(res,400,"invalid tracking token");
      const link=await prisma.trackingLink.findFirst({where:{id:payload.trackingLinkId,messageId:payload.messageId}}); if(!link)return send(res,404,"not found");
      const destination=assertSafeTrackingDestination(link.destination); const message=await prisma.message.findUnique({where:{id:payload.messageId}}); if(!message)return send(res,404,"not found");
      const classification=classifyClick(String(req.headers["user-agent"]??""));
      await prisma.traceEvent.create({data:{workspaceId:message.workspaceId,aggregateType:"message",aggregateId:message.id,kind:"engagement.click",detailJson:{classification,trackingLinkId:link.id},occurredAt:new Date()}});
      res.writeHead(302,{location:destination,"cache-control":"no-store","referrer-policy":"no-referrer"}); return res.end();
    }
    if (req.method === "POST" && url.pathname === "/public/v1/provider/ses") {
      if (!config.snsTopicArn) return send(res, 503, "SNS topic not configured");
      const raw = await read(req);
      const envelope = JSON.parse(raw) as SnsEnvelope;
      const verified = await fetchAndVerifySnsEnvelope(envelope, config.snsTopicArn);
      if (!verified) return send(res, 401, "invalid signature");
      await prisma.phase0GateEvidence.upsert({
        where: { checkKey: "real.sns.signature" },
        create: { checkKey: "real.sns.signature", status: "passed", evidenceJson: { topicArn: envelope.TopicArn, messageId: envelope.MessageId, type: envelope.Type } },
        update: { status: "passed", evidenceJson: { topicArn: envelope.TopicArn, messageId: envelope.MessageId, type: envelope.Type }, checkedAt: new Date() },
      });
      if (envelope.Type === "SubscriptionConfirmation") {
        const payloadHash=createHash("sha256").update(raw).digest("hex");
        await prisma.inboxMessage.upsert({
          where:{source_externalId:{source:"sns-control",externalId:envelope.MessageId}},
          create:{id:randomUUID(),source:"sns-control",workspaceId:null,externalId:envelope.MessageId,payloadHash,payloadJson:envelope as any,status:"received",receivedAt:new Date()},
          update:{payloadHash,payloadJson:envelope as any,status:"received",errorCode:null},
        });
        await safelyConfirmSubscription(envelope);
        await prisma.inboxMessage.update({where:{source_externalId:{source:"sns-control",externalId:envelope.MessageId}},data:{status:"processed",processedAt:new Date()}});
        await prisma.phase0GateEvidence.upsert({
          where: { checkKey: "real.sns.subscription" },
          create: { checkKey: "real.sns.subscription", status: "passed", evidenceJson: { topicArn: envelope.TopicArn, messageId: envelope.MessageId } },
          update: { status: "passed", evidenceJson: { topicArn: envelope.TopicArn, messageId: envelope.MessageId }, checkedAt: new Date() },
        });
        return send(res, 200, "confirmed");
      }
      const outcomes: string[] = [];
      for (const event of normalizeSesSnsEnvelope(envelope)) outcomes.push(await receiveFeedback(event));
      return send(res, 200, JSON.stringify({ ok: true, outcomes }), "application/json; charset=utf-8");
    }
    return send(res, 404, "not found");
  } catch (error) {
    console.error(error);
    return send(res, 400, error instanceof Error ? error.message : "bad request");
  }
}).listen(config.publicApiPort, "127.0.0.1", () => console.log(`Phase 0 real public API: http://localhost:${config.publicApiPort}`));
