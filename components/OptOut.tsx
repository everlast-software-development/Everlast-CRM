"use client";

// A patient's marketing opt-out, from the chat: the banner, recording one
// (anyone who works the chat), and lifting one (admins — optout:lift).
//
// Two scopes, as the server stores them:
//   line — no campaigns / offers from THIS WhatsApp line (has a source + date)
//   all  — the contact's global do-not-contact switch (Customer.optedOut)
// Replying to the patient is always allowed — they wrote to us. What an
// opt-out stops is offers and campaign (marketing) templates.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ShieldOff } from "lucide-react";
import { apiGetConversationProfile, apiLiftOptOut, apiOptOutPatient } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import type { Template } from "@/types";

export type OptOutScope = "line" | "all";
export interface OptOutState {
  line: { optedOutAt: string; source: string } | null;
  all: boolean;
}

/** How the opt-out came about, as a phrase: "(sent STOP · 12 Oct)". */
export const OPT_OUT_SOURCE_LABEL: Record<string, string> = {
  KEYWORD: "sent STOP",
  KEYWORD_ALL: "sent STOP ALL (every line)",
  WHATSAPP: "turned off offers in WhatsApp",
  MANUAL: "recorded by the team",
  IMPORT: "from an import",
};
export const optOutSourceLabel = (source: string | null | undefined) =>
  (source && OPT_OUT_SOURCE_LABEL[source]) || "opted out";

/** The patient did this themselves (STOP, WhatsApp's own switch) — lifting it overrides them. */
export const isPatientsOwnOptOut = (source: string | null | undefined) =>
  source === "KEYWORD" || source === "KEYWORD_ALL" || source === "WHATSAPP";

export const isOptedOut = (s: OptOutState | null | undefined) => !!s && (s.all || !!s.line);

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Marketing, by the server's rule (template.controller sendTemplate): Meta's
 * own category when known, else anything that isn't a GENERAL template.
 */
export function isMarketingTemplate(t: Pick<Template, "category"> & { metaCategory?: string | null }): boolean {
  return t.metaCategory ? t.metaCategory === "MARKETING" : t.category !== "GENERAL";
}

// ── Our own change, told to every opt-out view of the chat at once ───────────

const LOCAL_EVENT = "everlast:optout-changed";

export function notifyOptOutChanged(conversationId: string | number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: String(conversationId) }));
}

/**
 * Calls back when this chat's opt-out changes — ours (from any control on the
 * page), a colleague's, or the patient's own STOP ("customer.opt_out_changed").
 */
export function useOptOutChanged(conversationId: string, customerId: number | null, onChange: () => void) {
  useEffect(() => {
    const socket = getSocket();
    const onSocket = (p: { conversationId?: number | string; customerId?: number | string }) => {
      if (String(p?.conversationId) === conversationId || (customerId != null && String(p?.customerId) === String(customerId))) onChange();
    };
    const onLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === conversationId) onChange();
    };
    socket.on("customer.opt_out_changed", onSocket);
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => {
      socket.off("customer.opt_out_changed", onSocket);
      window.removeEventListener(LOCAL_EVENT, onLocal);
    };
  }, [conversationId, customerId, onChange]);
}

