import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell } from "../../../components/app-shell";
import { WorkspaceAccessGuard } from "../../../components/workspace-access-guard";
export default async function WorkspaceLayout({children,params}:{children:ReactNode;params:Promise<{workspaceId:string}>}){const {workspaceId}=await params;const sidebarCompact=(await cookies()).get("velivoo-sidebar-compact")?.value==="true";return <WorkspaceAccessGuard workspaceId={workspaceId}><AppShell workspaceId={workspaceId} initialSidebarCompact={sidebarCompact}>{children}</AppShell></WorkspaceAccessGuard>}
