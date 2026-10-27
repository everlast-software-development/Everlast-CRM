import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/permissions";
import type { UserRole } from "@/types";

/** Who is reading — the real user, or the role an admin is previewing. */
export interface DocCtx {
  role: UserRole;
  can: (...required: Permission[]) => boolean;
  /** True while an admin is previewing another role's guide. */
  previewing: boolean;
}

export interface DocPage {
  key: string;
  label: string;
  group: string;
  icon: LucideIcon;
  description: string;
  /** Extra words the sidebar search matches on. */
  keywords?: string;
  /** Leave out for pages everyone sees. */
  visible?: (ctx: DocCtx) => boolean;
  body: (ctx: DocCtx) => ReactNode;
}

export const ROLES: UserRole[] = ["ADMIN", "DIRECTOR", "SUPERVISOR", "AGENT", "MARKETING"];

/** The roles the guide lists and compares. Admin holds everything and isn't presented as a role. */
export const LISTED_ROLES: UserRole[] = ["DIRECTOR", "SUPERVISOR", "AGENT", "MARKETING"];

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  DIRECTOR: "Director",
  SUPERVISOR: "Supervisor",
  AGENT: "Agent",
  MARKETING: "Marketing",
};

/**
 * The server's role → permission table (config/permissions.js), copied so an
 * admin can preview the guide as another role and the Roles page can print the
 * matrix. It only decides which help pages are shown — the server still
 * decides what anyone may do. Keep in step with config/permissions.js.
 */
export const ROLE_PERMISSIONS: Record<UserRole, "*" | Permission[]> = {
  ADMIN: "*",
  MARKETING: [
    "contact:read", "contact:write", "contact:import",
    "list:read", "list:write",
    "segment:read", "segment:write",
    "template:read", "template:write",
    "campaign:read", "campaign:write", "campaign:send", "campaign:control",
    "media:read", "media:write",
    "user:read",
    "stats:read", "stats:marketing", "number:read", "number:use_any",
  ],
  SUPERVISOR: [
    "conversation:read", "conversation:write", "conversation:assign",
    "message:send", "message:delete_own",
    "contact:read", "contact:write",
    "list:read",
    "segment:read",
    "template:read", "template:send_marketing",
    "media:upload", "media:read",
    "number:read", "number:use_any",
    "team:supervise",
    "campaign:read",
    "stats:read", "stats:team",
  ],
  DIRECTOR: [
    "stats:read", "stats:team", "stats:marketing",
    "team:supervise",
    "campaign:read",
    "user:read",
    "number:read", "number:use_any",
  ],
  AGENT: [
    "conversation:read", "conversation:write", "conversation:assign",
    "message:send", "message:delete_own",
    "contact:read", "contact:write",
    "template:read",
    "media:upload", "media:read",
    "number:read", "number:use_any",
  ],
};

/** The listed roles that hold every one of these permissions, as labels (Admin is left out). */
export function rolesWith(...required: Permission[]): string[] {
  return LISTED_ROLES.filter((r) => roleCan(r)(...required)).map((r) => ROLE_LABEL[r]);
}

export function roleCan(role: UserRole) {
  const held = ROLE_PERMISSIONS[role];
  return (...required: Permission[]) => held === "*" || required.every((p) => held.includes(p));
}
