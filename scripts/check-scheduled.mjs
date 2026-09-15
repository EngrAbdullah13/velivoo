import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const a = await p.scheduledAction.findFirst({ where: { deduplicationKey: "sender-domain.verify:1cd3f320-1c2f-4c93-9f82-28a23f45ea10" } });
console.log(JSON.stringify({ state: a?.state, dueAt: a?.dueAt, completedAt: a?.completedAt, reason: a?.payloadJson?.reason }, null, 2));
await p.$disconnect();
