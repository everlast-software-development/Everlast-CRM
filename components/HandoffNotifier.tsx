"use client";

// Alerts the team, whichever line they're viewing, when:
//   - a flow hands a customer to a person ("Connect me" / an Assign step) —
//     "flow.handoff";
//   - a follow-up a chat was set to has fallen due — "follow_up.due", sent only
//     to the agent responsible for it (every tab, any line);
//   - a chat was given to this agent automatically — "chat.assigned_to_you"
//     (Settings → Assigning chats; the API's utils/autoAssign.js), only to them.
// The first goes to every connected user who can reply on that number, on
// EVERY line they may use — nothing here filters by the active line. Shown as:
//   - an alert card that stays until dismissed (a waiting customer shouldn't
//     vanish after five seconds like a toast),
//   - a short chime,
//   - a desktop notification when allowed, for when the CRM is in a background tab.
// Opening one switches to its line first when needed.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CalendarClock, MessageCircle, X } from "lucide-react";
import { getActiveNumber } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { fmtWhen } from "@/lib/chatOutcome";
import type { FollowUpDueEvent } from "@/types";

interface Handoff {
  conversationId: number;
  whatsappNumberId: number;
  customerName: string | null;
  customerPhone: string;
  flowName: string;
  interest: string | null;
  agentId: number | null;
  agentUsername: string | null;
  at: string;
}

/** The alert's headline. */
function handoffTitle(h: Handoff): string {
  return `${who(h)} wants to talk to an agent`;
}

// A chat the app gave this agent (a new patient, or one waiting in Unassigned).
interface AssignedToYou {
  conversationId: number;
  whatsappNumberId: number;
  customerName: string | null;
  customerPhone: string;
  reason: string;
  at: string;
}

type Alert =
  | { kind: "handoff"; key: string; at: string; h: Handoff }
  | { kind: "follow_up"; key: string; at: string; f: FollowUpDueEvent }
  | { kind: "assigned"; key: string; at: string; c: AssignedToYou };

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // Audio is a nicety; some browsers block it until the page is clicked.
  }
}

