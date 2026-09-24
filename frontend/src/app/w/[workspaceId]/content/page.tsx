import { redirect } from "next/navigation";

export default async function ContentPage({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;
  redirect(`/w/${workspaceId}/content/templates`);
}
