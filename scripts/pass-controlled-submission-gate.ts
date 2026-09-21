import { randomUUID } from "node:crypto";
import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";

let latest = await prisma.message.findFirst({
  where: { state: { in: ["submitted", "delivered"] }, sourceType: { not: "test" } },
  orderBy: { submittedAt: "desc" },
  select: { id: true, workspaceId: true, submittedAt: true, state: true, sourceType: true },
});

if (!latest?.submittedAt) {
  latest = await prisma.message.findFirst({
    where: { state: { in: ["submitted", "delivered"] } },
    orderBy: { submittedAt: "desc" },
    select: { id: true, workspaceId: true, submittedAt: true, state: true, sourceType: true },
  });
}

if (!latest?.submittedAt) {
  console.error("No submitted message found. Send a test email from Content first.");
  process.exit(1);
}

await prisma.phase2GateEvidence.upsert({
  where: { checkKey: "controlled_submission" },
  create: {
    id: randomUUID(),
    checkKey: "controlled_submission",
    status: "passed",
    evidenceJson: {
      messageId: latest.id,
      workspaceId: latest.workspaceId,
      sourceType: latest.sourceType,
      messageState: latest.state,
      submittedAt: latest.submittedAt.toISOString(),
      recordedBy: "pass-controlled-submission-gate.ts",
    },
  },
  update: {
    status: "passed",
    evidenceJson: {
      messageId: latest.id,
      workspaceId: latest.workspaceId,
      sourceType: latest.sourceType,
      messageState: latest.state,
      submittedAt: latest.submittedAt.toISOString(),
      recordedBy: "pass-controlled-submission-gate.ts",
    },
    checkedAt: new Date(),
  },
});

console.log("controlled_submission gate is now passed.");
await prisma.$disconnect();
