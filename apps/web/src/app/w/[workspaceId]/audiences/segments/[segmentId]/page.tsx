import {SegmentManager} from '../../../../../../components/automation/segment-manager';
export default async function Page({params}:{params:Promise<{workspaceId:string;segmentId:string}>}){const {workspaceId,segmentId}=await params;return <SegmentManager workspaceId={workspaceId} segmentId={segmentId}/>}
