"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, CalendarX, ChevronDown, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { apiSetConversationOutcome } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import type { ConversationOutcome, ConversationOutcomeState } from "@/types";
import {
  OUTCOME_CHIP, OUTCOME_LABEL, OVERDUE_CHIP,
  activeOutcome, fmtWhen, followUpPicks, isOverdue, toDateTimeInput,
} from "@/lib/chatOutcome";
import { LiftOptOutDialog, RecordOptOutDialog, isOptedOut, type OptOutState } from "@/components/OptOut";

type OutcomeBody = Parameters<typeof apiSetConversationOutcome>[1];

const inputCls = "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-brand";
const labelCls = "block text-[12px] font-semibold text-gray-500 mb-1";

/**
 * The chat's follow-up — when to get back to this patient — and the marketing
 * opt-out, in one header chip and menu. Sits beside the status and assignee
 * controls.
 *
 * Reads the follow-up from the inbox list row (kept live by the server's
 * `conversation.outcome` event, see useConversations). Our own change shows at
 * once from the server's answer, until the list catches up — or until any
 * outcome event for this chat arrives (e.g. the server cancelling the
 * follow-up because the patient wrote again), when the list wins. A legacy
 * outcome (Booked / Not interested / No answer) reads as none (see activeOutcome).
 */
export function ConversationOutcomeControl({
  conversationId,
  outcome,
  followUpAt,
  optOut = null,
  owner = null,
}: {
  conversationId: string;
  outcome: ConversationOutcome | null;
  followUpAt: string | null;
  /** The patient's marketing opt-out (see components/OptOut), for the Marketing items. */
  optOut?: OptOutState | null;
  /** Who owns the chat: only they (or a supervisor) change its follow-up. */
  owner?: { id: number; name?: string | null; username: string } | null;
}) {
  const { me, can } = useCurrentUser();
  const canLift = can("optout:lift");
  const toast = useToast();
  const editable = can("conversation:write");
  // A colleague's chat: the follow-up is theirs (server rule NOT_YOUR_CHAT).
  // Recording an opt-out stays open to anyone working the chat.
  const followUpLocked = !!owner && owner.id !== me?.id && !can("team:supervise");
  const ownerName = owner ? owner.name || owner.username : "";
  const numericId = Number(conversationId);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"follow_up" | "opt_out" | "lift_opt_out" | null>(null);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Our own change, keyed by what the list said when we made it: once the list
  // says something else (it caught up, or a colleague changed it), the list wins.
  const listKey = `${conversationId}|${outcome}|${followUpAt}`;
  const [own, setOwn] = useState<{ key: string; state: ConversationOutcomeState } | null>(null);
  const mine = own && own.key === listKey ? own.state : null;
  const shownOutcome = activeOutcome(mine ? mine.outcome : outcome);
  const shownFollowUp = mine ? mine.followUpAt : followUpAt;

  // Any outcome change on this chat — ours echoed back, a colleague's, or the
  // server cancelling the follow-up when the patient writes again — hands the
  // chip back to the list row, which useConversations patches from the same event.
  useEffect(() => {
    const socket = getSocket();
    const onOutcome = (p: { conversationId?: number | string }) => {
      if (String(p?.conversationId) === conversationId) setOwn(null);
    };
    socket.on("conversation.outcome", onOutcome);
    return () => { socket.off("conversation.outcome", onOutcome); };
  }, [conversationId]);

  // A follow-up turns red the minute it falls due.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Saves; returns the server's refusal (shown by the caller) or null. */
  async function save(body: OutcomeBody, okMessage: string): Promise<string | null> {
    setOpen(false);
    setSaving(true);
    try {
      const res = await apiSetConversationOutcome(numericId, body);
      setOwn({ key: listKey, state: res.data });
      setDialog(null);
      toast.success(okMessage);
      return null;
    } catch (err) {
      return err instanceof Error && err.message ? err.message : "Couldn't save the follow-up";
    } finally {
      setSaving(false);
    }
  }

  async function quick(body: OutcomeBody, okMessage: string) {
    const err = await save(body, okMessage);
    if (err) toast.error(err);
  }

  const overdue = shownOutcome === "FOLLOW_UP" && isOverdue(shownFollowUp, now);
  const when = shownOutcome === "FOLLOW_UP" && shownFollowUp ? fmtWhen(shownFollowUp) : null;
  const label = shownOutcome ? (overdue ? "Follow up overdue" : OUTCOME_LABEL[shownOutcome]) : "Follow up";
  const chipCls = shownOutcome
    ? `border ${overdue ? OVERDUE_CHIP : OUTCOME_CHIP[shownOutcome]}`
    : "border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50";
  const title = shownOutcome
    ? `${label}${when ? ` · ${when}` : ""}`
    : "Set a follow-up or record an opt-out";

  const chipBody = (
    <>
      {saving ? <Spinner size="xs" label="Saving" /> : <CalendarClock className="w-3.5 h-3.5 shrink-0" />}
      <span className="truncate">
        {label}
        {when && <span className="hidden lg:inline font-normal"> · {when}</span>}
      </span>
    </>
  );

  // Read-only for anyone who can't work the chat — they still see the follow-up.
  if (!editable) {
    if (!shownOutcome) return null;
    return (
      <span title={title} className={`hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[12px] font-medium max-w-[260px] ${chipCls}`}>
        {chipBody}
      </span>
    );
  }

  const item = "w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-full text-[12px] font-medium max-w-[280px] transition-colors cursor-pointer disabled:cursor-wait ${chipCls}`}
      >
        {chipBody}
        <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Follow-up and marketing" className="absolute right-0 top-10 z-[61] w-[220px] bg-white border border-gray-100 rounded-xl shadow-lg py-1.5">
            {followUpLocked ? (
              <p className="px-3 py-2 text-[12px] text-gray-500 leading-snug">
                <CalendarClock className="w-4 h-4 text-gray-300 inline -mt-0.5 mr-1.5" />
                The follow-up is {ownerName}&apos;s to set. Take the chat over to change it.
              </p>
            ) : (
              <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog("follow_up"); }} className={`${item} text-gray-700 hover:bg-gray-50`}>
                <CalendarClock className="w-4 h-4 text-amber-600" /> <span className="flex-1">{shownOutcome ? "Change follow-up…" : "Follow up…"}</span>
              </button>
            )}
            {shownOutcome && !followUpLocked && (
              <button type="button" role="menuitem" onClick={() => quick({ outcome: null }, "Follow-up cancelled")} className={`${item} text-gray-500 hover:bg-gray-50`}>
                <CalendarX className="w-4 h-4" /> <span className="flex-1">Cancel follow-up</span>
              </button>
            )}
            {/* Consent. Recording is for anyone working the chat; lifting is admins only. */}
            {(!optOut?.all || (canLift && isOptedOut(optOut))) && (
              <div className="border-t border-gray-100 mt-1.5 pt-1.5">
                <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Marketing</p>
                {!optOut?.all && (
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog("opt_out"); }} className={`${item} text-gray-700 hover:bg-gray-50`}>
                    <ShieldOff className="w-4 h-4 text-red-500" /> <span className="flex-1">Opt out of marketing…</span>
                  </button>
                )}
                {canLift && optOut && isOptedOut(optOut) && (
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog("lift_opt_out"); }} className={`${item} text-gray-700 hover:bg-gray-50`}>
                    <ShieldCheck className="w-4 h-4 text-gray-400" /> <span className="flex-1">Lift opt-out…</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {dialog === "opt_out" && (
        <RecordOptOutDialog conversationId={conversationId} state={optOut} onClose={() => setDialog(null)} />
      )}
      {dialog === "lift_opt_out" && optOut && isOptedOut(optOut) && (
        <LiftOptOutDialog conversationId={conversationId} state={optOut} onClose={() => setDialog(null)} />
      )}
      {dialog === "follow_up" && (
        <FollowUpDialog
          saving={saving}
          current={shownOutcome === "FOLLOW_UP" ? shownFollowUp : null}
          onCancel={() => setDialog(null)}
          onSave={(followUpAt) => save({ outcome: "FOLLOW_UP", followUpAt }, `Follow-up set for ${fmtWhen(followUpAt)}`)}
        />
      )}
    </div>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────────

