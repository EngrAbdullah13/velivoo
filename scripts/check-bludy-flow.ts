import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const flowId = "c9c9b5d1-28a0-44c0-9e3f-33ad89a9e71d";

const f = await db.flow.findFirst({ where: { id: flowId } });
const deps = await db.flowTriggerDependency.findMany({ where: { flowId } });
console.log(
  JSON.stringify(
    {
      status: f?.status,
      activeVersionId: f?.activeVersionId,
      activeVersionActivatedAt: f?.activeVersionActivatedAt,
      entryState: f?.entryState,
      deps,
    },
    null,
    2,
  ),
);
await db.$disconnect();
