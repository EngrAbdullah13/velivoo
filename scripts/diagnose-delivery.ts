import { PrismaClient } from "@prisma/client";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const config = loadEmailPlatformConfig();

const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const [
  messagesByState,
  recentMessages,
  deliveryEvents,
  heldMessages,
  submittedNoDelivery,
  sendPolicy,
  domain,
  readiness,
  pendingOutbox,
  pendingInbox,
] = await Promise.all([
  db.message.groupBy({
    by: ["state"],
    where: { workspaceId: ws, createdAt: { gte: since } },
    _count: { _all: true },
  }),
  db.message.findMany({
    where: { workspaceId: ws, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      state: true,
      profileId: true,
      submittedAt: true,
      createdAt: true,
      policyDecision: true,
      sourceType: true,
    },
  }),
  db.deliveryEvent.count({ where: { workspaceId: ws, occurredAt: { gte: since } } }),
  db.message.findMany({
    where: { workspaceId: ws, state: "held" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, profileId: true, policyDecision: true, createdAt: true },
  }),
  db.message.findMany({
    where: { workspaceId: ws, state: "submitted", submittedAt: { gte: since } },
    orderBy: { submittedAt: "desc" },
    take: 10,
    select: { id: true, profileId: true, submittedAt: true },
  }),
  db.sendPolicy.findFirst({ where: { workspaceId: ws }, orderBy: { version: "desc" } }),
  db.senderDomain.findFirst({
    where: { workspaceId: ws, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { domain: true, lifecycleState: true },
  }),
  db.workspaceReadinessCheck.findMany({ where: { workspaceId: ws } }),
  db.outboxEvent.count({ where: { workspaceId: ws, publishedAt: null } }),
  db.inboxMessage.count({ where: { status: { in: ["received", "processing"] } } }),
]);

const profileIds = [
  ...new Set([
    ...recentMessages.map((m) => m.profileId),
    ...heldMessages.map((m) => m.profileId),
  ]),
];
const profiles = profileIds.length
  ? await db.profile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, originalEmail: true },
    })
  : [];
const profileById = new Map(profiles.map((p) => [p.id, p.originalEmail]));

const submittedIds = submittedNoDelivery.map((m) => m.id);
const attempts = submittedIds.length
  ? await db.deliveryAttempt.findMany({
      where: { messageId: { in: submittedIds } },
      select: { messageId: true, state: true, providerMessageId: true, errorCode: true },
    })
  : [];

console.log(
  JSON.stringify(
    {
      config: {
        emailProvider: config.emailProvider,
        emailSendEnabled: config.emailSendEnabled,
        runtimeMode: config.runtimeMode,
        snsTopicArnConfigured: Boolean(config.snsTopicArn),
        publicBaseUrl: process.env.EMAIL_PLATFORM_PUBLIC_BASE_URL ?? null,
      },
      domain,
      sendPolicy: sendPolicy
        ? {
            frequencyMax: sendPolicy.frequencyMax,
            frequencyWindowSeconds: sendPolicy.frequencyWindowSeconds,
          }
        : null,
      readiness: readiness.map((r) => ({ key: r.checkKey, status: r.status })),
      messagesByState: Object.fromEntries(
        messagesByState.map((row) => [row.state, row._count._all]),
      ),
      deliveryEventsLast7Days: deliveryEvents,
      pendingOutbox,
      pendingInboxFeedback: pendingInbox,
      heldMessages: heldMessages.map((m) => ({
        id: m.id,
        email: profileById.get(m.profileId),
        reason: (m.policyDecision as any)?.reason,
        createdAt: m.createdAt,
      })),
      submittedAwaitingDeliveryFeedback: submittedNoDelivery.map((m) => ({
        id: m.id,
        email: profileById.get(m.profileId),
        submittedAt: m.submittedAt,
        attempt: attempts.find((a) => a.messageId === m.id),
      })),
      recentMessages: recentMessages.map((m) => ({
        id: m.id,
        email: profileById.get(m.profileId),
        state: m.state,
        reason: (m.policyDecision as any)?.reason,
        submittedAt: m.submittedAt,
        createdAt: m.createdAt,
      })),
    },
    null,
    2,
  ),
);

await db.$disconnect();
