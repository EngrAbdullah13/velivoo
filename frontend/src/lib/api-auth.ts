import { apiBaseUrl } from "./api-url";

export function apiAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("emailPlatformAccessToken") : null;
  if (token) return { authorization: `Bearer ${token}` };
  if (process.env.NEXT_PUBLIC_EMAIL_PLATFORM_LOCAL_PASSWORD_AUTH_ENABLED === "true") return {};
  const devUser = process.env.NEXT_PUBLIC_EMAIL_PLATFORM_DEV_USER ?? "dev-owner";
  return { "x-dev-user": devUser };
}

export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/Diagnostic code: ([A-Z0-9_]+)$/);
  return match?.[1] ?? null;
}

export async function redirectForWorkspaceAccessFailure(workspaceId: string, error: unknown): Promise<boolean> {
  const code = apiErrorCode(error);
  if (code !== "WORKSPACE_ACCESS_DENIED" && code !== "AUTH_REQUIRED") return false;
  if (typeof window === "undefined") return false;

  if (code === "AUTH_REQUIRED") {
    window.location.href = "/login";
    return true;
  }

  try {
    const base = apiBaseUrl();
    const response = await fetch(`${base}/api/v1/me/workspaces`, {
      credentials: "include",
      headers: { "content-type": "application/json", ...apiAuthHeaders() },
      cache: "no-store",
    });
    if (!response.ok) {
      window.location.href = "/login";
      return true;
    }
    const data = (await response.json()) as { items?: Array<{ id: string }> };
    const items = data.items ?? [];
    const target = items.find((item) => item.id === workspaceId) ?? items[0];
    if (target?.id && target.id !== workspaceId) {
      const suffix = window.location.pathname.replace(`/w/${workspaceId}`, "") || "/home";
      window.location.href = `/w/${target.id}${suffix}`;
      return true;
    }
    if (!items.length) {
      window.location.href = "/login";
      return true;
    }
  } catch {
    window.location.href = "/login";
    return true;
  }

  return false;
}
