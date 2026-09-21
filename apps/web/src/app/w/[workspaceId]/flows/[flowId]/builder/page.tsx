import { FlowBuilderV2 } from '../../../../../../components/automation/flow-builder-v2';
export default async function Page({params}:{params:Promise<{workspaceId:string;flowId:string}>}){const {workspaceId,flowId}=await params;return <FlowBuilderV2 workspaceId={workspaceId} flowId={flowId}/>}
