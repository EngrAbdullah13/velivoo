import {SegmentManager} from '../../../../../components/automation/segment-manager';
export default async function Page({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <SegmentManager workspaceId={workspaceId}/>}
