import { ProfileDetailPanel } from "../../../../../components/profile-detail-panel";
export default async function ProfileDetailPage({params}:{params:Promise<{workspaceId:string;profileId:string}>}){const {workspaceId,profileId}=await params;return <ProfileDetailPanel workspaceId={workspaceId} profileId={profileId}/>}
