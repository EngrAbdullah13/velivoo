import { MessageTrace } from "../../../../../components/content/message-trace";
export default async function Page({params}:{params:Promise<{workspaceId:string;messageId:string}>}){const {workspaceId,messageId}=await params;return <MessageTrace workspaceId={workspaceId} messageId={messageId}/>}
