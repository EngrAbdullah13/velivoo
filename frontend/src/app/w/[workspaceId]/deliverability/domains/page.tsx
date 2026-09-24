import { DeliverabilityConsole } from "../../../../../components/deliverability-console";
export default async function DomainsPage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <DeliverabilityConsole workspaceId={workspaceId} view="domains"/>}
