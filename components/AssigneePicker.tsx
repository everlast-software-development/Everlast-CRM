"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, UserMinus, UserRound } from "lucide-react";
import { ApiError, apiAssignConversation, apiGetAssignableUsers } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import type { AssignableUser } from "@/types";

type Assignee = { id: number; name?: string | null; username: string } | null;

const PRESENCE_DOT: Record<AssignableUser["status"], string> = {
  ONLINE: "bg-green-500",
  ON_BREAK: "bg-amber-400",
  OFFLINE: "bg-gray-300",
};

function displayName(u: { name?: string | null; username: string }): string {
  return u.name || u.username;
}

function initials(u: { name?: string | null; username: string }): string {
  return displayName(u)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Who owns this conversation, and the control to change it: assign to me, hand
 * off to another agent, or release it back to the Unassigned queue.
 *
 * The same menu pattern as NumberSwitcher (click-away layer, Escape to close,
 * listbox semantics). The list is fetched when the menu opens, from
 * /users/assignable — only active people whose role can reply, online first.
 * The header updates itself: the server's `conversation.assigned` event patches
 * the conversation list this page reads from.
 */
export function AssigneePicker({ conversationId, assignee }: { conversationId: string; assignee: Assignee }) {
  const { me, can } = useCurrentUser();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<AssignableUser[] | null>(null);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const canAssign = can("conversation:assign");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiGetAssignableUsers()
      .then((res) => { if (!cancelled) setPeople(res.data); })
      .catch(() => { if (!cancelled) setPeople([]); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [open]);

  async function assign(agentId: number | null) {
    setOpen(false);
    if ((assignee?.id ?? null) === agentId) return;
    setSaving(true);
    try {
      await apiAssignConversation(conversationId, agentId, { agentId: assignee?.id ?? null });
    } catch (err) {
      // A colleague reassigned it a moment ago: nothing was overwritten, and
      // the header already shows the new owner (live update).
      if (err instanceof ApiError && err.code === "ASSIGNMENT_CHANGED") {
        toast.info(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Couldn't change the assignee");
    } finally {
      setSaving(false);
    }
  }

  const label = assignee ? displayName(assignee) : "Unassigned";

  // Read-only for anyone who can't assign — they still see who owns it.
  if (!canAssign) {
    return (
      <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
        {assignee ? `@ ${label}` : "Unassigned"}
      </span>
    );
  }

  const others = (people ?? []).filter((p) => p.id !== me?.id);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={assignee ? `Assigned to ${label}` : "Nobody owns this conversation"}
        className={`flex items-center gap-1.5 h-8 pl-1 pr-2 rounded-full border text-[12px] font-medium transition-colors disabled:cursor-wait ${
          assignee
            ? "border-gray-200 text-gray-700 hover:bg-gray-50"
            : "border-dashed border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
      >
        {saving ? (
          <span className="w-6 h-6 flex items-center justify-center"><Spinner size="xs" label="Assigning" /></span>
        ) : assignee ? (
          <span className="w-6 h-6 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
            {initials(assignee)}
          </span>
        ) : (
          <span className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
            <UserRound className="w-3.5 h-3.5" />
          </span>
        )}
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Assign conversation"
            className="absolute right-0 top-10 z-[61] w-[240px] max-h-[60vh] overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-lg py-1.5"
          >
            {/* Admins oversee the inbox but never own chats (the server refuses it). */}
            {me && me.role !== "ADMIN" && assignee?.id !== me.id && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => assign(me.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-brand-fg hover:bg-brand-100"
              >
                <UserRound className="w-4 h-4" /> Assign to me
              </button>
            )}

            <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Team</p>
            {people === null ? (
              <div className="flex justify-center py-3"><Spinner size="sm" label="Loading team" /></div>
            ) : others.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-gray-400">No one else can take conversations.</p>
            ) : (
              others.map((p) => {
                const isCurrent = assignee?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => assign(p.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${isCurrent ? "bg-brand-100" : "hover:bg-gray-50"}`}
                  >
                    <span className="relative shrink-0">
                      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center">
                        {initials(p)}
                      </span>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white ${PRESENCE_DOT[p.status]}`} />
                    </span>
                    <span className="flex-1 min-w-0 text-[13px] text-gray-700 truncate">{displayName(p)}</span>
                    {isCurrent && <Check className="w-4 h-4 text-brand-fg shrink-0" />}
                  </button>
                );
              })
            )}

            {assignee && (
              <div className="border-t border-gray-100 mt-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => assign(null)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-gray-500 hover:bg-gray-50"
                >
                  <UserMinus className="w-4 h-4" /> Unassign
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
