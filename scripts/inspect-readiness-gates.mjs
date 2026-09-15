import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const workspaceId = '87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b';

const gates = await p.phase0GateEvidence.findMany({
  where: {
    checkKey: {
      in: [
        'real.sns.signature',
        'real.sns.subscription',
        'real.feedback.endpoint',
        'real.unsubscribe.endpoint',
      ],
    },
  },
});
const provider = await p.workspaceProviderConfig.findFirst({
  where: { workspaceId, provider: 'ses' },
});
const domain = await p.senderDomain.findFirst({
  where: { workspaceId, domain: 'lahorixsolutions.com' },
  select: { readinessReasons: true, readinessStatus: true, lifecycleState: true },
});

console.log(JSON.stringify({ gates, provider, domain }, null, 2));
await p.$disconnect();
