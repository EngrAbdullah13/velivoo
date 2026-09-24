import { TemplateLibrary } from "../../../../../components/content/template-library";

export default async function TemplatesPage({params}:{params:Promise<{workspaceId:string}>}){
  const {workspaceId}=await params;
  return <TemplateLibrary workspaceId={workspaceId}/>;
}
