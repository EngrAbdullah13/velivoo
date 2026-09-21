import { FlowActivityV2 } from '../../../../../../components/automation/flow-activity-v2';
export default async function Page({params}:{params:Promise<{workspaceId:string;flowId:string}>}){const {workspaceId,flowId}=await params;return <FlowActivityV2 workspaceId={workspaceId} flowId={flowId}/>}
