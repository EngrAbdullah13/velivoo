import { ImportManager } from "../../../../components/import-manager";
export default async function ImportsPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{targetListId?:string}>}){const [{workspaceId},{targetListId}]=await Promise.all([params,searchParams]);return <ImportManager workspaceId={workspaceId} targetListId={targetListId}/>}
