import {FlowBuilder} from '../../../../../../components/automation/flow-builder';
import {FlowEditorRail} from '../../../../../../components/automation/flow-editor-rail';
export default async function Page({params}:{params:Promise<{workspaceId:string;flowId:string}>}){const {workspaceId,flowId}=await params;return <div className="flow-editor-page"><FlowEditorRail workspaceId={workspaceId} flowId={flowId}/><FlowBuilder workspaceId={workspaceId} flowId={flowId}/></div>}
