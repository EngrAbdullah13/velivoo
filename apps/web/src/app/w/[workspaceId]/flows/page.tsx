import {FlowManager} from '../../../../components/automation/flow-manager';
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <FlowManager workspaceId={workspaceId}/>}
