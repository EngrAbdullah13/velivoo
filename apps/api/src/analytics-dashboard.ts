import { Prisma } from "@prisma/client";
import { hasPermission, type Role } from "../../../packages/domain/src/phase1/permissions.js";

type PrismaLike = any;
type AnalyticsInput = { prisma: PrismaLike; workspaceId: string; userId: string; range?: string | null; from?: string | null; to?: string | null; timezone?: string | null; domainId?: string | null; flowId?: string | null; emailVersionId?: string | null; messageStatus?: string | null };
const DAY = 86_400_000;
const number = (value: unknown) => Number(value ?? 0);
const identifier = (value: string | null | undefined) => value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;

function validTimezone(value: string | null | undefined) {
  const timezone = value || "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return timezone; } catch { throw new Error("ANALYTICS_TIMEZONE_INVALID"); }
}
function dayInTimezone(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "01";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function timezoneOffset(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const value = (type: string) => Number(parts.find(item => item.type === type)?.value ?? 0);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - at.getTime();
}
function localMidnight(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("ANALYTICS_DATE_INVALID");
  const [year, month, day] = value.split("-").map(Number);
  const guess = new Date(Date.UTC(year!, month! - 1, day!));
  return new Date(guess.getTime() - timezoneOffset(guess, timezone));
}
function addDays(value: Date, days: number) { return new Date(value.getTime() + days * DAY); }
function windowFor(input: AnalyticsInput) {
  const timezone = validTimezone(input.timezone), now = new Date(), range = input.range ?? "30";
  if (range === "custom") {
    if (!input.from || !input.to) throw new Error("ANALYTICS_CUSTOM_RANGE_REQUIRED");
    const from = localMidnight(input.from, timezone), to = addDays(localMidnight(input.to, timezone), 1);
    if (from >= to || to.getTime() - from.getTime() > 92 * DAY) throw new Error("ANALYTICS_RANGE_INVALID");
    return { range, timezone, from, to, now };
  }
  const days = range === "today" ? 1 : Number(range);
  if (![1, 7, 14, 30].includes(days)) throw new Error("ANALYTICS_RANGE_INVALID");
  const to = range === "today" ? addDays(localMidnight(dayInTimezone(now, timezone), timezone), 1) : now;
  const from = range === "today" ? localMidnight(dayInTimezone(now, timezone), timezone) : new Date(to.getTime() - days * DAY);
  return { range, timezone, from, to, now };
}
function messageScope(input: AnalyticsInput, alias = "m", options?: { includeTest?: boolean }) {
  const c = (field: string) => Prisma.raw(`${alias}.${field}`);
  const predicates: Prisma.Sql[] = [Prisma.sql`${c("workspace_id")}=${input.workspaceId}::uuid`];
  if (!options?.includeTest) predicates.push(Prisma.sql`${c("source_type")}<>'test'`);
  if (identifier(input.emailVersionId)) predicates.push(Prisma.sql`${c("email_version_id")}=${input.emailVersionId}::uuid`);
  if (input.messageStatus && input.messageStatus !== "all") predicates.push(Prisma.sql`${c("state")}=${input.messageStatus}`);
  if (identifier(input.flowId)) predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "flow_run" scope_run WHERE scope_run.id=${c("flow_run_id")} AND scope_run.workspace_id=${input.workspaceId}::uuid AND scope_run.flow_id=${input.flowId}::uuid)`);
  if (identifier(input.domainId)) {
    const publishedDomain = Prisma.sql`EXISTS (SELECT 1 FROM "email_version" scope_version JOIN "sender_identity" scope_identity ON scope_identity.id=scope_version.sender_identity_id AND scope_identity.workspace_id=${input.workspaceId}::uuid WHERE scope_version.id=${c("email_version_id")} AND scope_version.workspace_id=${input.workspaceId}::uuid AND scope_identity.domain_id=${input.domainId}::uuid)`;
    if (options?.includeTest) {
      predicates.push(Prisma.sql`(${publishedDomain} OR EXISTS (SELECT 1 FROM "email_test_snapshot" scope_snapshot JOIN "sender_identity" scope_identity ON scope_identity.id=scope_snapshot.sender_identity_id AND scope_identity.workspace_id=${input.workspaceId}::uuid WHERE scope_snapshot.id=${c("email_test_snapshot_id")} AND scope_snapshot.workspace_id=${input.workspaceId}::uuid AND scope_identity.domain_id=${input.domainId}::uuid))`);
    } else {
      predicates.push(publishedDomain);
    }
  }
  return predicates;
}
function where(parts: Prisma.Sql[]) { return Prisma.join(parts, " AND "); }
function metric(key: string, label: string, value: number, numerator: number | null, denominator: number | null, definition: string, knownLimitations?: string) { return { key, label, value, numerator, denominator, rate: numerator !== null && denominator && denominator > 0 ? numerator / denominator : null, definitionVersion: "release1.analytics.v1", definition, knownLimitations: knownLimitations ?? null }; }

export async function analyticsDashboard(input: AnalyticsInput) {
  const membership = await input.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } }, select: { role: true, status: true } });
  const role = membership?.status === "active" ? membership.role as Role : null;
  if (!role || !hasPermission(role, "analytics.read")) throw new Error("FORBIDDEN:analytics.read");
  const [domains, flows, versions] = await Promise.all([
    input.prisma.senderDomain.findMany({ where: { workspaceId: input.workspaceId, workspacePrimary:true, archivedAt:null }, select: { id: true, domain: true }, orderBy: { domain: "asc" } }),
    input.prisma.flow.findMany({ where: { workspaceId: input.workspaceId }, select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" } }),
    input.prisma.emailVersion.findMany({ where: { workspaceId: input.workspaceId }, select: { id: true, versionNumber: true, emailDefinitionId: true, definition: { select: { name: true } } }, orderBy: { publishedAt: "desc" }, take: 200 }),
  ]);
  const scopedInput={...input,domainId:domains[0]?.id??null};
  const period = windowFor(scopedInput), scope = messageScope(scopedInput), source = where(scope);
  if (identifier(input.flowId) && !flows.some((item: any) => item.id === input.flowId)) throw new Error("FLOW_NOT_FOUND");
  if (identifier(input.emailVersionId) && !versions.some((item: any) => item.id === input.emailVersionId)) throw new Error("EMAIL_VERSION_NOT_FOUND");
  const eventScope = where([...scope, Prisma.sql`e.occurred_at>=${period.from}`, Prisma.sql`e.occurred_at<${period.to}`]);
  const engagementScope = where([...scope, Prisma.sql`t.occurred_at>=${period.from}`, Prisma.sql`t.occurred_at<${period.to}`, Prisma.sql`t.aggregate_type='message'`, Prisma.sql`t.kind IN ('engagement.click','engagement.open')`]);
  const [messages, events, engagement, unsubscribes, runs, trendSubmitted, trendDelivered, trendClicks, trendOpens, topContent, recentEvents, freshness] = await Promise.all([
    input.prisma.$queryRaw(Prisma.sql`SELECT COUNT(*) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to})::bigint AS intents, COUNT(*) FILTER (WHERE m.submitted_at>=${period.from} AND m.submitted_at<${period.to})::bigint AS submitted, COUNT(*) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to} AND m.state='held')::bigint AS held, COUNT(*) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to} AND m.state='skipped')::bigint AS skipped, COUNT(*) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to} AND m.state='cancelled')::bigint AS cancelled, COUNT(*) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to} AND m.state='failed')::bigint AS failed FROM "message" m WHERE ${source}`),
    input.prisma.$queryRaw(Prisma.sql`SELECT COUNT(*) FILTER (WHERE e.event_type IN ('delivery','delivered'))::bigint AS delivered, COUNT(*) FILTER (WHERE e.event_type IN ('hard_bounce') OR (e.event_type='bounce' AND lower(COALESCE(e.normalized_payload_json->'metadata'->>'bounceType',e.normalized_payload_json->>'bounceType',''))='permanent'))::bigint AS hard_bounces, COUNT(*) FILTER (WHERE e.event_type='soft_bounce' OR (e.event_type='bounce' AND lower(COALESCE(e.normalized_payload_json->'metadata'->>'bounceType',e.normalized_payload_json->>'bounceType',''))<>'permanent'))::bigint AS soft_bounces, COUNT(*) FILTER (WHERE e.event_type IN ('complaint','complained'))::bigint AS complaints FROM "delivery_event" e JOIN "message" m ON m.id=e.message_id AND m.workspace_id=e.workspace_id WHERE ${eventScope}`),
    input.prisma.$queryRaw(Prisma.sql`SELECT COUNT(*) FILTER (WHERE t.kind='engagement.click')::bigint AS total_clicks, COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.kind='engagement.click')::bigint AS unique_clicks, COUNT(*) FILTER (WHERE t.kind='engagement.open')::bigint AS total_opens, COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.kind='engagement.open')::bigint AS unique_opens FROM "trace_event" t JOIN "message" m ON m.id=t.aggregate_id AND m.workspace_id=t.workspace_id WHERE ${engagementScope}`),
    input.prisma.suppression.count({ where: { workspaceId: input.workspaceId, channel: "email", reason: { in: ["global_unsubscribe", "category_unsubscribe"] }, createdAt: { gte: period.from, lt: period.to } } }),
    input.prisma.$queryRaw(Prisma.sql`SELECT COUNT(*) FILTER (WHERE r.state IN ('active','waiting','held'))::bigint AS active, COUNT(*) FILTER (WHERE r.state IN ('completed','exited','cancelled','failed') AND r.ended_at>=${period.from} AND r.ended_at<${period.to})::bigint AS finished FROM "flow_run" r WHERE r.workspace_id=${input.workspaceId}::uuid ${identifier(input.flowId) ? Prisma.sql`AND r.flow_id=${input.flowId}::uuid` : Prisma.empty}`),
    input.prisma.$queryRaw(Prisma.sql`SELECT to_char(timezone(${period.timezone},m.submitted_at),'YYYY-MM-DD') AS day,COUNT(*)::bigint AS value FROM "message" m WHERE ${source} AND m.submitted_at>=${period.from} AND m.submitted_at<${period.to} GROUP BY 1 ORDER BY 1`),
    input.prisma.$queryRaw(Prisma.sql`SELECT to_char(timezone(${period.timezone},e.occurred_at),'YYYY-MM-DD') AS day,COUNT(*)::bigint AS value FROM "delivery_event" e JOIN "message" m ON m.id=e.message_id AND m.workspace_id=e.workspace_id WHERE ${eventScope} AND e.event_type IN ('delivery','delivered') GROUP BY 1 ORDER BY 1`),
    input.prisma.$queryRaw(Prisma.sql`SELECT to_char(timezone(${period.timezone},t.occurred_at),'YYYY-MM-DD') AS day,COUNT(DISTINCT t.aggregate_id)::bigint AS value FROM "trace_event" t JOIN "message" m ON m.id=t.aggregate_id AND m.workspace_id=t.workspace_id WHERE ${engagementScope} AND t.kind='engagement.click' GROUP BY 1 ORDER BY 1`),
    input.prisma.$queryRaw(Prisma.sql`SELECT to_char(timezone(${period.timezone},t.occurred_at),'YYYY-MM-DD') AS day,COUNT(DISTINCT t.aggregate_id)::bigint AS value FROM "trace_event" t JOIN "message" m ON m.id=t.aggregate_id AND m.workspace_id=t.workspace_id WHERE ${engagementScope} AND t.kind='engagement.open' GROUP BY 1 ORDER BY 1`),
    input.prisma.$queryRaw(Prisma.sql`SELECT m.email_version_id AS "emailVersionId",COALESCE(ed.name,'Unpublished content') AS name,COALESCE(ev.version_number,0) AS "versionNumber",COUNT(DISTINCT m.id) FILTER (WHERE m.submitted_at>=${period.from} AND m.submitted_at<${period.to})::bigint AS submitted,COUNT(DISTINCT e.id) FILTER (WHERE e.event_type IN ('delivery','delivered'))::bigint AS delivered,COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.kind='engagement.open')::bigint AS "uniqueOpens",COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.kind='engagement.click')::bigint AS "uniqueClicks" FROM "message" m LEFT JOIN "email_version" ev ON ev.id=m.email_version_id AND ev.workspace_id=m.workspace_id LEFT JOIN "email_definition" ed ON ed.id=ev.email_definition_id AND ed.workspace_id=ev.workspace_id LEFT JOIN "delivery_event" e ON e.message_id=m.id AND e.workspace_id=m.workspace_id AND e.occurred_at>=${period.from} AND e.occurred_at<${period.to} LEFT JOIN "trace_event" t ON t.aggregate_id=m.id AND t.workspace_id=m.workspace_id AND t.aggregate_type='message' AND t.occurred_at>=${period.from} AND t.occurred_at<${period.to} WHERE ${source} AND m.created_at>=${period.from} AND m.created_at<${period.to} GROUP BY m.email_version_id,ed.name,ev.version_number ORDER BY "uniqueClicks" DESC,"uniqueOpens" DESC,submitted DESC LIMIT 8`),
    input.prisma.$queryRaw(Prisma.sql`SELECT t.aggregate_id AS "messageId",t.kind,t.occurred_at AS "occurredAt" FROM "trace_event" t JOIN "message" m ON m.id=t.aggregate_id AND m.workspace_id=t.workspace_id WHERE ${engagementScope} ORDER BY t.occurred_at DESC LIMIT 12`),
    input.prisma.$queryRaw(Prisma.sql`SELECT MAX(e.received_at) AS latest_feedback,MAX(t.occurred_at) AS latest_engagement FROM "delivery_event" e FULL OUTER JOIN "trace_event" t ON false WHERE (e.workspace_id=${input.workspaceId}::uuid OR t.workspace_id=${input.workspaceId}::uuid)`),
  ]);
  const message = messages[0] ?? {}, event = events[0] ?? {}, activity = engagement[0] ?? {}, run = runs[0] ?? {};
  const values = { intents: number(message.intents), submitted: number(message.submitted), delivered: number(event.delivered), totalClicks: number(activity.total_clicks), uniqueClicks: number(activity.unique_clicks), totalOpens: number(activity.total_opens), uniqueOpens: number(activity.unique_opens), unsubscribes, hardBounces: number(event.hard_bounces), softBounces: number(event.soft_bounces), complaints: number(event.complaints), held: number(message.held), skipped: number(message.skipped), cancelled: number(message.cancelled), failed: number(message.failed), activeRuns: number(run.active), finishedRuns: number(run.finished) };
  const trendMap = new Map<string, { date: string; submitted: number; delivered: number; uniqueClicks: number; uniqueOpens: number }>();
  for (let at = new Date(period.from); at < period.to; at = addDays(at, 1)) { const key = new Intl.DateTimeFormat("en-CA", { timeZone: period.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); trendMap.set(key, { date: key, submitted: 0, delivered: 0, uniqueClicks: 0, uniqueOpens: 0 }); }
  for (const row of trendSubmitted) { const entry = trendMap.get(row.day); if (entry) entry.submitted = number(row.value); }
  for (const row of trendDelivered) { const entry = trendMap.get(row.day); if (entry) entry.delivered = number(row.value); }
  for (const row of trendClicks) { const entry = trendMap.get(row.day); if (entry) entry.uniqueClicks = number(row.value); }
  for (const row of trendOpens) { const entry = trendMap.get(row.day); if (entry) entry.uniqueOpens = number(row.value); }
  const latest = freshness[0]?.latest_feedback ?? freshness[0]?.latest_engagement ?? null, age = latest ? period.now.getTime() - new Date(latest).getTime() : null;
  const hasFeedback = values.delivered > 0 || values.hardBounces > 0 || values.softBounces > 0 || values.complaints > 0;
  const freshnessState = values.submitted === 0 && !hasFeedback ? "current" : !latest ? "delayed" : age !== null && age > DAY ? "stale" : "current";
  const metrics = [metric("submitted", "Sent", values.submitted, null, null, "Production messages accepted by the provider in the selected time window."), metric("delivered", "Delivered", values.delivered, values.delivered, values.submitted, "Provider delivery feedback received divided by production messages submitted."), metric("unique_opens", "Unique opens", values.uniqueOpens, values.uniqueOpens, values.submitted, "Distinct delivered messages with at least one SES open event.", "Opens rely on remote-image loading and can be affected by privacy features or security scanners."), metric("unique_clicks", "Unique clicks", values.uniqueClicks, values.uniqueClicks, values.submitted, "Distinct messages with at least one tracked link click."), metric("click_to_open", "Click-to-open", values.uniqueOpens ? values.uniqueClicks / values.uniqueOpens : 0, values.uniqueClicks, values.uniqueOpens, "Unique clicks divided by unique opens. This is unavailable until an open is recorded."), metric("hard_bounces", "Hard bounces", values.hardBounces, values.hardBounces, values.submitted, "Permanent provider bounce feedback divided by production messages submitted."), metric("complaints", "Spam complaints", values.complaints, values.complaints, values.submitted, "Provider complaints divided by production messages submitted."), metric("unsubscribes", "Unsubscribes", values.unsubscribes, values.unsubscribes, values.submitted, "Marketing unsubscribe suppressions created in the selected period."), metric("active_runs", "Active Flow Runs", values.activeRuns, null, null, "Current active, waiting, or held runs in the selected Flow scope.")];
  const flowComparison = await flowComparisonProjection(input, period, source);
  const flowDetail = identifier(input.flowId) ? await flowDetailProjection(input, period) : null;
  const recentMessages = await input.prisma.message.findMany({ where: { workspaceId: input.workspaceId, sourceType: { not: "test" }, ...(identifier(input.emailVersionId) ? { emailVersionId: input.emailVersionId } : {}), ...(input.messageStatus && input.messageStatus !== "all" ? { state: input.messageStatus } : {}), createdAt: { gte: period.from, lt: period.to } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, state: true, createdAt: true, submittedAt: true, flowRunId: true, emailVersionId: true, policyDecision: true } });
  const recentRunIds = recentMessages.map((item: any) => item.flowRunId).filter(Boolean), recentRuns = recentRunIds.length ? await input.prisma.flowRun.findMany({ where: { workspaceId: input.workspaceId, id: { in: recentRunIds } }, select: { id: true, flowId: true } }) : [], runById = new Map(recentRuns.map((item: any) => [item.id, item.flowId])), versionLabel = new Map(versions.map((item: any) => [item.id, `${item.definition.name} · v${item.versionNumber}`]));
  return { period: { range: period.range, timezone: period.timezone, from: period.from, to: period.to }, filters: { domainId: scopedInput.domainId, domain: domains[0]??null, flowId: input.flowId ?? null, emailVersionId: input.emailVersionId ?? null, messageStatus: input.messageStatus ?? "all", flows, emailVersions: versions.map((item: any) => ({ id: item.id, label: `${item.definition.name} · v${item.versionNumber}` })) }, capabilities: { canRead: true, canExport: hasPermission(role, "analytics.read") }, freshness: { state: freshnessState, refreshedAt: period.now, sourceLatestAt: latest, projectionLagSeconds: 0, detail: "Current means Velivoo queried the durable delivery and engagement records when this page loaded." }, metrics, values, engagement: { totalOpens: values.totalOpens, totalClicks: values.totalClicks, uniqueOpens: values.uniqueOpens, uniqueClicks: values.uniqueClicks }, trend: [...trendMap.values()], deliveryOutcomes: { held: values.held, skipped: values.skipped, cancelled: values.cancelled, failed: values.failed, softBounces: values.softBounces }, flowComparison, flowDetail, topContent: topContent.map((item: any) => ({ ...item, submitted: number(item.submitted), delivered: number(item.delivered), uniqueOpens: number(item.uniqueOpens), uniqueClicks: number(item.uniqueClicks) })), recentEvents: recentEvents.map((item: any) => ({ ...item })), recentMessages: recentMessages.map((item: any) => ({ ...item, flowId: item.flowRunId ? runById.get(item.flowRunId) ?? null : null, emailVersionLabel: versionLabel.get(item.emailVersionId) ?? null, policyReason: item.policyDecision && typeof item.policyDecision === "object" ? item.policyDecision.reason ?? null : null })), definitions: { version: "release1.analytics.v2", opens: "Opens are secondary and privacy-qualified. Use clicks as stronger engagement evidence.", exclusion: "All dashboard metrics and trends exclude test sends. Test delivery remains visible in the individual message trace.", lateFeedback: "Feedback is idempotently stored by provider event identity; late feedback appears on the next page refresh without double counting.", attribution: "Revenue and conversion attribution are not yet connected to an orders integration." } };
}

export async function analyticsExport(input: AnalyticsInput) {
  const dashboard = await analyticsDashboard(input), period = dashboard.period, source = where(messageScope({...input,domainId:dashboard.filters.domainId}));
  const rows = await input.prisma.$queryRaw(Prisma.sql`SELECT m.id AS "messageId",m.created_at AS "intentAt",m.submitted_at AS "submittedAt",m.state,COALESCE(m.policy_decision_json->>'reason','') AS "policyReason",d.domain,f.id AS "flowId",f.name AS "flowName",fv.version_number AS "flowVersionNumber",ev.version_number AS "emailVersionNumber",ed.name AS "emailName" FROM "message" m LEFT JOIN "email_version" ev ON ev.id=m.email_version_id AND ev.workspace_id=m.workspace_id LEFT JOIN "email_definition" ed ON ed.id=ev.email_definition_id AND ed.workspace_id=ev.workspace_id LEFT JOIN "sender_identity" si ON si.id=ev.sender_identity_id AND si.workspace_id=ev.workspace_id LEFT JOIN "sender_domain" d ON d.id=si.domain_id AND d.workspace_id=si.workspace_id LEFT JOIN "flow_run" r ON r.id=m.flow_run_id AND r.workspace_id=m.workspace_id LEFT JOIN "flow" f ON f.id=r.flow_id AND f.workspace_id=r.workspace_id LEFT JOIN "flow_version" fv ON fv.id=r.flow_version_id AND fv.workspace_id=r.workspace_id WHERE ${source} AND m.created_at>=${period.from} AND m.created_at<${period.to} ORDER BY m.created_at DESC LIMIT 10000`);
  return { period, rows, truncated: rows.length === 10000, definitionVersion: "release1.analytics.v1" };
}

type RecipientStatus = "all" | "opened" | "not_opened" | "clicked" | "not_clicked";
type RecipientInput = AnalyticsInput & { recipientStatus?: string | null; openStatus?: string | null; clickStatus?: string | null; search?: string | null; page?: number; limit?: number };
type RecipientRow = { messageId: string; profileId: string; email: string | null; name: string | null; phone: string | null; unsubscribed: boolean | null; emailName: string; emailVersionNumber: number | null; sourceType: string; flowName: string | null; state: string; sentAt: Date; delivered: boolean; openCount: number; firstOpenedAt: Date | null; lastOpenedAt: Date | null; clickCount: number; firstClickedAt: Date | null; lastClickedAt: Date | null; clickedUrls: string | null; opened: boolean; clicked: boolean };
const recipientStatuses = new Set<RecipientStatus>(["all", "opened", "not_opened", "clicked", "not_clicked"]);

function selectedStatuses(value: string | null | undefined, allowed: readonly string[]) {
  if (!value || value === "all") return new Set<string>();
  const selected = value.split(",").map(item => item.trim());
  if (selected.some(item => !allowed.includes(item)) || new Set(selected).size !== selected.length) throw new Error("ANALYTICS_RECIPIENT_STATUS_INVALID");
  return new Set(selected);
}

async function recipientScope(input: RecipientInput) {
  const membership = await input.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } }, select: { role: true, status: true } });
  const role = membership?.status === "active" ? membership.role as Role : null;
  if (!role || !hasPermission(role, "analytics.read")) throw new Error("FORBIDDEN:analytics.read");
  if (input.flowId && !identifier(input.flowId)) throw new Error("FLOW_NOT_FOUND");
  if (input.emailVersionId && !identifier(input.emailVersionId)) throw new Error("EMAIL_VERSION_NOT_FOUND");
  const status = (input.recipientStatus || "all") as RecipientStatus;
  if (!recipientStatuses.has(status)) throw new Error("ANALYTICS_RECIPIENT_STATUS_INVALID");
  const openStatuses = selectedStatuses(input.openStatus ?? (status === "opened" || status === "not_opened" ? status : null), ["opened", "not_opened"]);
  const clickStatuses = selectedStatuses(input.clickStatus ?? (status === "clicked" || status === "not_clicked" ? status : null), ["clicked", "not_clicked"]);
  const search = input.search?.trim() ?? "";
  if (search.length > 160) throw new Error("ANALYTICS_SEARCH_TOO_LONG");
  const period = windowFor(input);
  const domains = await input.prisma.senderDomain.findMany({ where: { workspaceId: input.workspaceId, workspacePrimary: true, archivedAt: null }, select: { id: true }, orderBy: { domain: "asc" }, take: 1 });
  const scopedInput = { ...input, domainId: input.domainId || domains[0]?.id || null };
  const source = where(messageScope(scopedInput));
  const searchClause = search ? Prisma.sql`AND p.deleted_at IS NULL AND (strpos(lower(COALESCE(p.original_email,'')),lower(${search}))>0 OR strpos(lower(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')),lower(${search}))>0 OR strpos(lower(COALESCE(phone_id.phone,phone_property.phone,'')),lower(${search}))>0)` : Prisma.empty;
  const projection = Prisma.sql`
    SELECT m.id AS "messageId",m.profile_id AS "profileId",
      CASE WHEN p.deleted_at IS NULL THEN p.original_email ELSE NULL END AS email,
      CASE WHEN p.deleted_at IS NULL THEN NULLIF(trim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')),'') ELSE NULL END AS name,
      CASE WHEN p.deleted_at IS NULL THEN COALESCE(phone_id.phone,phone_property.phone) ELSE NULL END AS phone,
      CASE WHEN p.deleted_at IS NULL THEN (COALESCE(sub.current_status='withdrawn',false) OR EXISTS (SELECT 1 FROM "suppression" sup WHERE sup.workspace_id=m.workspace_id AND sup.profile_id=m.profile_id AND sup.channel='email' AND sup.reason='global_unsubscribe' AND sup.revoked_at IS NULL AND (sup.expires_at IS NULL OR sup.expires_at>NOW()))) ELSE NULL END AS unsubscribed,
      COALESCE(ed.name,'Unpublished email') AS "emailName",ev.version_number AS "emailVersionNumber",
      m.source_type AS "sourceType",f.name AS "flowName",m.state,m.submitted_at AS "sentAt",
      EXISTS (SELECT 1 FROM "delivery_event" de WHERE de.workspace_id=m.workspace_id AND de.message_id=m.id AND de.event_type IN ('delivery','delivered')) AS delivered,
      GREATEST(COALESCE(m.open_count,0)::bigint,COALESCE(activity.open_count,0)) AS "openCount",
      COALESCE(m.first_opened_at,activity.first_opened_at) AS "firstOpenedAt",
      COALESCE(m.last_opened_at,activity.last_opened_at) AS "lastOpenedAt",
      COALESCE(activity.click_count,0) AS "clickCount",activity.first_clicked_at AS "firstClickedAt",
      activity.last_clicked_at AS "lastClickedAt",activity.clicked_urls AS "clickedUrls"
    FROM "message" m
    LEFT JOIN "profile" p ON p.id=m.profile_id AND p.workspace_id=m.workspace_id
    LEFT JOIN "subscription_state" sub ON sub.workspace_id=m.workspace_id AND sub.profile_id=m.profile_id AND sub.channel='email' AND sub.purpose='marketing'
    LEFT JOIN LATERAL (SELECT pi.original_value AS phone FROM "profile_identifier" pi WHERE pi.workspace_id=m.workspace_id AND pi.profile_id=m.profile_id AND lower(pi.kind) IN ('phone','mobile') AND NULLIF(trim(pi.original_value),'') IS NOT NULL ORDER BY pi.is_primary DESC,pi.created_at DESC LIMIT 1) phone_id ON true
    LEFT JOIN LATERAL (SELECT pv.text_value AS phone FROM "profile_property_value" pv JOIN "profile_property_definition" pd ON pd.id=pv.definition_id AND pd.workspace_id=pv.workspace_id WHERE pv.workspace_id=m.workspace_id AND pv.profile_id=m.profile_id AND lower(pd.key) IN ('phone','phone_number','mobile','mobile_number') AND NULLIF(trim(pv.text_value),'') IS NOT NULL ORDER BY pd.key LIMIT 1) phone_property ON true
    LEFT JOIN "email_version" ev ON ev.id=m.email_version_id AND ev.workspace_id=m.workspace_id
    LEFT JOIN "email_definition" ed ON ed.id=ev.email_definition_id AND ed.workspace_id=ev.workspace_id
    LEFT JOIN "flow_run" fr ON fr.id=m.flow_run_id AND fr.workspace_id=m.workspace_id
    LEFT JOIN "flow" f ON f.id=fr.flow_id AND f.workspace_id=fr.workspace_id
    LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE t.kind='engagement.open')::bigint AS open_count,
      MIN(t.occurred_at) FILTER (WHERE t.kind='engagement.open') AS first_opened_at,
      MAX(t.occurred_at) FILTER (WHERE t.kind='engagement.open') AS last_opened_at,
      COUNT(*) FILTER (WHERE t.kind='engagement.click')::bigint AS click_count,
      MIN(t.occurred_at) FILTER (WHERE t.kind='engagement.click') AS first_clicked_at,
      MAX(t.occurred_at) FILTER (WHERE t.kind='engagement.click') AS last_clicked_at,
      STRING_AGG(DISTINCT NULLIF(t.detail_json->>'destination',''),' | ') FILTER (WHERE t.kind='engagement.click') AS clicked_urls
      FROM "trace_event" t WHERE t.workspace_id=m.workspace_id AND t.aggregate_type='message' AND t.aggregate_id=m.id AND t.kind IN ('engagement.open','engagement.click')) activity ON true
    WHERE ${source} AND m.submitted_at>=${period.from} AND m.submitted_at<${period.to} ${searchClause}`;
  const openSelected = openStatuses.size !== 1 ? Prisma.sql`true` : openStatuses.has("opened") ? Prisma.sql`r."openCount">0` : Prisma.sql`r."openCount"=0`;
  const clickSelected = clickStatuses.size !== 1 ? Prisma.sql`true` : clickStatuses.has("clicked") ? Prisma.sql`r."clickCount">0` : Prisma.sql`r."clickCount"=0`;
  const selected = Prisma.sql`(${openSelected}) AND (${clickSelected})`;
  return { period, status, openStatuses: [...openStatuses], clickStatuses: [...clickStatuses], search, projection, openSelected, clickSelected, selected };
}

function recipientRow(row: any): RecipientRow {
  return { ...row, openCount: number(row.openCount), clickCount: number(row.clickCount), opened: number(row.openCount) > 0, clicked: number(row.clickCount) > 0 };
}

export async function analyticsRecipients(input: RecipientInput) {
  const { period, status, openStatuses, clickStatuses, search, projection, openSelected, clickSelected, selected } = await recipientScope(input);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(input.page) || 1)));
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 50)));
  const offset = (page - 1) * limit;
  const [counts, rows] = await Promise.all([
    input.prisma.$queryRaw(Prisma.sql`WITH recipient_rows AS (${projection}) SELECT COUNT(*)::bigint AS total,COUNT(*) FILTER (WHERE r."openCount">0 AND (${clickSelected}))::bigint AS opened,COUNT(*) FILTER (WHERE r."openCount"=0 AND (${clickSelected}))::bigint AS "notOpened",COUNT(*) FILTER (WHERE r."clickCount">0 AND (${openSelected}))::bigint AS clicked,COUNT(*) FILTER (WHERE r."clickCount"=0 AND (${openSelected}))::bigint AS "notClicked",COUNT(*) FILTER (WHERE ${selected})::bigint AS "matchingCount" FROM recipient_rows r`),
    input.prisma.$queryRaw(Prisma.sql`WITH recipient_rows AS (${projection}) SELECT * FROM recipient_rows r WHERE ${selected} ORDER BY r."sentAt" DESC,r."messageId" DESC LIMIT ${limit} OFFSET ${offset}`),
  ]);
  const summary = counts[0] ?? {};
  return { period: { timezone: period.timezone, from: period.from, to: period.to }, status, openStatuses, clickStatuses, search, page, limit, total: number(summary.total), matchingCount: number(summary.matchingCount), counts: { opened: number(summary.opened), notOpened: number(summary.notOpened), clicked: number(summary.clicked), notClicked: number(summary.notClicked) }, items: (rows as any[]).map(recipientRow) };
}

