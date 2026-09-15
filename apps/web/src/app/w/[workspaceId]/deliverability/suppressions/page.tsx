import { DeliverabilityConsole } from "../../../../../components/deliverability-console";
export default async function SuppressionsPage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <DeliverabilityConsole workspaceId={workspaceId} view="suppressions"/>}
