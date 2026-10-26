"use client";

// The signed-in agent's own presence — Online / On break — and the end-of-shift
// "Hand over my chats…". Offline is automatic (about a minute after the app is
// closed, back Online when it's opened), so it isn't offered here.

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, ChevronUp } from "lucide-react";
import { apiHandOverMine, apiUpdateMyStatus } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { HandOverDialog, handOverSummary } from "@/components/HandOverDialog";
import type { UserStatus } from "@/types";

const STATUS: Record<UserStatus, { dot: string; label: string }> = {
  ONLINE: { dot: "bg-green-500", label: "Online" },
  ON_BREAK: { dot: "bg-amber-400", label: "On break" },
  OFFLINE: { dot: "bg-gray-300", label: "Offline" },
};

export function MyStatusMenu({ roleLabel, menuClassName = "left-0 bottom-7" }: { roleLabel?: string | null; menuClassName?: string }) {
  const { me, can } = useCurrentUser();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [handOver, setHandOver] = useState(false);
  const [own, setOwn] = useState<UserStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Opening the app sets you Online on the server, whatever /users/me said a moment before.
  const status: UserStatus = own ?? (me?.status === "ON_BREAK" ? "ON_BREAK" : "ONLINE");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function setStatus(next: UserStatus) {
    setOpen(false);
    if (next === status) return;
    setSaving(true);
    try {
      await apiUpdateMyStatus(next);
      setOwn(next);
      toast.success(next === "ON_BREAK" ? "You're on break" : "You're online");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change your status");
    } finally {
      setSaving(false);
    }
  }

  const s = STATUS[status];
  const item = "w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors cursor-pointer";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Your status"
        className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800 leading-snug cursor-pointer disabled:cursor-wait"
      >
        {roleLabel && <span>{roleLabel} ·</span>}
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
        <span className="font-medium">{s.label}</span>
        <ChevronUp className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Your status" className={`absolute ${menuClassName} z-[61] w-[220px] bg-white border border-gray-100 rounded-xl shadow-lg py-1.5`}>
            <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Status</p>
            {(["ONLINE", "ON_BREAK"] as const).map((v) => (
              <button key={v} type="button" role="menuitem" onClick={() => setStatus(v)} className={`${item} text-gray-700 hover:bg-gray-50`}>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS[v].dot}`} />
                <span className="flex-1">{STATUS[v].label}</span>
                {status === v && <Check className="w-4 h-4 text-brand-fg" />}
              </button>
            ))}
            {can("conversation:write") && (
              <div className="border-t border-gray-100 mt-1.5 pt-1.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); setHandOver(true); }}
                  className={`${item} text-gray-700 hover:bg-gray-50`}
                >
                  <ArrowRightLeft className="w-4 h-4 text-brand-fg" />
                  <span className="flex-1">Hand over my chats…</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {handOver && (
        <HandOverDialog
          title="Hand over my chats"
          intro="End of shift? Your open chats go to a colleague, or back to the queue for whoever's next."
          heading="Hand them to"
          excludeUserId={me?.id ?? null}
          confirmLabel="Hand over"
          onCancel={() => setHandOver(false)}
          onConfirm={async (toUserId) => {
            try {
              const res = await apiHandOverMine(toUserId);
              setHandOver(false);
              toast.success(handOverSummary(res.data));
              return null;
            } catch (err) {
              return err instanceof Error ? err.message : "Couldn't hand over your chats";
            }
          }}
        />
      )}
    </div>
  );
}
