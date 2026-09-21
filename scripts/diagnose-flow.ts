import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ws = process.argv[2] ?? "87a5ebc0-ac21-4c02-b32b-d5eb9f0a882b";
const flowQuery = process.argv[3] ?? "bludy";

const flows = flowQuery.includes("-")
  ? await db.flow.findMany({ where: { workspaceId: ws, id: flowQuery } })
  : await db.flow.findMany({
      where: { workspaceId: ws, name: { contains: flowQuery, mode: "insensitive" } },
    });

for (const flow of flows) {
  const [version, deps, runs, messages] = await Promise.all([
    flow.activeVersionId
      ? db.flowVersion.findFirst({ where: { id: flow.activeVersionId } })
      : null,
    db.flowTriggerDependency.findMany({ where: { workspaceId: ws, flowId: flow.id } }),
    db.flowRun.findMany({
      where: { workspaceId: ws, flowId: flow.id },
      orderBy: { enteredAt: "desc" },
      take: 10,
    }),
    db.message.findMany({
      where: {
        workspaceId: ws,
        flowRunId: {
          in: (
            await db.flowRun.findMany({
              where: { workspaceId: ws, flowId: flow.id },
              select: { id: true },
            })
          ).map((r) => r.id),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        state: true,
        profileId: true,
        flowRunId: true,
        createdAt: true,
        submittedAt: true,
        policyDecision: true,
        sourceType: true,
      },
    }),
  ]);

  const profileIds = [...new Set(messages.map((m) => m.profileId))];
  const profiles = profileIds.length
    ? await db.profile.findMany({
        where: { id: { in: profileIds } },
        select: { id: true, originalEmail: true },
      })
    : [];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const activeDep = deps.find((d) => d.flowVersionId === flow.activeVersionId);
  let listName: string | null = null;
  if (activeDep?.referenceId) {
    const list = await db.audienceList.findFirst({
      where: { id: activeDep.referenceId },
      select: { name: true },
    });
    listName = list?.name ?? null;
  }

  const deliveryEvents = messages.length
    ? await db.deliveryEvent.findMany({
        where: { workspaceId: ws, messageId: { in: messages.map((m) => m.id) } },
        orderBy: { occurredAt: "desc" },
      })
    : [];

  console.log(
    JSON.stringify(
      {
        flow: {
          id: flow.id,
          name: flow.name,
          status: flow.status,
          entryState: flow.entryState,
          activeVersionId: flow.activeVersionId,
        },
        liveTrigger: (version?.graphJson as any)?.trigger ?? null,
        liveListName: listName,
        runs: runs.map((r) => ({
          id: r.id,
          state: r.state,
          profileId: r.profileId,
          enteredAt: r.enteredAt,
          endedAt: r.endedAt,
          exitReason: r.exitReason,
        })),
        messages: messages.map((m) => ({
          id: m.id,
          email: profileById.get(m.profileId)?.originalEmail,
          state: m.state,
          policy: m.policyDecision,
          submittedAt: m.submittedAt,
          delivery: deliveryEvents.filter((e) => e.messageId === m.id).map((e) => e.eventType),
        })),
        summary: {
          runs: runs.length,
          completed: runs.filter((r) => r.state === "completed").length,
          messages: messages.length,
          submitted: messages.filter((m) => m.submittedAt).length,
          delivered: deliveryEvents.filter((e) => e.eventType === "delivered").length,
          held: messages.filter((m) => m.state === "held").length,
          skipped: messages.filter((m) => m.state === "skipped").length,
        },
      },
      null,
      2,
    ),
  );
}

await db.$disconnect();
