import { ContentOverview } from "../../../../../components/content/content-overview";
export default async function EmailsPage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <ContentOverview workspaceId={workspaceId}/>}
