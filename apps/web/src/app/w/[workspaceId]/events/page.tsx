import {EventExplorer} from '../../../../components/automation/event-explorer';
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <section><h1>Generic events</h1><EventExplorer workspaceId={workspaceId}/></section>}
