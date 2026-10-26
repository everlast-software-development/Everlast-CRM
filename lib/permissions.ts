/**
 * Client-side mirror of the server's permission vocabulary.
 *
 * The server owns authorization — config/permissions.js is the single source of
 * truth, and every guarded route enforces it. This file exists only so the UI
 * can decide what to *show*, using the same words the server uses to decide
 * what to *allow*. Hiding a button the server would reject is a courtesy;
 * showing one it would reject is a bug, and gating on the server's own array
 * is what keeps the two from drifting.
 *
 * The rule this replaces: `user.role === "ADMIN"`. That was accurate while
 * ADMIN and AGENT were the only roles, and became wrong the moment MARKETING
 * arrived — a marketer who can author campaigns server-side would still have
 * seen "Admin access only" on every screen that asked about the role instead of
 * the capability.
 */

export type Permission =
  | "conversation:read" | "conversation:write" | "conversation:assign"
  | "message:send" | "message:delete_own"
  | "contact:read" | "contact:write" | "contact:import"
  | "contact:delete" | "contact:bulk_delete"
  | "list:read" | "list:write"
  | "segment:read" | "segment:write"
  | "template:read" | "template:write" | "template:send_marketing"
  | "campaign:read" | "campaign:write" | "campaign:send" | "campaign:control"
  | "media:upload" | "media:read" | "media:write"
  | "user:read" | "user:write"
  | "stats:read" | "stats:team" | "stats:marketing" | "audit:read" | "clinic:read"
  | "number:read" | "number:use_any" | "number:write"
  | "settings:write"
  | "team:supervise"
  | "optout:lift"
  | "dev:tools";

/** Whatever shape the caller has on hand — /users/me, or a cached login user. */
type PermissionBearer = { permissions?: string[] | null } | null | undefined;

/**
 * Does this user hold every permission listed?
 *
 * Fails closed: a user still loading, or one served by an older API build that
 * doesn't send the array yet, holds nothing. The alternative — treating an
 * absent array as "allow" — would flash admin controls at every viewer for the
 * moment before /users/me resolves.
 */
export function can(user: PermissionBearer, ...required: Permission[]): boolean {
  const held = user?.permissions;
  if (!Array.isArray(held)) return false;
  return required.every((p) => held.includes(p));
}

/** True when the user holds at least one of these — for "show if they can do any of". */
export function canAny(user: PermissionBearer, ...required: Permission[]): boolean {
  const held = user?.permissions;
  if (!Array.isArray(held)) return false;
  return required.some((p) => held.includes(p));
}

/**
 * Where a user should land after login — the first screen their permissions
 * actually open. The app's default landing is the Inbox, but a role without
 * inbox access (MARKETING) would otherwise log in straight onto an
 * "access denied" page.
 */
export function homePathFor(user: PermissionBearer): string {
  if (can(user, "conversation:write")) return "/chats";
  if (can(user, "campaign:read")) return "/campaigns";
  if (can(user, "contact:read")) return "/customers";
  if (can(user, "stats:read")) return "/dashboard";
  return "/chats";
}
