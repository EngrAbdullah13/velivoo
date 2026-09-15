import { ContentAssets } from "../../../../../components/content/content-assets";

export default async function ContentAssetsPage({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;
  return <ContentAssets workspaceId={workspaceId}/>;
}