export async function analyticsRecipientsExport(input: RecipientInput) {
  const { period, status, openStatuses, clickStatuses, search, projection, selected } = await recipientScope(input);
  const rows = await input.prisma.$queryRaw(Prisma.sql`WITH recipient_rows AS (${projection}) SELECT * FROM recipient_rows r WHERE ${selected} ORDER BY r."sentAt" DESC,r."messageId" DESC LIMIT 100001`);
  if (rows.length > 100000) throw new Error("ANALYTICS_RECIPIENT_EXPORT_TOO_LARGE_NARROW_FILTERS");
  return { period: { timezone: period.timezone, from: period.from, to: period.to }, status, openStatuses, clickStatuses, search, rows: (rows as any[]).map(recipientRow) };
}

async function flowComparisonProjection(input: AnalyticsInput, period: ReturnType<typeof windowFor>, source: Prisma.Sql) {
  const db = input.prisma, flowFilter = identifier(input.flowId) ? Prisma.sql`AND r.flow_id=${input.flowId}::uuid` : Prisma.empty;
  return db.$queryRaw(Prisma.sql`SELECT r.flow_id AS "flowId",r.flow_version_id AS "flowVersionId",f.name AS "flowName",v.version_number AS "versionNumber",COUNT(DISTINCT r.id) FILTER (WHERE r.entered_at>=${period.from} AND r.entered_at<${period.to})::bigint AS entries,COUNT(DISTINCT m.id) FILTER (WHERE m.created_at>=${period.from} AND m.created_at<${period.to})::bigint AS intents,COUNT(DISTINCT m.id) FILTER (WHERE m.submitted_at>=${period.from} AND m.submitted_at<${period.to})::bigint AS submitted,COUNT(DISTINCT e.id) FILTER (WHERE e.occurred_at>=${period.from} AND e.occurred_at<${period.to} AND e.event_type IN ('delivery','delivered'))::bigint AS delivered,COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.occurred_at>=${period.from} AND t.occurred_at<${period.to} AND t.kind='engagement.open')::bigint AS "uniqueOpens",COUNT(DISTINCT t.aggregate_id) FILTER (WHERE t.occurred_at>=${period.from} AND t.occurred_at<${period.to} AND t.kind='engagement.click')::bigint AS "uniqueClicks",COUNT(DISTINCT e.id) FILTER (WHERE e.occurred_at>=${period.from} AND e.occurred_at<${period.to} AND e.event_type IN ('complaint','complained'))::bigint AS complaints FROM "flow_run" r JOIN "flow" f ON f.id=r.flow_id AND f.workspace_id=r.workspace_id JOIN "flow_version" v ON v.id=r.flow_version_id AND v.workspace_id=r.workspace_id LEFT JOIN "message" m ON m.flow_run_id=r.id AND m.workspace_id=r.workspace_id AND ${source} LEFT JOIN "delivery_event" e ON e.message_id=m.id AND e.workspace_id=m.workspace_id LEFT JOIN "trace_event" t ON t.aggregate_id=m.id AND t.workspace_id=m.workspace_id AND t.aggregate_type='message' WHERE r.workspace_id=${input.workspaceId}::uuid ${flowFilter} GROUP BY r.flow_id,r.flow_version_id,f.name,v.version_number ORDER BY delivered DESC,entries DESC LIMIT 100`);
}

