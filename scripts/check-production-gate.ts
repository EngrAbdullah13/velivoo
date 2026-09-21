import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const gates = await prisma.phase2GateEvidence.findMany();
const submitted = await prisma.message.count({ where: { state: { in: ["submitted", "delivered"] } } });
console.log(JSON.stringify({ gates, submittedOrDeliveredMessages: submitted }, null, 2));
await prisma.$disconnect();
