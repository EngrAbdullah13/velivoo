import { PrismaClient } from "@prisma/client";
import { deliverabilityDashboard } from "../backend/api/src/deliverability-dashboard.ts";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const workspaceId = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const prisma = new PrismaClient();
const cfg = loadEmailPlatformConfig();

try {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, status: "active" } });
  if (!member) throw new Error("NO_MEMBER");
  const dash = await deliverabilityDashboard({
    prisma,
    workspaceId,
    userId: member.userId,
    days: 30,
    brandedDomainSetupAvailable: true,
    staticBrandedSetupAvailable: true,
  });
  for (const domain of dash.domains) {
    console.log(JSON.stringify({
      domain: domain.rootDomain,
      lifecycleState: domain.lifecycleState,
      readinessStatus: domain.readinessStatus,
      readinessReasons: domain.readinessReasons,
      checks: domain.readinessChecks?.map((check) => ({ key: check.key, status: check.status })),
      records: domain.customerRecords?.map((record) => ({ purpose: record.purpose, status: record.status })),
    }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