async function flowDetailProjection(input: AnalyticsInput, period: ReturnType<typeof windowFor>) {
  const db = input.prisma, flowId = input.flowId!;
  const [states, nodes, branches, exits, policies, versions] = await Promise.all([
    db.$queryRaw(Prisma.sql`SELECT r.flow_version_id AS "flowVersionId",r.state,COUNT(*)::bigint AS value FROM "flow_run" r WHERE r.workspace_id=${input.workspaceId}::uuid AND r.flow_id=${flowId}::uuid AND (r.entered_at>=${period.from} AND r.entered_at<${period.to} OR r.ended_at>=${period.from} AND r.ended_at<${period.to}) GROUP BY r.flow_version_id,r.state`),
    db.$queryRaw(Prisma.sql`SELECT r.flow_version_id AS "flowVersionId",n.node_id AS "nodeId",n.state,COUNT(*)::bigint AS value FROM "flow_node_execution" n JOIN "flow_run" r ON r.id=n.flow_run_id AND r.workspace_id=n.workspace_id WHERE n.workspace_id=${input.workspaceId}::uuid AND r.flow_id=${flowId}::uuid AND COALESCE(n.completed_at,n.started_at,n.scheduled_at)>=${period.from} AND COALESCE(n.completed_at,n.started_at,n.scheduled_at)<${period.to} GROUP BY r.flow_version_id,n.node_id,n.state ORDER BY value DESC LIMIT 200`),
    db.$queryRaw(Prisma.sql`SELECT r.flow_version_id AS "flowVersionId",t.detail_json->>'nodeId' AS "nodeId",t.detail_json->>'nextNodeId' AS "nextNodeId",COUNT(*)::bigint AS value FROM "trace_event" t JOIN "flow_run" r ON r.id=t.aggregate_id AND r.workspace_id=t.workspace_id WHERE t.workspace_id=${input.workspaceId}::uuid AND r.flow_id=${flowId}::uuid AND t.aggregate_type='flow_run' AND t.kind='node.completed' AND t.occurred_at>=${period.from} AND t.occurred_at<${period.to} AND t.detail_json ? 'evaluation' GROUP BY r.flow_version_id,t.detail_json->>'nodeId',t.detail_json->>'nextNodeId' ORDER BY value DESC LIMIT 200`),
    db.$queryRaw(Prisma.sql`SELECT r.flow_version_id AS "flowVersionId",COALESCE(r.exit_reason,'UNSPECIFIED') AS reason,COUNT(*)::bigint AS value FROM "flow_run" r WHERE r.workspace_id=${input.workspaceId}::uuid AND r.flow_id=${flowId}::uuid AND r.ended_at>=${period.from} AND r.ended_at<${period.to} GROUP BY r.flow_version_id,COALESCE(r.exit_reason,'UNSPECIFIED') ORDER BY value DESC`),
    db.$queryRaw(Prisma.sql`SELECT r.flow_version_id AS "flowVersionId",COALESCE(m.policy_decision_json->>'reason','UNSPECIFIED') AS reason,COUNT(*)::bigint AS value FROM "message" m JOIN "flow_run" r ON r.id=m.flow_run_id AND r.workspace_id=m.workspace_id WHERE m.workspace_id=${input.workspaceId}::uuid AND r.flow_id=${flowId}::uuid AND m.source_type<>'test' AND m.created_at>=${period.from} AND m.created_at<${period.to} GROUP BY r.flow_version_id,COALESCE(m.policy_decision_json->>'reason','UNSPECIFIED') ORDER BY value DESC`),
    db.flowVersion.findMany({ where: { workspaceId: input.workspaceId, flowId }, select: { id: true, versionNumber: true, graphJson: true } }),
  ]);
  const labels = new Map<string, Map<string, string>>(); for (const version of versions) labels.set(version.id, new Map(((version.graphJson as any)?.nodes ?? []).map((node: any) => [node.id, node.label ?? node.type ?? node.id])));
  const named = (rows: any[]) => rows.map(row => ({ ...row, value: number(row.value), nodeLabel: row.nodeId ? labels.get(row.flowVersionId)?.get(row.nodeId) ?? row.nodeId : null, nextNodeLabel: row.nextNodeId ? labels.get(row.flowVersionId)?.get(row.nextNodeId) ?? row.nextNodeId : null }));
  return { versions: versions.map((version: any) => ({ id: version.id, versionNumber: version.versionNumber })), runStates: named(states), nodePerformance: named(nodes), branchOutcomes: named(branches), exitReasons: named(exits), policyReasons: named(policies) };
}
