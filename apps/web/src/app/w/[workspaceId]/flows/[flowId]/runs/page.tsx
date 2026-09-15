import {RunInspector} from '../../../../../../components/automation/run-inspector';
export default async function Page({params}:{params:Promise<{workspaceId:string;flowId:string}>}){const {workspaceId,flowId}=await params;return <section><h1>Flow runs</h1><RunInspector workspaceId={workspaceId} flowId={flowId}/></section>}
