export type Role = "owner" | "admin" | "marketer" | "analyst";

export const PERMISSIONS = [
  "workspace.read",
  "workspace.manage",
  "members.manage",
  "profiles.read",
  "profiles.write",
  "profiles.export",
  "consent.read",
  "consent.write",
  "suppressions.manage",
  "audiences.read",
  "audiences.write",
  "domains.read",
  "domains.manage",
  "content.read",
  "content.write",
  "content.publish",
  "flows.read",
  "flows.write",
  "flows.publish",
  "flows.activate",
  "api_keys.manage",
  "analytics.read",
  "audit.read",
  "operations.pause",
  "workspace.delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(PERMISSIONS.filter((p) => p !== "workspace.manage" && p !== "workspace.delete")),
  marketer: new Set([
    "workspace.read",
    "profiles.read",
    "profiles.write",
    "consent.read",
    "audiences.read",
    "audiences.write",
    "domains.read",
    "content.read",
    "content.write",
    "content.publish",
    "flows.read",
    "flows.write",
    "flows.publish",
    "analytics.read",
  ]),
  analyst: new Set([
    "workspace.read",
    "profiles.read",
    "consent.read",
    "audiences.read",
    "domains.read",
    "content.read",
    "flows.read",
    "analytics.read",
    "audit.read",
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`FORBIDDEN:${permission}`);
  }
}

export function permissionsForRole(role: Role): Permission[] {
  return [...rolePermissions[role]];
}
