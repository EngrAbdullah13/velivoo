"use client";

import { useEffect, type ReactNode } from "react";
import { phase1Api } from "../lib/phase1-api";
import { redirectForWorkspaceAccessFailure } from "../lib/api-auth";

export function WorkspaceAccessGuard({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  useEffect(() => {
    void phase1Api(`/api/v1/workspaces/${workspaceId}`).catch(async (error) => {
      await redirectForWorkspaceAccessFailure(workspaceId, error);
    });
  }, [workspaceId]);

  return children;
}
