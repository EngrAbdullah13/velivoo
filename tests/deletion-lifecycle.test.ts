import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPhase1Repository } from '../packages/persistence/src/prisma/phase1-repository.js';
import { PrismaPhase3Repository } from '../packages/persistence/src/prisma/phase3-repository.js';

const workspaceId = '11111111-1111-1111-1111-111111111111';
const resourceId = '22222222-2222-2222-2222-222222222222';

test('deleting a list hides it without erasing membership history', async () => {
  let update: { where: Record<string, unknown>; data: Record<string, unknown> } | undefined;
  let readWhere: Record<string, unknown> | undefined;
  const db = {
    audienceList: {
      updateMany: async (args: typeof update) => { update = args; return { count: 1 }; },
      findFirst: async (args: { where: Record<string, unknown> }) => { readWhere = args.where; return null; },
      findMany: async () => [],
    },
    listMembership: { deleteMany: async () => { throw new Error('membership history must remain'); } },
  } as unknown as ConstructorParameters<typeof PrismaPhase1Repository>[0];
  const repo = new PrismaPhase1Repository(db);
  await repo.deleteList(workspaceId, resourceId);
  assert.deepEqual(update?.where, { id: resourceId, workspaceId, status: { not: 'deleted' } });
  assert.equal(update?.data.status, 'deleted');
  assert.equal(await repo.findList(workspaceId, resourceId), null);
  assert.deepEqual(readWhere, { id: resourceId, workspaceId, status: { not: 'deleted' } });
});

test('deleted flows are unavailable to the editing and runtime repository', async () => {
  let where: Record<string, unknown> | undefined;
  const db = { flow: { findFirst: async (args: { where: Record<string, unknown> }) => { where = args.where; return null; } } } as unknown as ConstructorParameters<typeof PrismaPhase3Repository>[0];
  const repo = new PrismaPhase3Repository(db);
  assert.equal(await repo.flow(workspaceId, resourceId), null);
  assert.deepEqual(where, { id: resourceId, workspaceId, status: { not: 'deleted' } });
});
