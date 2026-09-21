import { assessDeliverabilityHealth, buildDeliverabilityMetrics } from "../../../packages/domain/src/phase2/deliverability.js";
import { customerDnsUsesProviderBranding, staticLifecycleState } from "../../../packages/domain/src/phase1/branded-domain.js";
import { presentCustomerDnsRecord } from "../../../packages/domain/src/phase1/customer-dns-presentation.js";
import { buildStaticProductionCustomerRecords } from "../../../packages/domain/src/phase1/static-production-customer-dns.js";
import { staticProductionDnsRecordCount } from "../../../packages/domain/src/phase1/static-branded-dns.js";
import { hasPermission, type Role } from "../../../packages/domain/src/phase1/permissions.js";

type PrismaLike = any;

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function detail(value: unknown, key: string): string | null {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? String((value as Record<string, unknown>)[key]) : null;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function boundedDays(value: number): number {
  return [1, 7, 30].includes(value) ? value : 30;
}

export async function deliverabilityDashboard(input: {
  prisma: PrismaLike;
  workspaceId: string;
  userId: string;
  days?: number;
  domainId?: string | null;
  flowId?: string | null;
  supportedRegions?: string[];
  brandedDomainSetupAvailable?: boolean;
  staticBrandedSetupAvailable?: boolean;
  dmarcRequired?: boolean;
}) {
  const prisma = input.prisma;
  const days = boundedDays(input.days ?? 30);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } }, select: { role: true, status: true } });
  const role = membership?.status === "active" ? membership.role as Role : null;
  if (!role || !hasPermission(role, "analytics.read")) throw new Error("FORBIDDEN:analytics.read");

  const [domains, identities, policy, holds, readiness, flows, deliveryRoutes, platformGates] = await Promise.all([
    prisma.senderDomain.findMany({ where: { workspaceId: input.workspaceId, workspacePrimary:true, archivedAt:null, lifecycleState: { notIn: ["DELETED", "DELETING", "deleted", "deleting"] } }, orderBy: { createdAt: "desc" } }),
    prisma.senderIdentity.findMany({ where: { workspaceId: input.workspaceId, status: "active" }, orderBy: { createdAt: "desc" } }),
    prisma.sendPolicy.findFirst({ where: { workspaceId: input.workspaceId, active: true }, orderBy: { policyVersion: "desc" } }),
    prisma.operationalHold.findMany({ where: { workspaceId: input.workspaceId, state: "active" }, orderBy: { createdAt: "desc" } }),
    prisma.workspaceReadinessCheck.findMany({ where: { workspaceId: input.workspaceId }, orderBy: { checkedAt: "desc" } }),
    prisma.flow.findMany({ where: { workspaceId: input.workspaceId, status: { in: ["active", "paused", "testing"] } }, select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" } }),
    prisma.emailDeliveryRoute.findMany({where:{workspaceId:input.workspaceId,archivedAt:null},select:{senderDomainId:true,status:true,updatedAt:true}}),
    prisma.phase0GateEvidence.findMany({where:{checkKey:{in:["real.sns.signature","real.sns.subscription","real.feedback.endpoint","real.unsubscribe.endpoint"]}},select:{checkKey:true,status:true}}),
  ]);
  const selectedDomain = domains[0] ?? null;
  if (input.domainId && input.domainId !== selectedDomain?.id) {
    console.error(JSON.stringify({event:"route.trace",step:"deliverabilityDashboard.stale_domainId",workspaceId:input.workspaceId,requestedDomainId:input.domainId,currentDomainId:selectedDomain?.id??null}));
  }
  const selectedFlow = input.flowId ? flows.find((flow: any) => flow.id === input.flowId) : null;
  if (input.flowId && !selectedFlow) {
    console.error(JSON.stringify({event:"route.trace",step:"deliverabilityDashboard.stale_flowId",workspaceId:input.workspaceId,requestedFlowId:input.flowId}));
  }

  const selectedIdentityIds = selectedDomain ? identities.filter((identity: any) => identity.domainId === selectedDomain.id).map((identity: any) => identity.id) : [];
  const selectedVersionIds = selectedDomain && selectedIdentityIds.length
    ? (await prisma.emailVersion.findMany({ where: { workspaceId: input.workspaceId, senderIdentityId: { in: selectedIdentityIds } }, select: { id: true } })).map((version: any) => version.id)
    : [];
  const selectedSnapshotIds = selectedDomain && selectedIdentityIds.length
    ? (await prisma.emailTestSnapshot.findMany({ where: { workspaceId: input.workspaceId, senderIdentityId: { in: selectedIdentityIds } }, select: { id: true } })).map((snapshot: any) => snapshot.id)
    : [];
  const selectedRunIds = selectedFlow
    ? (await prisma.flowRun.findMany({ where: { workspaceId: input.workspaceId, flowId: selectedFlow.id }, select: { id: true } })).map((run: any) => run.id)
    : [];
  const noDomainMessages = Boolean(selectedDomain && selectedVersionIds.length === 0 && selectedSnapshotIds.length === 0);
  const noFlowMessages = Boolean(selectedFlow && selectedRunIds.length === 0);
  const scopedMessageWhere: Record<string, unknown> = {
    workspaceId: input.workspaceId,
    submittedAt: { gte: from, lte: to },
    ...(selectedFlow ? { flowRunId: { in: selectedRunIds } } : {}),
  };
  if (selectedDomain) {
    scopedMessageWhere.OR = [
      ...(selectedVersionIds.length ? [{ emailVersionId: { in: selectedVersionIds } }] : []),
      ...(selectedSnapshotIds.length ? [{ emailTestSnapshotId: { in: selectedSnapshotIds } }] : []),
    ];
  }
  const productionMessageWhere = { ...scopedMessageWhere, sourceType: { not: "test" } };
  const messages = noDomainMessages || noFlowMessages ? [] : await prisma.message.findMany({ where: productionMessageWhere, select: { id: true, profileId: true, flowRunId: true, submittedAt: true, state: true } });
  const feedbackMessages = noDomainMessages || noFlowMessages ? [] : await prisma.message.findMany({ where: scopedMessageWhere, select: { id: true, profileId: true, flowRunId: true, submittedAt: true, state: true, sourceType: true } });
  const messageIds = feedbackMessages.map((message: any) => message.id);
  const eventWhere = { workspaceId: input.workspaceId, occurredAt: { gte: from, lte: to }, ...(messageIds.length ? { messageId: { in: messageIds } } : { messageId: { in: [] } }) };
  const [events, unsubscribes, allSuppressions, heldMessages, latestFeedback, pendingFeedback] = await Promise.all([
    prisma.deliveryEvent.findMany({ where: eventWhere, orderBy: { occurredAt: "desc" }, select: { id: true, messageId: true, provider: true, providerEventId: true, eventType: true, occurredAt: true, receivedAt: true, normalizedPayload: true } }),
    prisma.suppression.findMany({ where: { workspaceId: input.workspaceId, channel: "email", createdAt: { gte: from, lte: to }, reason: { in: ["global_unsubscribe", "category_unsubscribe"] } }, select: { id: true } }),
    prisma.suppression.findMany({ where: { workspaceId: input.workspaceId, channel: "email" }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.message.findMany({ where: { workspaceId: input.workspaceId, sourceType: { not: "test" }, state: "held" }, select: { id: true, emailVersionId: true, policyDecision: true } }),
    prisma.deliveryEvent.aggregate({ where: { workspaceId: input.workspaceId }, _max: { receivedAt: true } }),
    prisma.inboxMessage.count({ where: { workspaceId: input.workspaceId, source: "ses", status: { not: "processed" } } }),
  ]);
  const feedbackStaleAfterSeconds = policy?.warmingJson && typeof policy.warmingJson === "object" && typeof policy.warmingJson.feedbackStaleAfterSeconds === "number" ? policy.warmingJson.feedbackStaleAfterSeconds : null;
  const uniqueEventMessages = (predicate: (event: any) => boolean) => new Set(events.filter(predicate).map((event: any) => event.messageId)).size;
  const hardBounceIds = new Set(events.filter((event: any) => event.eventType === "hard_bounce" || (event.eventType === "bounce" && detail(event.normalizedPayload, "bounceType")?.toLowerCase() === "permanent")).map((event: any) => event.messageId));
  const hardBounces = hardBounceIds.size;
  const softBounces = uniqueEventMessages((event: any) => !hardBounceIds.has(event.messageId) && (event.eventType === "soft_bounce" || (event.eventType === "bounce" && detail(event.normalizedPayload, "bounceType")?.toLowerCase() !== "permanent")));
  const delivered = uniqueEventMessages((event: any) => event.eventType === "delivery" || event.eventType === "delivered");
  const complaints = uniqueEventMessages((event: any) => event.eventType === "complaint" || event.eventType === "complained");
  const submitted = messages.length;
  const metrics = buildDeliverabilityMetrics({ submitted, delivered, hardBounces, softBounces, complaints, unsubscribes: unsubscribes.length });
  const feedbackLatestAt = latestFeedback._max.receivedAt as Date | null;
  const health = assessDeliverabilityHealth({ domainCount: domains.length, verifiedDomainCount: domains.filter((domain: any) => domain.status === "verified").length, activeHoldCount: holds.length, submitted, hardBounces, complaints, feedbackLatestAt, feedbackStaleAfterMs: feedbackStaleAfterSeconds ? feedbackStaleAfterSeconds * 1000 : undefined }, to);
  const trend = new Map<string, { date: string; submitted: number; delivered: number }>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(to.getTime() - offset * 86_400_000);
    trend.set(dayKey(date), { date: dayKey(date), submitted: 0, delivered: 0 });
  }
  for (const message of messages) {
    if (message.submittedAt) trend.get(dayKey(message.submittedAt))!.submitted++;
  }
  const deliveredByDay = new Map<string, Set<string>>();
  for (const event of events) if (event.eventType === "delivery" || event.eventType === "delivered") { const key = dayKey(event.occurredAt), ids = deliveredByDay.get(key) ?? new Set<string>(); ids.add(event.messageId); deliveredByDay.set(key, ids); }
  for (const [key, ids] of deliveredByDay) { const row = trend.get(key); if (row) row.delivered = ids.size; }
  const profileIds = [...new Set([...messages.map((message: any) => message.profileId), ...allSuppressions.map((suppression: any) => suppression.profileId)])];
  const profiles = profileIds.length ? await prisma.profile.findMany({ where: { workspaceId: input.workspaceId, id: { in: profileIds } }, select: { id: true, originalEmail: true } }) : [];
  const profileById = new Map(profiles.map((profile: any) => [profile.id, profile.originalEmail]));
  const messageById = new Map<string, any>(messages.map((message: any) => [message.id, message]));
  const runIds = [...new Set(messages.map((message: any) => message.flowRunId).filter(Boolean))];
  const runs = runIds.length ? await prisma.flowRun.findMany({ where: { workspaceId: input.workspaceId, id: { in: runIds } }, select: { id: true, flowId: true } }) : [];
  const flowByRunId = new Map(runs.map((run: any) => [run.id, run.flowId]));
  const flowNames = new Map(flows.map((flow: any) => [flow.id, flow.name]));
  const diagnosticEvents = events.filter((event: any) => ["bounce", "hard_bounce", "soft_bounce", "complaint", "complained"].includes(event.eventType)).slice(0, 200).map((event: any) => {
    const message = messageById.get(event.messageId);
    const flowId = message?.flowRunId ? flowByRunId.get(message.flowRunId) : null;
    return { id: event.id, eventType: event.eventType, category: detail(event.normalizedPayload, "bounceSubType") ?? detail(event.normalizedPayload, "bounceType") ?? detail(event.normalizedPayload, "complaintFeedbackType") ?? "provider_reported", provider: event.provider, occurredAt: event.occurredAt, receivedAt: event.receivedAt, messageId: event.messageId, profileId: message?.profileId ?? null, profileEmail: message ? profileById.get(message.profileId) ?? null : null, flowId: flowId ?? null, flowName: flowId ? flowNames.get(flowId) ?? null : null };
  });
  const heldVersionIds = [...new Set(heldMessages.map((message: any) => message.emailVersionId).filter(Boolean))];
  const heldVersions = heldVersionIds.length ? await prisma.emailVersion.findMany({ where: { workspaceId: input.workspaceId, id: { in: heldVersionIds } }, select: { id: true, senderIdentityId: true } }) : [];
  const heldIdentityIds = [...new Set(heldVersions.map((version: any) => version.senderIdentityId))];
  const heldIdentities = heldIdentityIds.length ? await prisma.senderIdentity.findMany({ where: { workspaceId: input.workspaceId, id: { in: heldIdentityIds } }, select: { id: true, domainId: true } }) : [];
  const heldVersionDomain = new Map(heldVersions.map((version: any) => [version.id, heldIdentities.find((identity: any) => identity.id === version.senderIdentityId)?.domainId]));
  const holdsWithImpact = holds.map((hold: any) => ({ ...hold, affectedCount: hold.scopeType === "workspace" ? heldMessages.length : heldMessages.filter((message: any) => {
    const decision = message.policyDecision as Record<string, unknown> | null;
    if (hold.scopeType === "domain") return decision?.reason === "OPERATIONAL_HOLD" && heldVersionDomain.get(message.emailVersionId) === hold.scopeId;
    return decision?.reason === "OPERATIONAL_HOLD";
  }).length }));
  const warming = policy?.warmingJson && typeof policy.warmingJson === "object" && typeof policy.warmingJson.dailyLimit === "number" ? policy.warmingJson.dailyLimit : null;
  const midnight = new Date(to); midnight.setUTCHours(0, 0, 0, 0);
  const submittedToday = await prisma.message.count({ where: { workspaceId: input.workspaceId, sourceType: { not: "test" }, submittedAt: { gte: midnight, lte: to } } });
  const heldByCapacity = heldMessages.filter((message: any) => {
    const decision = message.policyDecision as Record<string, unknown> | null;
    return decision?.reason === "WARMING_LIMIT";
  }).length;
  const feedbackLagSeconds = events.length ? Math.round(events.reduce((sum: number, event: any) => sum + Math.max(0, event.receivedAt.getTime() - event.occurredAt.getTime()), 0) / events.length / 1000) : null;
  const brandedIds=domains.filter((domain:any)=>domain.provisioningMode==="branded_delegation"||domain.provisioningMode==="static_branded").map((domain:any)=>domain.id),[dnsEvidence,allDnsEvidence]=brandedIds.length?await Promise.all([prisma.senderDomainDnsEvidence.findMany({where:{workspaceId:input.workspaceId,senderDomainId:{in:brandedIds},customerActionRequired:true},orderBy:[{purpose:"asc"},{name:"asc"},{expectedValue:"asc"}]}),prisma.senderDomainDnsEvidence.findMany({where:{workspaceId:input.workspaceId,senderDomainId:{in:brandedIds}},orderBy:[{purpose:"asc"},{name:"asc"},{expectedValue:"asc"}]})]):[[],[]],evidenceByDomain=new Map<string,any[]>(),allEvidenceByDomain=new Map<string,any[]>(),routeByDomain=new Map<string,any>(deliveryRoutes.map((route:any)=>[route.senderDomainId,route])),identityCountByDomain=new Map<string,number>(),gatePassed=new Set(platformGates.filter((gate:any)=>gate.status==="passed").map((gate:any)=>gate.checkKey));
  for(const row of dnsEvidence)evidenceByDomain.set(row.senderDomainId,[...(evidenceByDomain.get(row.senderDomainId)??[]),row]);
  for(const row of allDnsEvidence)allEvidenceByDomain.set(row.senderDomainId,[...(allEvidenceByDomain.get(row.senderDomainId)??[]),row]);
  for(const identity of identities)identityCountByDomain.set(identity.domainId,(identityCountByDomain.get(identity.domainId)??0)+1);
  const allVerified=(domainId:string,purpose:string)=>{const rows=(allEvidenceByDomain.get(domainId)??[]).filter((row:any)=>row.purpose===purpose);return rows.length>0&&rows.every((row:any)=>row.verificationStatus==="verified")};
  const customerVerified=(domainId:string,purpose:string)=>{const rows=(allEvidenceByDomain.get(domainId)??[]).filter((row:any)=>row.purpose===purpose&&row.verificationStatus!=="archived");return rows.some((row:any)=>row.verificationStatus==="verified")};
  const staticDkimVerified=(domainId:string)=>customerVerified(domainId,"dkim_vm1")&&customerVerified(domainId,"dkim_vm2");
  const simpleState=(ok:boolean)=>ok?"ready":"pending";
  const customerDomains=domains.map((domain:any)=>{
    if(domain.provisioningMode!=="branded_delegation"&&domain.provisioningMode!=="static_branded")return {id:domain.id,domain:domain.domain,rootDomain:domain.domain,sendingDomain:domain.domain,provisioningMode:"legacy_ses_records",provisioningVersion:domain.provisioningVersion??"V1_LEGACY_SEND_SUBDOMAIN",lifecycleState:domain.status==="verified"?"ready":"authentication_verifying",authenticationStatus:domain.status,readinessStatus:domain.status==="verified"?"ready":"not_ready",readinessReasons:domain.status==="verified"?[]:["LEGACY_AUTHENTICATION_PENDING"],lastCheckedAt:domain.lastCheckedAt,verifiedAt:domain.verifiedAt,customerRecords:[],readinessChecks:[{key:"authentication",label:"Authentication",status:domain.status==="verified"?"ready":"pending"}]};
    const isV3=domain.provisioningVersion==="V3_ROOT_SENDER_DELEGATED_EASY_DKIM"||domain.provisioningVersion==="V3_ROOT_SENDER_PLATFORM_DKIM";
    const isStatic=domain.provisioningMode==="static_branded"||domain.provisioningVersion==="V4_STATIC_BRANDED_BYODKIM"||domain.provisioningVersion==="V5_STATIC_BRANDED_KLAVIYO";
    const ownershipVerified=isStatic?customerVerified(domain.id,"ownership"):allVerified(domain.id,"ownership");
    const sendRoutingVerified=isStatic?customerVerified(domain.id,"send_routing"):allVerified(domain.id,"send_routing");
    const dkimDnsVerified=isStatic?staticDkimVerified(domain.id):allVerified(domain.id,"dkim");
    const sesIdentitySuccess=String(domain.verificationStatus??"").toLowerCase()==="success";
    const dkimSuccess=sesIdentitySuccess&&String(domain.dkimStatus??"").toLowerCase()==="success"&&dkimDnsVerified;
    const mailFromDnsVerified=isStatic?customerVerified(domain.id,"mail_from_mx")&&customerVerified(domain.id,"mail_from_spf"):allVerified(domain.id,"mail_from");
    const mailFromVerified=isStatic?mailFromDnsVerified&&String(domain.mailFromStatus??"").toLowerCase()==="success":String(domain.mailFromStatus??"").toLowerCase()==="success"||allVerified(domain.id,"mail_from");
    const lifecycleState=isStatic?staticLifecycleState({
      ownershipVerified,
      dkimDnsVerified,
      sesIdentitySuccess,
      dkimSuccess,
      mailFromVerified:dkimSuccess?mailFromVerified:undefined,
      ready:domain.readinessStatus==="ready"||domain.authenticationStatus==="verified",
      failed:String(domain.lifecycleState??"").toUpperCase()==="FAILED",
    }):domain.lifecycleState;
    return {
      id:domain.id,
      domain:domain.rootDomain??domain.domain,
      rootDomain:domain.rootDomain??domain.domain,
      infraDomain:domain.delegatedSubdomain,
      sendingDomain:domain.rootDomain??domain.domain,
      mailFromDomain:domain.mailFromDomain,
      trackingDomain:domain.trackingDomain,
      provisioningMode:domain.provisioningMode,
      provisioningVersion:domain.provisioningVersion,
      setupMode:domain.setupMode??null,
      routingId:domain.routingId??null,
      lifecycleState,
      disconnectStatus:domain.disconnectStatus??null,
      authenticationStatus:domain.authenticationStatus,
      readinessStatus:domain.readinessStatus,
      readinessReasons:Array.isArray(domain.readinessReasons)?domain.readinessReasons:[],
      lastCheckedAt:domain.lastCheckedAt,
      providerStatus:domain.providerStatus??null,
      verificationStatus:domain.verificationStatus??null,
      dkimStatus:domain.dkimStatus??null,
      dnsStatus:domain.dnsStatus??null,
      productionDnsRecordCount:isStatic?staticProductionDnsRecordCount(Boolean(input.dmarcRequired)):undefined,
      customerRecords:isStatic?buildStaticProductionCustomerRecords({
        rootDomain:domain.rootDomain??domain.domain,
        dmarcRequired:Boolean(input.dmarcRequired),
        evidence:(allEvidenceByDomain.get(domain.id)??[]).filter((row:any)=>!customerDnsUsesProviderBranding({name:row.name,value:row.expectedValue,purpose:row.purpose})).map((row:any)=>({purpose:row.purpose,recordType:row.recordType,name:row.name,expectedValue:row.expectedValue,verificationStatus:row.verificationStatus,observedValues:row.observedValues,lastCheckedAt:row.lastCheckedAt})),
      }):(evidenceByDomain.get(domain.id)??[]).filter(row=>row.verificationStatus!=="archived"&&!customerDnsUsesProviderBranding({name:row.name,value:row.expectedValue,purpose:row.purpose})).map(row=>{
        const root=domain.rootDomain??domain.domain;
        return {
          type:row.recordType,
          name:row.name,
          value:row.expectedValue,
          purpose:row.purpose,
          status:row.verificationStatus,
          observedValues:row.observedValues,
          lastCheckedAt:row.lastCheckedAt,
          presentation:presentCustomerDnsRecord({type:row.recordType,name:row.name,value:row.expectedValue,purpose:row.purpose,rootDomain:root}),
        };
      }),
      readinessChecks:[
        ...(isStatic?[]:[{key:"nameservers",label:"Nameservers",status:simpleState(domain.delegationStatus==="verified"||allVerified(domain.id,"delegation"))},{key:"soa",label:"Authoritative SOA",status:simpleState(domain.soaStatus==="verified")}]),
        {key:"ownership",label:"Ownership verification",status:simpleState(isStatic?customerVerified(domain.id,"ownership"):allVerified(domain.id,"ownership"))},
        ...(isStatic?[{key:"send_routing",label:"Branded link tracking (optional)",status:customerVerified(domain.id,"send_routing")?"ready":"warning"}]:[]),
        {key:"identity",label:"Email identity",status:simpleState(String(domain.verificationStatus??"").toLowerCase()==="success")},
        {key:"dkim",label:isStatic?"DKIM (Velivoo branded)":isV3?"DKIM (platform managed)":"DKIM",status:isStatic?simpleState(String(domain.dkimStatus??"").toLowerCase()==="success"&&staticDkimVerified(domain.id)):(isV3?(String(domain.dkimStatus??"").toLowerCase()==="success"?"managed":"pending"):simpleState(String(domain.dkimStatus??"").toLowerCase()==="success"&&allVerified(domain.id,"dkim")))},
        ...(isStatic?[{key:"mail_from",label:"Branded return-path",status:simpleState(mailFromVerified)}]:[{key:"mail_from",label:"Branded return-path",status:isV3?(String(domain.mailFromStatus??"").toLowerCase()==="success"?"managed":"pending"):simpleState(String(domain.mailFromStatus??"").toLowerCase()==="success"||allVerified(domain.id,"mail_from"))}]),
        {key:"dmarc",label:input.dmarcRequired?"DMARC (TXT)":"Root DMARC observation",status:domain.dmarcStatus==="verified"?"ready":domain.dmarcStatus==="pending"?"pending":"warning"},
        ...(isStatic?[]:[{key:"tracking",label:"Tracking HTTPS",status:domain.trackingProvider==="platform"||!domain.trackingProvider?"managed":simpleState(String(domain.trackingHttpsStatus??"").toLowerCase()==="verified"&&allVerified(domain.id,"tracking"))}]),
        {key:"sender",label:"Sender",status:simpleState((identityCountByDomain.get(domain.id)??0)>0&&routeByDomain.get(domain.id)?.status==="active")},
        {key:"feedback",label:"Feedback",status:simpleState(gatePassed.has("real.sns.signature")&&gatePassed.has("real.sns.subscription")&&gatePassed.has("real.feedback.endpoint"))},
        {key:"unsubscribe",label:"Unsubscribe",status:simpleState(gatePassed.has("real.unsubscribe.endpoint"))},
      ],
    };
  });
  return {
    period: { days, from, to, freshness: to },
    filters: { domainId: selectedDomain?.id ?? null, domain: selectedDomain ? {id:selectedDomain.id,domain:selectedDomain.rootDomain??selectedDomain.domain} : null, flowId: selectedFlow?.id ?? null, flows },
    capabilities: { canManageDomains: hasPermission(role, "domains.manage"), brandedDomainSetupAvailable: Boolean(input.brandedDomainSetupAvailable), staticBrandedSetupAvailable: Boolean(input.staticBrandedSetupAvailable), dmarcRequired: Boolean(input.dmarcRequired), canManageSuppressions: hasPermission(role, "suppressions.manage"), canManageOperations: hasPermission(role, "operations.pause") },
    health,
    metrics,
    volume: { submitted, delivered, trend: [...trend.values()] },
    reputation: { hardBounces, softBounces, complaints, unsubscribes: unsubscribes.length },
    domains: customerDomains,
    feedback: { state: submitted === 0 ? "awaiting_production_data" : pendingFeedback ? "processing" : feedbackLatestAt ? (to.getTime() - feedbackLatestAt.getTime() > (feedbackStaleAfterSeconds ?? 86_400) * 1000 ? "stale" : "current") : "missing", latestAt: feedbackLatestAt, processingLagSeconds: feedbackLagSeconds, pendingCount: pendingFeedback, safetyRequired: feedbackStaleAfterSeconds !== null, staleAfterSeconds: feedbackStaleAfterSeconds, safetyCurrent: submitted === 0 || feedbackStaleAfterSeconds === null || Boolean(feedbackLatestAt && feedbackLatestAt.getTime() >= to.getTime() - feedbackStaleAfterSeconds * 1000) },
    holds: holdsWithImpact,
    warming: { dailyCeiling: warming, usedVolume: submittedToday, resetAt: new Date(midnight.getTime() + 86_400_000), heldByCapacity, frequencyWindowSeconds: policy?.frequencyWindowSeconds ?? 86_400, frequencyMax: policy?.frequencyMax ?? 3, feedbackStaleAfterSeconds },
    diagnostics: { bounces: diagnosticEvents.filter((event: any) => event.eventType !== "complaint" && event.eventType !== "complained"), complaints: diagnosticEvents.filter((event: any) => event.eventType === "complaint" || event.eventType === "complained") },
    suppressions: allSuppressions.map((suppression: any) => ({ id: suppression.id, profileId: suppression.profileId, profileEmail: profileById.get(suppression.profileId) ?? null, scope: suppression.scope, reason: suppression.reason, source: suppression.source, sourceReference: suppression.sourceReference, protected: suppression.protected, createdAt: suppression.createdAt, expiresAt: suppression.expiresAt, revokedAt: suppression.revokedAt })),
    setup: { activeSenderIdentities: identities.length, verifiedDomains: domains.filter((domain: any) => domain.status === "verified").length, feedbackConfigured: Boolean(feedbackLatestAt || pendingFeedback || readiness.some((check: any) => check.checkKey === "feedback" && check.status === "passed")) },
    readiness: readiness.map((check: any) => ({ key: check.checkKey, status: check.status, checkedAt: check.checkedAt })),
  };
}
