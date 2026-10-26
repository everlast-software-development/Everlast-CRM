"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  MessageSquare,
  MessagesSquare,
  Mic,
  RefreshCw,
  StickyNote,
  Timer,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { apiAddConversationNote, apiGetSupervisionTimeline, getActiveNumber } from "@/lib/api";
import type { SupervisionFlowState, SupervisionTimeline } from "@/types";
import { AssigneePicker } from "@/components/AssigneePicker";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { activeOutcome } from "@/lib/chatOutcome";
import { NumberChip, OutcomeChip, StatusChip, WaitChip } from "./chips";
import {
  WAIT_WARN_MINUTES,
  answerText,
  clockTime,
  dateTime,
  dayLabel,
  formatMinutes,
  formatPhone,
  humanizeKey,
  initials,
  localDay,
  parseStructured,
  patientName,
  personInitials,
  personName,
  shortDate,
  timeAgo,
} from "./format";

type Message = SupervisionTimeline["messages"][number];
type Loaded = { id: number; data: SupervisionTimeline | null; error: string | null };

const SCROLL =
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/25 [&::-webkit-scrollbar-thumb]:rounded-full";

// ── Building blocks ─────────────────────────────────────────────────────────

function Section({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="flex items-center gap-2 text-[13.5px] font-bold text-gray-900">
          <span className="text-gray-400">{icon}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-gray-400 py-1">{children}</p>;
}

const MEDIA_ICON: Record<string, typeof ImageIcon> = { IMAGE: ImageIcon, STICKER: ImageIcon, VIDEO: Video, AUDIO: Mic, DOCUMENT: FileText };
const MEDIA_LABEL: Record<string, string> = { IMAGE: "Photo", STICKER: "Sticker", VIDEO: "Video", AUDIO: "Voice message", DOCUMENT: "Document" };

// A readable version of any message. Media is a labelled link rather than an
// inline player — this panel is for seeing what happened, the inbox for acting.
function BubbleBody({ m }: { m: Message }) {
  const type = (m.messageType || "TEXT").toUpperCase();
  const MediaIcon = MEDIA_ICON[type];
  if (MediaIcon) {
    const url = m.mediaUrl || (m.content?.startsWith("http") ? m.content : null);
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
        <MediaIcon className="w-3.5 h-3.5 text-gray-400" />
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="underline decoration-gray-300 hover:text-brand-fg">
            {MEDIA_LABEL[type]}
          </a>
        ) : (
          MEDIA_LABEL[type]
        )}
      </span>
    );
  }
  const s = parseStructured(m.content);
  if (s) {
    return (
      <div className="space-y-1.5">
        {s.header && <p className="text-[12.5px] font-semibold text-gray-800">{s.header}</p>}
        <p className="text-[13px] leading-snug whitespace-pre-wrap break-words text-[#1F2A24]">{s.body}</p>
        {s.footer && <p className="text-[11px] text-gray-400">{s.footer}</p>}
        {(s.buttons?.length || s.list) && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {s.buttons?.map((b, i) => (
              <span key={i} className="text-[11px] font-medium text-brand-fg bg-white/80 border border-brand/20 rounded-full px-2 py-px">
                {b.title}
              </span>
            ))}
            {s.list && (
              <span className="text-[11px] font-medium text-brand-fg bg-white/80 border border-brand/20 rounded-full px-2 py-px">
                ☰ {s.list.buttonLabel} · {s.list.rows.length} options
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
  if (!m.content) return <span className="text-[13px] italic text-gray-400">[{type.toLowerCase()}]</span>;
  return <p className="text-[13px] leading-snug whitespace-pre-wrap break-words text-[#1F2A24]">{m.content}</p>;
}

function Messages({ messages }: { messages: Message[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  // Land on the newest message, like a chat — and again when a new one arrives.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (messages.length === 0) return <Muted>No messages in this chat yet.</Muted>;

  return (
    <div ref={boxRef} className={`max-h-[420px] overflow-y-auto -mx-1 px-1 bg-[#F4F6F3] rounded-lg py-3 ${SCROLL}`}>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const fromPatient = m.senderType === "CUSTOMER";
        const newDay = !prev || localDay(new Date(prev.createdAt)) !== localDay(new Date(m.createdAt));
        const senderKey = (x: Message) => `${x.senderType}:${x.sender?.id ?? ""}`;
        const showName = !fromPatient && (newDay || !prev || senderKey(prev) !== senderKey(m));
        const who = m.senderType === "BOT" ? "Bot" : m.sender ? personName(m.sender) : "Agent";
        return (
          <div key={m.id}>
            {newDay && (
              <div className="flex justify-center my-2">
                <span className="text-[10.5px] font-semibold text-gray-500 bg-white/90 border border-gray-100 rounded-full px-2.5 py-0.5">
                  {dayLabel(m.createdAt)}
                </span>
              </div>
            )}
            <div className={`flex px-2 ${fromPatient ? "justify-start" : "justify-end"} ${prev && !newDay && prev.senderType === m.senderType ? "mt-0.5" : "mt-2"}`}>
              <div className={`max-w-[82%] flex flex-col ${fromPatient ? "items-start" : "items-end"}`}>
                {showName && (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold text-gray-400 mb-0.5 px-1">
                    {m.senderType === "BOT" && <Bot className="w-3 h-3" />}
                    {who}
                  </span>
                )}
                <div
                  className={`rounded-2xl px-3 py-1.5 shadow-[0_1px_0_rgba(0,0,0,0.04)] ${
                    fromPatient
                      ? "bg-white border border-gray-100 rounded-tl-md"
                      : m.senderType === "BOT"
                        ? "bg-violet-50 border border-violet-100 rounded-tr-md"
                        : "bg-brand-200 rounded-tr-md"
                  }`}
                >
                  <BubbleBody m={m} />
                  <p className={`text-[10px] mt-0.5 tabular-nums ${fromPatient ? "text-gray-400" : "text-gray-500/80 text-right"}`}>
                    {clockTime(m.createdAt)}
                    {m.status === "FAILED" && <span className="text-red-500 font-semibold"> · failed</span>}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function waitTone(minutes: number, sla: number) {
  if (minutes >= sla) return { dot: "bg-red-500", text: "text-red-600" };
  if (minutes >= WAIT_WARN_MINUTES) return { dot: "bg-amber-400", text: "text-amber-700" };
  return { dot: "bg-brand", text: "text-brand-fg" };
}

function ResponseTimeline({ waits, sla }: { waits: SupervisionTimeline["waits"]; sla: number }) {
  const [showAll, setShowAll] = useState(false);
  if (waits.length === 0) return <Muted>The patient hasn&apos;t written in the messages shown.</Muted>;
  const shown = showAll ? waits : waits.slice(0, 6);
  const today = localDay(new Date());
  const when = (iso: string) => (localDay(new Date(iso)) === today ? clockTime(iso) : `${shortDate(iso)} ${clockTime(iso)}`);
  return (
    <>
      <ol className="relative">
        {shown.map((w, i) => {
          const tone = waitTone(w.minutes, sla);
          return (
            <li key={`${w.askedAt}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              {i < shown.length - 1 && <span aria-hidden className="absolute left-[4px] top-3 bottom-0 w-px bg-gray-100" />}
              <span className={`relative mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${w.stillWaiting ? "bg-red-500 ring-4 ring-red-100" : tone.dot}`} />
              <div className="min-w-0 text-[12.5px] leading-snug">
                <p className="text-gray-700">
                  Patient wrote <span className="font-semibold tabular-nums">{when(w.askedAt)}</span>
                  <ArrowRight className="inline w-3 h-3 mx-1 text-gray-300 -mt-0.5" />
                  {w.stillWaiting ? (
                    <span className="font-semibold text-red-600">still waiting {formatMinutes(w.minutes)}</span>
                  ) : (
                    <>
                      <span className="font-semibold">{w.repliedBy || "Someone"}</span> replied{" "}
                      <span className="tabular-nums">{w.repliedAt ? clockTime(w.repliedAt) : ""}</span>
                      <span className={`font-semibold ${tone.text}`}> · {formatMinutes(w.minutes)}</span>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {waits.length > 6 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] font-semibold text-brand-fg hover:underline cursor-pointer">
          {showAll ? "Show fewer" : `Show all ${waits.length}`}
        </button>
      )}
    </>
  );
}

const FLOW_STATUS: Record<SupervisionFlowState["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "In progress", cls: "bg-brand-100 text-brand-fg" },
  COMPLETED: { label: "Completed", cls: "bg-brand-200 text-brand-strong" },
  HANDED_OFF: { label: "Handed to team", cls: "bg-sky-50 text-sky-700" },
  STOPPED: { label: "Stopped", cls: "bg-orange-50 text-orange-700" },
  EXPIRED: { label: "Expired", cls: "bg-orange-50 text-orange-700" },
  FAILED: { label: "Failed", cls: "bg-red-50 text-red-700" },
  STALLED: { label: "Stalled · idle 1h+", cls: "bg-orange-50 text-orange-700" },
};

function FlowProgress({ runs, now }: { runs: SupervisionFlowState[]; now: number }) {
  if (runs.length === 0) return <Muted>This patient hasn&apos;t been through a flow.</Muted>;
  const [latest, ...older] = runs;
  const st = FLOW_STATUS[latest.status] ?? FLOW_STATUS.ACTIVE;
  const answers = Object.entries(latest.answers ?? {});
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-gray-800 truncate">{latest.flowName || "Untitled flow"}</span>
        <span className={`text-[10.5px] font-semibold px-1.5 py-px rounded ${st.cls}`}>{st.label}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5">
        Started {timeAgo(latest.startedAt, now)} · last step {timeAgo(latest.updatedAt, now)}
      </p>
      {answers.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1.5 text-[12.5px] bg-gray-50 rounded-lg p-3">
          {answers.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-400">{humanizeKey(k)}</dt>
              <dd className="text-gray-800 font-medium break-words">{answerText(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[12px] text-gray-400 mt-2">No answers collected yet.</p>
      )}
      {older.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Earlier flows</p>
          {older.map((r) => (
            <p key={r.id} className="text-[12px] text-gray-500 flex items-center gap-2">
              <span className="truncate">{r.flowName || "Untitled flow"}</span>
              <span className="text-gray-300">·</span>
              <span className="shrink-0">{(FLOW_STATUS[r.status] ?? FLOW_STATUS.ACTIVE).label}</span>
              <span className="text-gray-300">·</span>
              <span className="shrink-0">{shortDate(r.startedAt)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function describeHistory(h: SupervisionTimeline["history"][number]): string {
  const d = (h.details ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  switch (h.action) {
    case "conversation.assigned": {
      const to = str(d.agentUsername);
      const from = str(d.previousAgentUsername);
      if (!to) return from ? `unassigned it from ${from}` : "unassigned it";
      return from ? `reassigned it from ${from} to ${to}` : `assigned it to ${to}`;
    }
    case "conversation.claimed":
      return "claimed the chat by replying";
    case "conversation.status_changed": {
      const s = str(d.status);
      const reason = str(d.reason);
      return `set status to ${s ? s.toLowerCase() : "—"}${reason ? ` (${reason})` : ""}`;
    }
    case "conversation.outcome_set": {
      const o = str(d.outcome);
      if (!o) return "cancelled the follow-up";
      if (o === "FOLLOW_UP") return `set a follow-up${str(d.followUpAt) ? ` · due ${dateTime(d.followUpAt as string)}` : ""}`;
      // Older history can hold outcomes the CRM no longer sets (Booked / Not interested / No answer).
      return `marked it ${humanizeKey(o)}`;
    }
    default:
      return h.action.replace(/^conversation\./, "").replace(/_/g, " ");
  }
}

// ── The pane ────────────────────────────────────────────────────────────────

/**
 * Everything about one chat for the supervisor: latest messages, how long each
 * reply took, flow progress, notes and the ownership history.
 *
 * Reads are cross-number (supervision endpoints). Writes — reassigning, adding
 * a note — go through the conversation endpoints, which are scoped to the
 * ACTIVE number, so for a chat on another line the pane offers to switch lines
 * first. The page keeps the open chat in the URL, so it reopens by itself after
 * the switch remounts the dashboard.
 */
export function ConversationDetail({
  conversationId,
  refreshKey,
  now,
  onClose,
  onChanged,
  onOpenChat,
}: {
  conversationId: number;
  /** Bumped by the page on live events / polls: refetch quietly. */
  refreshKey: number;
  now: number;
  onClose: () => void;
  /** Something changed here (a note): refresh the list too. */
  onChanged: () => void;
  /** Open another chat (the same patient on another line). */
  onOpenChat: (id: number) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { can } = useCurrentUser();
  const { activeNumberId, numbers, switchNumber } = useActiveNumber();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGetSupervisionTimeline(conversationId)
      .then((res) => {
        if (!cancelled) setLoaded({ id: conversationId, data: res.data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // A failed background refresh keeps what's on screen.
        setLoaded((prev) =>
          prev && prev.id === conversationId && prev.data
            ? prev
            : { id: conversationId, data: null, error: err instanceof Error ? err.message : "Couldn't load this chat" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey, retry]);

  const current = loaded && loaded.id === conversationId ? loaded : null;
  const data = current?.data ?? null;

  const chatNumberId = data ? String(data.whatsappNumberId) : null;
  const onChatsLine = !!data && activeNumberId === chatNumberId;
  const lineAvailable = !!data && numbers.some((n) => String(n.id) === chatNumberId);
  const canOpenInbox = can("conversation:write");

  function switchToChatLine(): boolean {
    if (!chatNumberId) return false;
    if (activeNumberId === chatNumberId) return true;
    switchNumber(chatNumberId);
    // A switch guard (unsaved work elsewhere) may have vetoed it.
    return getActiveNumber() === chatNumberId;
  }

  function openInInbox() {
    if (!data) return;
    if (!switchToChatLine()) return;
    router.push(`/chats/${data.id}`);
  }

  async function addNote() {
    const body = note.trim();
    if (!body || !data || savingNote) return;
    setSavingNote(true);
    try {
      await apiAddConversationNote(data.id, body);
      setNote("");
      toast.success("Note added");
      setRetry((n) => n + 1);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the note");
    } finally {
      setSavingNote(false);
    }
  }

  // ── Loading / error ──
  if (!current) {
    return (
      <div className="h-full flex flex-col bg-canvas">
        <div className="flex items-center gap-3 px-4 py-3.5 bg-white border-b border-gray-100 animate-pulse">
          <button type="button" onClick={onClose} aria-label="Close" className="lg:hidden text-gray-400">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-11 h-11 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-40 bg-gray-200 rounded" />
            <div className="h-2.5 w-28 bg-gray-100 rounded" />
          </div>
        </div>
        <div className="p-4 space-y-4 animate-pulse">
          <div className="h-64 bg-white rounded-xl border border-gray-100" />
          <div className="grid xl:grid-cols-2 gap-4">
            <div className="h-36 bg-white rounded-xl border border-gray-100" />
            <div className="h-36 bg-white rounded-xl border border-gray-100" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-canvas">
        <p className="text-[14px] font-semibold text-gray-700">Couldn&apos;t load this chat</p>
        <p className="text-[12.5px] font-mono text-red-600 bg-red-50 rounded-lg px-3 py-2 max-w-sm break-words">{current.error}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] rounded-xl px-4 py-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
          <button type="button" onClick={onClose} className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-xl px-4 py-2 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    );
  }

  // Only a follow-up is current state; a legacy outcome (Booked / Not interested /
  // No answer) reads as none — see activeOutcome.
  const outcome = activeOutcome(data.outcome);
  const followUpOverdue = outcome === "FOLLOW_UP" && !!data.followUpAt && new Date(data.followUpAt).getTime() <= now;
  const lineLabel = data.whatsappNumber.label;

  return (
    <div className="h-full flex flex-col min-h-0 bg-canvas">
      {/* Patient header */}
      <div className="shrink-0 bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onClose} aria-label="Back to chats" className="lg:hidden mt-2.5 text-gray-500 hover:text-gray-800 cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-11 h-11 rounded-full bg-brand-200 text-brand-strong flex items-center justify-center font-bold text-[13px] shrink-0">
            {initials(data.customer.name || data.customer.phone)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-bold text-gray-900 truncate">{patientName(data.customer)}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className="text-[12px] text-gray-500 tabular-nums">{formatPhone(data.customer.phone)}</span>
              <NumberChip label={lineLabel} />
              <StatusChip status={data.status} />
              {data.customer.optedOut && (
                <span className="text-[10.5px] font-semibold px-1.5 py-px rounded bg-red-50 text-red-600">Opted out</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="hidden lg:flex mt-1 w-8 h-8 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-3">
          {onChatsLine ? (
            <AssigneePicker conversationId={String(data.id)} assignee={data.assignedAgent} />
          ) : (
            <span
              title={data.assignedAgent ? `Assigned to ${personName(data.assignedAgent)}` : "Nobody owns this conversation"}
              className={`flex items-center gap-1.5 h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-medium ${
                data.assignedAgent ? "border-gray-200 text-gray-700" : "border-dashed border-amber-300 bg-amber-50 text-amber-700"
              }`}
            >
              <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center ${data.assignedAgent ? "bg-brand text-white" : "bg-amber-100"}`}>
                {data.assignedAgent ? personInitials(data.assignedAgent) : "?"}
              </span>
              {personName(data.assignedAgent)}
            </span>
          )}
          <WaitChip minutes={data.waitingMinutes} slaMinutes={data.slaMinutes} size="md" />
          <OutcomeChip outcome={outcome} followUpAt={data.followUpAt} followUpOverdue={followUpOverdue} />

          {canOpenInbox && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={openInInbox}
                className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in inbox
              </button>
              <button
                type="button"
                onClick={openInInbox}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3.5 py-1.5 rounded-xl transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Reply
              </button>
            </div>
          )}
        </div>

        {outcome && (
          <p className="text-[11.5px] text-gray-400 mt-2">
            Follow-up set by <span className="text-gray-600 font-medium">{data.outcomeBy ? personName(data.outcomeBy) : "—"}</span>
            {data.outcomeAt && ` · ${timeAgo(data.outcomeAt, now)}`}
            {data.followUpAt && (
              <span className={followUpOverdue ? "text-red-600 font-semibold" : ""}> · due {dateTime(data.followUpAt)}{followUpOverdue && " (overdue)"}</span>
            )}
          </p>
        )}

        {!onChatsLine && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="flex-1 text-[12px] text-amber-800 leading-snug">
              This chat is on <span className="font-semibold">{lineLabel}</span>.{" "}
              {lineAvailable ? "Switch to that line to reassign it or add a note." : "You don't have access to that line, so you can only watch it."}
            </p>
            {lineAvailable && (
              <button
                type="button"
                onClick={switchToChatLine}
                className="shrink-0 text-[12px] font-semibold text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg px-2.5 py-1 cursor-pointer"
              >
                Switch to {lineLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sections */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-4 ${SCROLL}`}>
        {data.otherChats.length > 0 && (
          <Section icon={<MessagesSquare className="w-4 h-4" />} title="This patient on other lines">
            <ul className="divide-y divide-gray-100">
              {data.otherChats.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onOpenChat(o.id)}
                    className="w-full text-left flex items-center gap-2 py-2 hover:bg-gray-50 rounded-lg px-1 cursor-pointer"
                  >
                    <span className="text-[12px] font-semibold text-gray-700 shrink-0">{o.whatsappNumber.label}</span>
                    <span className="text-[12px] text-gray-500 truncate flex-1 min-w-0">{o.lastMessage || "No messages yet"}</span>
                    {o.waitingMinutes !== null && (
                      <span className={`text-[11px] font-semibold shrink-0 ${o.overSla ? "text-red-600" : "text-amber-600"}`}>
                        waiting {o.waitingMinutes >= 1440 ? `${Math.floor(o.waitingMinutes / 1440)}d` : o.waitingMinutes >= 60 ? `${Math.floor(o.waitingMinutes / 60)}h` : `${o.waitingMinutes}m`}
                      </span>
                    )}
                    <span className="text-[11px] text-brand-fg font-semibold shrink-0">Open →</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          icon={<MessagesSquare className="w-4 h-4" />}
          title="Latest messages"
          aside={<span className="text-[11px] text-gray-400">last {data.messages.length}</span>}
        >
          <Messages messages={data.messages} />
        </Section>

        <div className="grid xl:grid-cols-2 gap-4 items-start">
          <Section
            icon={<Timer className="w-4 h-4" />}
            title="Response timeline"
            aside={<span className="text-[11px] text-gray-400">target {data.slaMinutes}m · working time</span>}
          >
            <ResponseTimeline waits={data.waits} sla={data.slaMinutes} />
          </Section>

          <Section icon={<Workflow className="w-4 h-4" />} title="Flow progress">
            <FlowProgress runs={data.flowRuns} now={now} />
          </Section>
        </div>

        <div className="grid xl:grid-cols-2 gap-4 items-start">
          <Section
            icon={<StickyNote className="w-4 h-4" />}
            title="Notes"
            aside={data.notes.length > 0 ? <span className="text-[11px] text-gray-400">{data.notes.length}</span> : undefined}
          >
            {/* Writing notes needs an inbox role; a director reads them only. */}
            {canOpenInbox && (
            <div className="rounded-xl border border-gray-200 focus-within:border-brand/50 bg-white">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void addNote();
                  }
                }}
                disabled={!onChatsLine || savingNote}
                rows={2}
                placeholder={onChatsLine ? "Add a note for the team… (Ctrl+Enter)" : `Switch to ${lineLabel} to add a note`}
                className="w-full resize-none bg-transparent px-3 py-2 text-[13px] text-gray-700 placeholder:text-gray-400 outline-none disabled:cursor-not-allowed"
              />
              <div className="flex justify-end px-2 pb-2">
                <button
                  type="button"
                  onClick={() => void addNote()}
                  disabled={!onChatsLine || !note.trim() || savingNote}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 cursor-pointer"
                >
                  {savingNote && <Spinner size="xs" label="Saving note" className="[&_svg]:text-white" />}
                  Add note
                </button>
              </div>
            </div>
            )}
            {data.notes.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 mt-3">No notes yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.notes.map((n) => (
                  <li key={n.id} className="flex gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {personInitials(n.author)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-gray-400">
                        <span className="font-semibold text-gray-700">{n.author ? personName(n.author) : "Someone"}</span> · {timeAgo(n.createdAt, now)}
                      </p>
                      <p className="text-[13px] text-gray-700 whitespace-pre-wrap break-words mt-0.5">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<History className="w-4 h-4" />} title="History">
            {data.history.length === 0 ? (
              <Muted>No assignment or follow-up changes yet.</Muted>
            ) : (
              <ul className="space-y-2.5">
                {data.history.map((h, i) => (
                  <li key={`${h.createdAt}-${i}`} className="flex gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {initials(h.actorUsername ?? "System")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-gray-700 leading-snug">
                        <span className="font-semibold text-gray-900">{h.actorUsername ?? "System"}</span> {describeHistory(h)}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5" title={dateTime(h.createdAt)}>
                        {timeAgo(h.createdAt, now)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
