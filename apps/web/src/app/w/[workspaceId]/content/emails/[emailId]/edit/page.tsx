import { EmailEditor } from "../../../../../../../components/content/email-editor";
export default async function EmailEditorPage({params}:{params:Promise<{workspaceId:string;emailId:string}>}){const {workspaceId,emailId}=await params;return <EmailEditor workspaceId={workspaceId} emailId={emailId}/>}
