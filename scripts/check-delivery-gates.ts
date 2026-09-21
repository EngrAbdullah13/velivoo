import { prisma } from "../packages/persistence/src/prisma/phase0-client.js";
import { PrismaPhase1Repository } from "../packages/persistence/src/prisma/phase1-repository.js";

const ws = "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const repo = new PrismaPhase1Repository(prisma);

const [operational, gates, provider, route, domain] = await Promise.all([
  repo.workspaceOperationalReadiness(ws),
  prisma.phase0GateEvidence.findMany({
    where: {
      checkKey: {
        in: [
          "real.sns.signature",
          "real.sns.subscription",
          "real.feedback.endpoint",
          "real.unsubscribe.endpoint",
          "controlled_submission",
        ],
      },
    },
  }),
  prisma.workspaceProviderConfig.findFirst({ where: { workspaceId: ws } }),
  prisma.emailDeliveryRoute.findFirst({
    where: { workspaceId: ws, senderDomainId: "1cd3f320-1c2f-4c93-9f82-28a23f45ea10" },
  }),
  prisma.senderDomain.findFirst({ where: { id: "1cd3f320-1c2f-4c93-9f82-28a23f45ea10" } }),
]);

console.log(
  JSON.stringify(
    {
      domain: domain
        ? {
            domain: domain.domain,
            readinessStatus: domain.readinessStatus,
            readinessReasons: domain.readinessReasons,
            authenticationStatus: domain.authenticationStatus,
          }
        : null,
      route: route
        ? { status: route.status, holdReason: route.holdReason, configurationSetName: route.configurationSetName }
        : null,
      provider,
      operational,
      gates,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
