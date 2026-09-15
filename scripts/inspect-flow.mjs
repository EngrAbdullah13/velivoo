import { PrismaClient } from '@prisma/client';
import { validateFlow3 } from '../dist/packages/domain/src/phase3/flow.js';

const db = new PrismaClient();
const ws = process.argv[2] ?? '87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b';
const flowId = process.argv[3] ?? '53baaab5-b259-4808-a311-e842a241b727';

const flow = await db.flow.findFirst({ where: { id: flowId, workspaceId: ws } });
if (!flow) {
  console.log('Flow not found');
  process.exit(1);
}

const graph = flow.draftGraphJson;
const structural = validateFlow3(graph);
const emailNodes = (graph.nodes ?? []).filter((n) => n.type === 'email');

const emailChecks = [];
for (const node of emailNodes) {
  const email = node.emailVersionId
    ? await db.emailVersion.findFirst({
        where: { id: node.emailVersionId, workspaceId: ws, definition: { archivedAt: null } },
        select: { id: true, publishedAt: true, preflightJson: true, versionNumber: true, definition: { select: { name: true } } },
      })
    : null;
  emailChecks.push({
    nodeId: node.id,
    mode: node.mode,
    emailVersionId: node.emailVersionId,
    found: Boolean(email),
    published: Boolean(email?.publishedAt),
    preflight: email?.preflightJson?.state ?? null,
    label: email ? `${email.definition.name} v${email.versionNumber}` : null,
  });
}

const validationRow = await db.flowValidationResult.findFirst({
  where: { flowId, workspaceId: ws },
  orderBy: { checkedAt: 'desc' },
});

console.log(JSON.stringify({
  flow: {
    id: flow.id,
    name: flow.name,
    status: flow.status,
    rowVersion: String(flow.rowVersion),
    activeVersionId: flow.activeVersionId,
    trigger: graph.trigger,
    nodeCount: graph.nodes?.length ?? 0,
    hasEnd: graph.nodes?.some((n) => n.type === 'end'),
  },
  structuralIssues: structural,
  emailChecks,
  lastValidation: validationRow
    ? { state: validationRow.state, issues: validationRow.issuesJson, checkedAt: validationRow.checkedAt }
    : null,
}, null, 2));

await db.$disconnect();
