import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

const flowId = "53baaab5-b259-4808-a311-e842a241b727";
const [flow, gate, readiness] = await Promise.all([
  prisma.flow.findFirst({
    where: { id: flowId },
    select: { id: true, name: true, status: true, activeVersionId: true, rowVersion: true },
  }),
  prisma.phase2GateEvidence.findUnique({ where: { checkKey: "controlled_submission" } }),
  prisma.workspaceReadinessCheck.findMany({
    where: { workspaceId: "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b" },
    select: { checkKey: true, status: true },
  }),
]);
console.log(JSON.stringify({ flow: flow ? { ...flow, rowVersion: String(flow.rowVersion) } : null, gate, readiness }, null, 2));
await prisma.$disconnect();
