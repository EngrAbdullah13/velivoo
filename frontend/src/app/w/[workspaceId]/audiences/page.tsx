import {AudienceOverview} from '../../../../components/audience-overview';
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <AudienceOverview workspaceId={workspaceId}/>}