function Dialog({ title, intro, onCancel, saving, children }: {
  title: string; intro: string; onCancel: () => void; saving: boolean; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl shadow-2xl w-[420px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">{title}</h3>
        <p className="text-[13px] text-gray-500 mb-4">{intro}</p>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function DialogButtons({ saving, onCancel, label }: { saving: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50">
        Cancel
      </button>
      <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

/** When someone should get back to this patient. */
function FollowUpDialog({ saving, current, onCancel, onSave }: {
  saving: boolean;
  current: string | null;
  onCancel: () => void;
  onSave: (followUpAt: string) => Promise<string | null>;
}) {
  const [picks] = useState(followUpPicks);
  const [value, setValue] = useState(() =>
    current && new Date(current).getTime() > Date.now() ? toDateTimeInput(new Date(current)) : toDateTimeInput(picks[1].at),
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const d = new Date(value);
    if (!value || Number.isNaN(d.getTime())) return setError("Pick when to follow up.");
    if (d.getTime() < Date.now()) return setError("That time has already passed — pick a time in the future.");
    setError(null);
    const err = await onSave(d.toISOString());
    if (err) setError(err);
  }

  return (
    <Dialog title="Follow up later" intro="Set when to get back to this patient. It turns red in the inbox once it's due." onCancel={onCancel} saving={saving}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {picks.map((p) => {
            const v = toDateTimeInput(p.at);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => { setValue(v); setError(null); }}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${value === v ? "bg-brand-200 border-brand text-brand-fg font-semibold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <label className="block">
          <span className={labelCls}>Follow up on</span>
          <input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} />
        </label>
        {value && !Number.isNaN(new Date(value).getTime()) && (
          <p className="text-[12px] text-gray-400">{fmtWhen(new Date(value).toISOString())}</p>
        )}
        {error && <p className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onCancel} label="Set follow-up" />
      </form>
    </Dialog>
  );
}
