import { ProfileManager } from "../../../../components/profile-manager";
export default async function ProfilesPage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <ProfileManager workspaceId={workspaceId}/>}
