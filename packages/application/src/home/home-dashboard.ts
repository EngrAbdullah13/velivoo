export type HomeSeverity = "critical" | "high" | "medium" | "low";
export type HomeAction = { label: string; href: string; available: boolean };

export type HomeRecommendation = {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  title: string;
  description: string;
  action: HomeAction;
};

export type HomeIssueInput = {
  id: string;
  type: string;
  severity: HomeSeverity;
  title: string;
  description: string;
  href: string;
  affectedCount?: number;
  firstOccurredAt?: Date;
  lastOccurredAt?: Date;
};

export function homePeriod(input: string | null | undefined, now = new Date()) {
  const requested = Number(input ?? 7);
  const days = Number.isInteger(requested) && [1, 7, 30].includes(requested) ? requested : 7;
  return { days, from: new Date(now.getTime() - days * 86_400_000), to: now };
}

export function homeRecommendations(input: {
  readinessReady: boolean;
  profileCount: number;
  listCount: number;
  segmentCount: number;
  emailCount: number;
  publishedEmailCount: number;
  flowCount: number;
  draftFlowCount: number;
  activeFlowCount: number;
  activeHoldCount: number;
  failedImportCount: number;
  workspaceId: string;
  canManageOperations: boolean;
}): HomeRecommendation[] {
  const w = input.workspaceId;
  const actions: HomeRecommendation[] = [];
  if (!input.readinessReady) actions.push({ id: "complete-readiness", priority: "P0", title: "Complete sending setup", description: "Production sending stays locked until every required readiness check has evidence.", action: { label: "Review readiness", href: `/w/${w}/home`, available: true } });
  if (input.activeHoldCount) actions.push({ id: "review-hold", priority: "P0", title: "Review active sending hold", description: `${input.activeHoldCount} operational hold${input.activeHoldCount === 1 ? " is" : "s are"} restricting delivery.`, action: { label: input.canManageOperations ? "Review hold" : "View deliverability", href: `/w/${w}/deliverability/overview`, available: input.canManageOperations } });
  if (input.failedImportCount) actions.push({ id: "review-import", priority: "P1", title: "Resolve import issues", description: `${input.failedImportCount} import${input.failedImportCount === 1 ? " needs" : "s need"} review.`, action: { label: "Review imports", href: `/w/${w}/imports`, available: true } });
  if (!input.profileCount) actions.push({ id: "import-profiles", priority: "P2", title: "Import profiles", description: "Add real audience records before creating a marketing audience.", action: { label: "Import profiles", href: `/w/${w}/imports`, available: true } });
  else if (!input.listCount) actions.push({ id: "create-list", priority: "P2", title: "Create a list", description: "Organize profiles into a reusable static audience. List membership does not grant consent.", action: { label: "Create list", href: `/w/${w}/audiences/lists`, available: true } });
  else if (!input.segmentCount) actions.push({ id: "create-segment", priority: "P2", title: "Create a segment", description: "Build a rule-based audience from the data already in this workspace.", action: { label: "Create segment", href: `/w/${w}/audiences/segments`, available: true } });
  if (!input.emailCount) actions.push({ id: "create-email", priority: "P2", title: "Create an email", description: "Create and preflight the first email before using it in a flow.", action: { label: "Create email", href: `/w/${w}/content/emails`, available: true } });
  else if (!input.publishedEmailCount) actions.push({ id: "publish-email", priority: "P1", title: "Complete email preflight", description: "Publish a preflighted email version before activating an email flow.", action: { label: "Open emails", href: `/w/${w}/content/emails`, available: true } });
  if (!input.flowCount && input.publishedEmailCount) actions.push({ id: "create-flow", priority: "P2", title: "Create a flow", description: "Turn published content into a tested automated journey.", action: { label: "Create flow", href: `/w/${w}/flows`, available: true } });
  else if (input.draftFlowCount) actions.push({ id: "continue-flow", priority: "P1", title: "Continue a draft flow", description: `${input.draftFlowCount} draft flow${input.draftFlowCount === 1 ? " needs" : "s need"} validation or simulation.`, action: { label: "Open flows", href: `/w/${w}/flows`, available: true } });
  else if (!input.activeFlowCount && input.publishedEmailCount) actions.push({ id: "simulate-flow", priority: "P2", title: "Simulate a flow", description: "Validate a journey before it can accept production entries.", action: { label: "Open flows", href: `/w/${w}/flows`, available: true } });
  return actions.slice(0, 5);
}

export function homeIssue(input: HomeIssueInput) {
  return { ...input, status: "open" as const, affectedCount: input.affectedCount ?? 1, firstOccurredAt: input.firstOccurredAt ?? null, lastOccurredAt: input.lastOccurredAt ?? null, action: { label: "Review", href: input.href, available: true } };
}
