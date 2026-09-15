import { InfrastructureReadiness } from "../../../../../components/infrastructure-readiness";

export default async function Page({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;
  return <InfrastructureReadiness workspaceId={workspaceId}/>;
}
