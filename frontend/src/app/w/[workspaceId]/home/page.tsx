import { HomeDashboard } from '../../../../components/home-dashboard';

type Props={params:Promise<{workspaceId:string}>};
export default async function HomePage({params}:Props){const {workspaceId}=await params;return <div className="home-page"><HomeDashboard workspaceId={workspaceId}/></div>}
