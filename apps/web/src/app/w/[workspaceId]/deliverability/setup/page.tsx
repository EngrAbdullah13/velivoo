import { DeliverabilitySetup } from "../../../../../components/deliverability-setup";

export default async function Page({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;
  return <DeliverabilitySetup workspaceId={workspaceId}/>;
}