/** This chat's opt-out state, kept live. null while loading (or unreadable). */
export function useOptOutState(conversationId: string): OptOutState | null {
  const [loaded, setLoaded] = useState<{ id: string; state: OptOutState; customerId: number } | null>(null);
  const [reload, setReload] = useState(0);
  const bump = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiGetConversationProfile(conversationId)
      .then((res) => {
        if (cancelled) return;
        setLoaded({
          id: conversationId,
          customerId: res.data.customer.id,
          state: { line: res.data.optOut ?? null, all: !!res.data.customer.optedOut },
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [conversationId, reload]);

  const current = loaded?.id === conversationId ? loaded : null;
  useOptOutChanged(conversationId, current?.customerId ?? null, bump);
  return current?.state ?? null;
}

// ── Banner ───────────────────────────────────────────────────────────────────

/**
 * Under the chat header while the patient is opted out. Replying is fine; the
 * banner says so, and that offers / campaign templates are not.
 */
export function OptOutBanner({ conversationId, state }: { conversationId: string; state: OptOutState | null }) {
  const { can } = useCurrentUser();
  const [lifting, setLifting] = useState(false);
  if (!state || !isOptedOut(state)) return null;

  const headline = state.all
    ? "Do not contact — opted out on all lines"
    : `Opted out of marketing on this line (${optOutSourceLabel(state.line?.source)}${state.line ? ` · ${fmtDay(state.line.optedOutAt)}` : ""})`;

  return (
    <div className="relative z-20 flex items-start gap-2.5 px-5 py-2 bg-red-50 border-b border-red-100 shrink-0">
      <ShieldOff className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-red-700 leading-snug">{headline}</p>
        <p className="text-[11.5px] text-red-600/90 leading-snug">
          {state.all && state.line
            ? `Also opted out on this line (${optOutSourceLabel(state.line.source)} · ${fmtDay(state.line.optedOutAt)}). `
            : ""}
          You can still reply to their messages. Don&apos;t send offers or campaign templates.
        </p>
      </div>
      {can("optout:lift") && (
        <button
          type="button"
          onClick={() => setLifting(true)}
          className="shrink-0 text-[12px] font-semibold text-red-700 hover:underline underline-offset-2 cursor-pointer"
        >
          Lift opt-out…
        </button>
      )}
      {lifting && <LiftOptOutDialog conversationId={conversationId} state={state} onClose={() => setLifting(false)} />}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function DialogShell({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl shadow-2xl w-[420px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ScopeOption({ checked, disabled, onChange, title, hint }: {
  checked: boolean; disabled?: boolean; onChange: () => void; title: string; hint: string;
}) {
  return (
    <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
      disabled ? "border-gray-100 opacity-60 cursor-not-allowed" : checked ? "border-brand bg-brand-50 cursor-pointer" : "border-gray-200 hover:bg-gray-50 cursor-pointer"
    }`}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} className="mt-0.5 accent-brand" />
      <span>
        <span className="block text-[13px] font-semibold text-gray-800">{title}</span>
        <span className="block text-[12px] text-gray-500">{hint}</span>
      </span>
    </label>
  );
}

/** "Opt out of marketing…": this line, or all lines (do not contact), with an optional reason. */
export function RecordOptOutDialog({ conversationId, state, onClose }: {
  conversationId: string;
  state: OptOutState | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const lineDone = !!state?.line;
  const [scope, setScope] = useState<OptOutScope>(lineDone ? "all" : "line");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiOptOutPatient(Number(conversationId), scope, reason.trim() || undefined);
      toast.success(scope === "all" ? "Opted out on all lines — do not contact" : "Opted out of marketing on this line");
      notifyOptOutChanged(conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record the opt-out");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Opt out of marketing" busy={busy} onClose={onClose}>
      <p className="text-[13px] text-gray-500 mb-4">
        The patient won&apos;t get campaigns or offers. You can still reply when they write to you.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-2">
          <ScopeOption
            checked={scope === "line"}
            disabled={lineDone}
            onChange={() => setScope("line")}
            title="This line only"
            hint={lineDone ? "Already opted out on this line." : "No campaigns from this WhatsApp number."}
          />
          <ScopeOption
            checked={scope === "all"}
            onChange={() => setScope("all")}
            title="All lines (do not contact)"
            hint="No campaigns or offers from any of our numbers."
          />
        </div>
        <label className="block">
          <span className="block text-[12px] font-semibold text-gray-500 mb-1">Reason (optional)</span>
          <input
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. asked on the phone not to get offers"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-brand"
          />
        </label>
        {error && <p className="text-[13px] text-red-500 font-medium">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Opt out
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/**
 * Lift (admins). Names where the opt-out came from; one the patient made
 * themselves (STOP, WhatsApp's switch) gets the stronger warning.
 */
export function LiftOptOutDialog({ conversationId, state, onClose }: {
  conversationId: string;
  state: OptOutState;
  onClose: () => void;
}) {
  const toast = useToast();
  const both = !!state.line && state.all;
  const [scope, setScope] = useState<OptOutScope>(state.line ? "line" : "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineSource = state.line?.source ?? null;
  const patientsOwn = scope === "line" && isPatientsOwnOptOut(lineSource);

  async function lift() {
    setBusy(true);
    setError(null);
    try {
      await apiLiftOptOut(Number(conversationId), scope);
      toast.success(scope === "all" ? "Do-not-contact lifted" : "Opt-out on this line lifted");
      notifyOptOutChanged(conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't lift the opt-out");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Lift opt-out?" busy={busy} onClose={onClose}>
      {both && (
        <div className="space-y-2 my-3">
          <ScopeOption
            checked={scope === "line"}
            onChange={() => setScope("line")}
            title="This line"
            hint={`${optOutSourceLabel(lineSource)} · ${fmtDay(state.line!.optedOutAt)}`}
          />
          <ScopeOption
            checked={scope === "all"}
            onChange={() => setScope("all")}
            title="All lines (do not contact)"
            hint="The contact's global opt-out."
          />
        </div>
      )}
      {patientsOwn ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-[13px] font-semibold text-red-700">
            The patient opted out themselves — they {optOutSourceLabel(lineSource)} on {fmtDay(state.line!.optedOutAt)}.
          </p>
          <p className="text-[12px] text-red-600 mt-0.5">
            Only lift this if the patient has clearly asked to receive offers again. Sending marketing to someone who said STOP can get the number reported and blocked.
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-gray-500 mb-4">
          {scope === "line"
            ? `This line's opt-out was ${optOutSourceLabel(lineSource)}${state.line ? ` on ${fmtDay(state.line.optedOutAt)}` : ""}.`
            : "The patient is marked do-not-contact on all lines."}{" "}
          Once lifted, they can receive campaigns and offers {scope === "line" ? "from this line" : "again"}. Make sure they agreed to it.
        </p>
      )}
      {error && <p className="text-[13px] text-red-500 font-medium mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50">
          Keep opt-out
        </button>
        <button type="button" onClick={lift} disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {patientsOwn ? "Lift anyway" : "Lift opt-out"}
        </button>
      </div>
    </DialogShell>
  );
}
