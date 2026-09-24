import { SettingsConsole } from "../../../../../components/settings-console";
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <SettingsConsole workspaceId={workspaceId} section="audit-log"/>}
