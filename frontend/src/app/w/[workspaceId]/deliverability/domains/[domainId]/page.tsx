import { DeliverabilityConsole } from "../../../../../../components/deliverability-console";

export default async function DomainDetailPage({ params }: { params: Promise<{ workspaceId: string; domainId: string }> }) {
  const { workspaceId, domainId } = await params;
  return <DeliverabilityConsole workspaceId={workspaceId} view="domainDetail" initialDomainId={domainId}/>;
}
