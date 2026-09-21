import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const config = loadEmailPlatformConfig();

const [workspace, senders, domains, readiness, heldMessages] = await Promise.all([
  prisma.workspace.findFirst({ where: { id: ws } }),
  prisma.senderIdentity.findMany({ where: { workspaceId: ws } }),
  prisma.senderDomain.findMany({ where: { workspaceId: ws } }),
  prisma.workspaceReadinessCheck.findMany({ where: { workspaceId: ws } }),
  prisma.message.findMany({
    where: { workspaceId: ws, state: "held" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, profileId: true, state: true, policyDecision: true, createdAt: true },
  }),
]);

console.log(
  JSON.stringify(
    {
      config: {
        emailProvider: config.emailProvider,
        emailSendEnabled: config.emailSendEnabled,
        runtimeMode: config.runtimeMode,
        awsSesRegion: config.awsSesRegion,
        credentialSource: config.credentialSource,
      },
      workspace: workspace
        ? {
            name: workspace.name,
            sendingEnabled: workspace.sendingEnabled,
            senderReady: workspace.senderReady,
            status: workspace.status,
          }
        : null,
      senders,
      domains,
      readiness,
      heldMessages,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
