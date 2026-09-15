import { AnalyticsConsole } from "../../../../components/analytics-console";
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <AnalyticsConsole workspaceId={workspaceId}/>}
