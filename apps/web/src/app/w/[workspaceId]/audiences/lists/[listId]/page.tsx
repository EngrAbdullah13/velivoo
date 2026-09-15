import { ListDetailPanel } from "../../../../../../components/list-detail-panel";
export default async function ListDetailPage({params}:{params:Promise<{workspaceId:string;listId:string}>}){const {workspaceId,listId}=await params;return <ListDetailPanel workspaceId={workspaceId} listId={listId}/>}
