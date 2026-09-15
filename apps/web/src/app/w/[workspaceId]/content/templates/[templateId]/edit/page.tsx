import { TemplateEditor } from "../../../../../../../components/content/template-editor";

export default async function TemplateEditorPage({params}:{params:Promise<{workspaceId:string;templateId:string}>}){
  const {workspaceId,templateId}=await params;
  return <TemplateEditor workspaceId={workspaceId} templateId={templateId}/>;
}
