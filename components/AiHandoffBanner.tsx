"use client";

import { useEffect, useState } from "react";
import { Bot, X } from "lucide-react";
import { apiGetAiHandoff } from "@/lib/api";

// Pinned over the top of the chat after the store's AI handed the customer to
// the team: when, and the store's summary of what they need — so whoever opens
// the chat knows before reading back. Each person can dismiss it; it shows
// again for a new hand-over. (The API's GET /conversations/:id/ai-handoff.)

const keyFor = (conversationId: string, at: string) => `ai-handoff-seen:${conversationId}:${at}`;

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function AiHandoffBanner({ conversationId, handedOffAt, assignee }: {
  conversationId: string;
  handedOffAt: string | null | undefined;
  /** The chat's owner now: who it went to (null = still waiting in Unassigned). */
  assignee: { name?: string | null; username: string } | null | undefined;
}) {
  const [handoff, setHandoff] = useState<{ at: string; kind: "handover" | "error"; summary: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Fetched again when the hand-over time changes (a new hand-over arrives live).
  useEffect(() => {
    let alive = true;
    if (!handedOffAt) {
      Promise.resolve().then(() => alive && setHandoff(null));
      return () => { alive = false; };
    }
    apiGetAiHandoff(conversationId)
      .then((r) => {
        if (!alive) return;
        setHandoff(r.data);
        let seen = false;
        try { seen = !!r.data && localStorage.getItem(keyFor(conversationId, r.data.at)) === "1"; } catch {}
        setDismissed(seen);
      })
      .catch(() => alive && setHandoff(null));
    return () => { alive = false; };
  }, [conversationId, handedOffAt]);

  if (!handoff || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(keyFor(conversationId, handoff!.at), "1"); } catch {}
  }

  const isError = handoff.kind === "error";
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,calc(100%-2rem))]" role="status">
      <div className={`flex items-start gap-3 rounded-2xl border shadow-lg backdrop-blur px-4 py-3 ${isError ? "bg-amber-50/95 border-amber-200" : "bg-teal-50/95 border-teal-200"}`}>
        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isError ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700"}`}>
          <Bot className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[12.5px] font-semibold ${isError ? "text-amber-900" : "text-teal-900"}`}>
            {isError ? "The AI couldn't answer, so it passed this chat to the team" : "The AI handed this customer to the team"}
            <span className="font-normal text-gray-500"> · {fmtWhen(handoff.at)}</span>
          </p>
          {handoff.summary ? (
            <p className="text-[13px] text-gray-800 mt-0.5 leading-snug break-words" dir="auto">{handoff.summary}</p>
          ) : (
            <p className="text-[12.5px] text-gray-600 mt-0.5">{isError ? "Read their last message and reply." : "No summary was given: read their last messages."}</p>
          )}
          <p className={`text-[12px] mt-1 font-medium ${assignee ? "text-gray-600" : "text-amber-700"}`}>
            {assignee
              ? `Given to ${assignee.name || assignee.username}.`
              : "Waiting in Unassigned: no agent was online. Take it with the owner button at the top."}
          </p>
        </div>
        <button type="button" onClick={dismiss} title="Dismiss" aria-label="Dismiss" className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-white hover:text-gray-600 shrink-0 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