const who = (h: { customerName: string | null; customerPhone: string }) => h.customerName || `+${h.customerPhone}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function HandoffNotifier() {
  const router = useRouter();
  const { me } = useCurrentUser();
  const { activeNumberId, numbers, switchNumber } = useActiveNumber();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );

  const lineLabel = useCallback(
    (id: number) => numbers.find((n) => n.id === id)?.label ?? `Line #${id}`,
    [numbers],
  );
  // Only worth naming the line when there is more than one.
  const multiLine = numbers.length > 1;

  const dismiss = useCallback((key: string) => {
    setAlerts((list) => list.filter((a) => a.key !== key));
  }, []);

  const push = useCallback((a: Alert) => {
    setAlerts((list) => [a, ...list.filter((x) => x.key !== a.key)].slice(0, 5));
  }, []);

  // Switches to the alert's line first when it isn't the one on screen.
  const goTo = useCallback((numberId: number, path: string) => {
    const go = () => router.push(path);
    if (String(numberId) !== activeNumberId) {
      switchNumber(numberId);
      // A switch guard (unsaved work elsewhere) may have vetoed it.
      if (getActiveNumber() !== String(numberId)) return;
      setTimeout(go, 450); // after the switch has re-scoped the app
    } else {
      go();
    }
  }, [activeNumberId, router, switchNumber]);

  const openHandoff = useCallback((h: Handoff) => {
    dismiss(`handoff-${h.conversationId}`);
    goTo(h.whatsappNumberId, `/chats/${h.conversationId}`);
  }, [dismiss, goTo]);

  const openFollowUp = useCallback((f: FollowUpDueEvent) => {
    dismiss(`follow-up-${f.conversationId}`);
    goTo(f.whatsappNumberId, `/chats/${f.conversationId}`);
  }, [dismiss, goTo]);

  const openAssigned = useCallback((c: AssignedToYou) => {
    dismiss(`assigned-${c.conversationId}`);
    goTo(c.whatsappNumberId, `/chats/${c.conversationId}`);
  }, [dismiss, goTo]);

  useEffect(() => {
    const socket = getSocket();
    const canNotify = () => typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";

    const onHandoff = (h: Handoff) => {
      // Assigned to someone else: that person gets it, not the whole team.
      if (h.agentId && me && h.agentId !== me.id) return;
      push({ kind: "handoff", key: `handoff-${h.conversationId}`, at: h.at, h });
      chime();
      if (canNotify()) {
        const n = new Notification(handoffTitle(h), {
          body: h.interest ? `Interested in: ${h.interest}` : `From the "${h.flowName}" flow`,
          tag: `handoff-${h.conversationId}`,
        });
        n.onclick = () => { window.focus(); openHandoff(h); n.close(); };
      }
    };

    // Already addressed to the right person by the server — no filtering here.
    const onFollowUp = (f: FollowUpDueEvent) => {
      push({ kind: "follow_up", key: `follow-up-${f.conversationId}`, at: new Date().toISOString(), f });
      chime();
      if (canNotify()) {
        const n = new Notification(`Follow up now · ${who(f)}`, {
          body: [`Was due ${fmtWhen(f.followUpAt)}`, multiLine ? lineLabel(f.whatsappNumberId) : null].filter(Boolean).join(" · "),
          tag: `follow-up-${f.conversationId}`,
        });
        n.onclick = () => { window.focus(); openFollowUp(f); n.close(); };
      }
    };

    // Already addressed to this agent by the server.
    const onAssigned = (c: AssignedToYou) => {
      push({ kind: "assigned", key: `assigned-${c.conversationId}`, at: c.at, c });
      chime();
      if (canNotify()) {
        const n = new Notification(`New chat for you · ${who(c)}`, {
          body: [c.reason === "waiting in Unassigned" ? "Was waiting in Unassigned" : "A patient is waiting for your reply", multiLine ? lineLabel(c.whatsappNumberId) : null].filter(Boolean).join(" · "),
          tag: `assigned-${c.conversationId}`,
        });
        n.onclick = () => { window.focus(); openAssigned(c); n.close(); };
      }
    };

    socket.on("flow.handoff", onHandoff);
    socket.on("follow_up.due", onFollowUp);
    socket.on("chat.assigned_to_you", onAssigned);
    return () => {
      socket.off("flow.handoff", onHandoff);
      socket.off("follow_up.due", onFollowUp);
      socket.off("chat.assigned_to_you", onAssigned);
    };
  }, [me, push, openHandoff, openFollowUp, openAssigned, lineLabel, multiLine]);

  if (alerts.length === 0) return null;

  const enableDesktop = permission === "default" && (
    <button
      type="button"
      onClick={() => Notification.requestPermission().then(setPermission)}
      className="text-[12px] font-medium text-gray-500 hover:text-gray-800 px-2"
    >
      Enable desktop alerts
    </button>
  );

  return (
    <div className="fixed bottom-4 right-4 z-[9998] w-[340px] max-w-[calc(100vw-2rem)] space-y-2">
      {alerts.map((a) => {
        if (a.kind === "handoff") {
          const h = a.h;
          const otherLine = multiLine && String(h.whatsappNumberId) !== activeNumberId;
          return (
            <div key={a.key} className="bg-white rounded-2xl shadow-xl border border-amber-200 overflow-hidden animate-in slide-in-from-bottom-2">
              <div className="flex items-start gap-3 p-4">
                <span className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                  <BellRing className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-gray-900 leading-snug">{handoffTitle(h)}</p>
                  {h.interest && <p className="text-[12px] text-gray-600 mt-0.5">Interested in: <span className="font-semibold">{h.interest}</span></p>}
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {h.agentUsername ? `Assigned to you · ` : "Waiting in Unassigned · "}
                    {h.flowName} · {fmtTime(h.at)}
                    {otherLine && <span className="font-semibold text-amber-700"> · {lineLabel(h.whatsappNumberId)}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => dismiss(a.key)} title="Dismiss" className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 px-4 pb-3">
                <button
                  type="button"
                  onClick={() => openHandoff(h)}
                  className="flex-1 text-[13px] font-semibold text-white bg-brand hover:opacity-90 rounded-xl py-2"
                >
                  {otherLine ? "Switch line & open chat" : "Open chat"}
                </button>
                {enableDesktop}
              </div>
            </div>
          );
        }

        if (a.kind === "assigned") {
          const c = a.c;
          const otherLine = multiLine && String(c.whatsappNumberId) !== activeNumberId;
          return (
            <div key={a.key} className="bg-white rounded-2xl shadow-xl border border-brand/30 overflow-hidden animate-in slide-in-from-bottom-2">
              <div className="flex items-start gap-3 p-4">
                <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-fg flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-gray-900 leading-snug">
                    New chat for you · <span className="break-words">{who(c)}</span>
                  </p>
                  <p className="text-[12px] text-gray-600 mt-0.5">
                    {c.reason === "waiting in Unassigned" ? "Was waiting in Unassigned. It's yours now." : "A patient is waiting for your reply. It's yours now."}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {fmtTime(c.at)}
                    {multiLine && <span className={otherLine ? "font-semibold text-amber-700" : undefined}> · {lineLabel(c.whatsappNumberId)}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => dismiss(a.key)} title="Dismiss" className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 px-4 pb-3">
                <button type="button" onClick={() => openAssigned(c)} className="flex-1 text-[13px] font-semibold text-white bg-brand hover:opacity-90 rounded-xl py-2">
                  {otherLine ? "Switch line & open chat" : "Open chat"}
                </button>
                {enableDesktop}
              </div>
            </div>
          );
        }

        const f = a.f;
        const otherLine = multiLine && String(f.whatsappNumberId) !== activeNumberId;
        return (
          <div key={a.key} className="bg-white rounded-2xl shadow-xl border border-red-200 overflow-hidden animate-in slide-in-from-bottom-2">
            <div className="flex items-start gap-3 p-4">
              <span className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <CalendarClock className="w-4.5 h-4.5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-gray-900 leading-snug">
                  Follow up now · <span className="break-words">{who(f)}</span>
                </p>
                <p className="text-[12px] text-red-600 font-medium mt-0.5">Was due {fmtWhen(f.followUpAt)}</p>
                {multiLine && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    <span className={otherLine ? "font-semibold text-amber-700" : undefined}>{lineLabel(f.whatsappNumberId)}</span>
                  </p>
                )}
              </div>
              <button type="button" onClick={() => dismiss(a.key)} title="Dismiss" className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 px-4 pb-3">
              <button type="button" onClick={() => openFollowUp(f)} className="flex-1 text-[13px] font-semibold text-white bg-brand hover:opacity-90 rounded-xl py-2">
                {otherLine ? "Switch line & open chat" : "Open chat"}
              </button>
              {enableDesktop}
            </div>
          </div>
        );
      })}
    </div>
  );
}
