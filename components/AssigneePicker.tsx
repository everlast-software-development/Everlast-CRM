"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, ChevronDown, UserMinus, UserRound } from "lucide-react";
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
const PRESENCE_WORD: Record<AssignableUser["status"], string> = {
  ONLINE: "online",
  ON_BREAK: "on a break",
  OFFLINE: "offline",
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
 * Who owns this conversation, and the control to change it.
 *
 * The owner decides (server rule, utils/conversationAssignment.js): the owner
 * and supervisors/admins can assign to me, hand off to someone else, or release
 * it to the Unassigned queue; an unassigned chat is anyone's. On a colleague's
 * chat an agent sees who owns it and can only take it over — while the owner
 * is on a break or offline, after confirming.
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
  // Asked "take this chat over?" — waiting for the yes.
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const canAssign = can("conversation:assign");
  const leadsTeam = can("team:supervise");
  const isMine = !!me && assignee?.id === me.id;
  // A colleague's chat, and I'm not a supervisor: I can only take it over.
  const colleagues = !!assignee && !isMine && !leadsTeam;
  // Admins oversee the inbox but never own chats (the server refuses it).
  const canOwn = !!me && me.role !== "ADMIN";

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

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  async function assign(agentId: number | null, opts: { confirmTakeover?: boolean } = {}) {
    close();
    if ((assignee?.id ?? null) === agentId) return;
    setSaving(true);
    try {
      await apiAssignConversation(conversationId, agentId, { agentId: assignee?.id ?? null }, opts);
      if (opts.confirmTakeover) toast.success("You've taken this chat over");
    } catch (err) {
      if (err instanceof ApiError) {
        // A colleague reassigned it a moment ago: nothing was overwritten, and
        // the header already shows the new owner (live update).
        if (err.code === "ASSIGNMENT_CHANGED" || err.code === "OWNER_ONLINE" || err.code === "NOT_YOUR_CHAT") {
          toast.info(err.message);
          return;
        }
        // The owner went away since the menu opened: ask now.
        if (err.code === "TAKEOVER_CONFIRM") {
          setOpen(true);
          setConfirming(true);
          return;
        }
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
  // The owner's presence, from the same list (null while it loads).
  const ownerStatus = assignee ? (people?.find((p) => p.id === assignee.id)?.status ?? null) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
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
          <div className="fixed inset-0 z-[60]" onClick={close} />
          {colleagues && assignee ? (
            <ColleagueMenu
              owner={assignee}
              ownerStatus={ownerStatus}
              loading={people === null}
              canOwn={canOwn}
              confirming={confirming}
              onTakeOver={() => setConfirming(true)}
              onConfirm={() => me && assign(me.id, { confirmTakeover: true })}
              onCancel={close}
            />
          ) : (
            <div
              role="listbox"
              aria-label="Assign conversation"
              className="absolute right-0 top-10 z-[61] w-[240px] max-h-[60vh] overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-lg py-1.5"
            >
              {canOwn && !isMine && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => me && assign(me.id)}
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
                    <UserMinus className="w-4 h-4" /> {isMine ? "Release to the queue" : "Unassign"}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// What an agent sees on a colleague's chat: who owns it, and taking it over —
// only while the owner is away, after a yes.
function ColleagueMenu({
  owner, ownerStatus, loading, canOwn, confirming, onTakeOver, onConfirm, onCancel,
}: {
  owner: NonNullable<Assignee>;
  ownerStatus: AssignableUser["status"] | null;
  loading: boolean;
  canOwn: boolean;
  confirming: boolean;
  onTakeOver: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = displayName(owner);
  const online = ownerStatus === "ONLINE";
  return (
    <div role="dialog" aria-label="Chat owner" className="absolute right-0 top-10 z-[61] w-[260px] bg-white border border-gray-100 rounded-xl shadow-lg p-3">
      <div className="flex items-center gap-2.5">
        <span className="relative shrink-0">
          <span className="w-8 h-8 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">{initials(owner)}</span>
          {ownerStatus && <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${PRESENCE_DOT[ownerStatus]}`} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-gray-800 truncate">{name}&apos;s chat</span>
          <span className="block text-[11.5px] text-gray-400">
            {loading ? "Checking if they're around…" : ownerStatus ? `${name} is ${PRESENCE_WORD[ownerStatus]}` : "Owner"}
          </span>
        </span>
      </div>
      <p className="text-[11.5px] text-gray-500 leading-snug mt-2.5">
        Only {name} or a supervisor can hand this chat to someone else or change its follow-up. You can still read and reply.
      </p>

      {canOwn && (
        confirming ? (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5">
            <p className="text-[12px] text-amber-800 leading-snug">
              Take this chat over from {name}? It moves to your chats, and the switch is recorded.
            </p>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={onConfirm} className="flex-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-[#2f5540] cursor-pointer">
                Take it over
              </button>
              <button type="button" onClick={onCancel} className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:bg-white cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onTakeOver}
              disabled={loading || online}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-[12.5px] font-semibold px-3 py-2 rounded-lg border border-brand/30 bg-brand-100 text-brand-fg hover:bg-brand-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Take over
            </button>
            {online && (
              <p className="text-[11px] text-gray-400 mt-1.5 text-center">
                {name} is online — ask them to hand it over, or ask a supervisor.
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
