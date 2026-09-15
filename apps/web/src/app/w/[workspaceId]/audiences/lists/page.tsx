import { ListManager } from "../../../../../components/list-manager";
export default async function ListsPage({params}:{params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;return <ListManager workspaceId={workspaceId}/>}
