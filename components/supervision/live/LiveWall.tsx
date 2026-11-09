"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  Clock,
  Inbox,
  Maximize,
  Minimize,
  Moon,
  Snowflake,
  Timer,
  UserRound,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { apiGetSupervisionActivity, apiGetSupervisionConversations, apiGetSupervisionOverview } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { SupervisionActivity, SupervisionAgent, SupervisionConversation, SupervisionOverview } from "@/types";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { WaitChip, PRESENCE } from "../chips";
import { formatMinutes, messagePreview, patientName, personInitials, personName, timeAgo } from "../format";
import { TONE, describeActivity, type Tone } from "./activity";
import { ThemeToggleButton } from "@/components/ThemeToggle";

// ── Live wall ───────────────────────────────────────────────────────────────
//
// A high-contrast operations board meant to be left on a TV: KPIs, every
// agent, who needs a reply now, and a live feed of what the team is doing.
// Follows the app's light/dark theme (toggle in the top bar). Colours come from
// the wall-* tokens in app/globals.css: `wall-ink` is the text / hairline
// colour (near-black on light, white on dark), and accents use the -700 shades,
// which the dark palette maps back to the bright -300s.
// It is a fixed full-viewport layer over the app (the sidebar never shows);
// "Full screen" additionally hides the browser chrome via the Fullscreen API.
//
// Refresh: overview + needs-attention every 15s and on socket events
// (debounced); the feed polls every 5s with `after` = newest item's time.

const OVERVIEW_POLL_MS = 10_000;
const FEED_POLL_MS = 3_000;
const DEBOUNCE_MS = 1_000;
const FEED_KEEP = 100;
const TOAST_MS = 6_000;
const TOAST_MAX = 3;
const ATTENTION_LIMIT = 40;
const LIVE_EVENTS = [
  "message.created",
  "conversation.updated",
  "conversation.assigned",
  "conversation.outcome",
  "flow.handoff",
];

const PRESENCE_ORDER = { ONLINE: 0, ON_BREAK: 1, OFFLINE: 2 } as const;

const SCROLL =
  "overflow-y-auto [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklab,var(--color-wall-ink)_15%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-wall-ink/15 [&::-webkit-scrollbar-thumb]:rounded-full";

const PANEL = "bg-wall-panel border border-wall-ink/[0.07] rounded-2xl shadow-[0_1px_2px_rgba(15,29,22,0.05)] dark:shadow-none";

type Toast = { id: string; tone: Tone; icon: ReactNode; title: string; body: string | null; conversationId: number | null };
type FeedState = { key: string; items: SupervisionActivity[]; error: boolean };
type AttentionState = { key: string; rows: SupervisionConversation[]; total: number };

function parsePositiveInt(v: string | null): number | null {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
}

// ── Small live pieces with their own clocks (so the wall doesn't re-render every second) ──

function DubaiClock() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false });
  const secs = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai", second: "2-digit" }).padStart(2, "0");
  const date = d.toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="flex items-baseline gap-2 tabular-nums" title="Dubai time">
      <span className="text-[28px] 2xl:text-[34px] font-bold text-wall-ink leading-none">
        {time}
        <span className="text-wall-ink/35 text-[0.6em] ml-0.5">:{secs}</span>
      </span>
      <span className="text-[13px] text-wall-ink/50 font-medium hidden md:inline">{date} · Dubai</span>
    </div>
  );
}

function UpdatedAgo({ at, stale }: { at: number | null; stale: boolean }) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const s = at ? Math.max(0, Math.round((t - at) / 1000)) : null;
  const label = s === null ? "Connecting…" : s < 5 ? "Updated just now" : s < 60 ? `Updated ${s}s ago` : `Updated ${Math.floor(s / 60)}m ago`;
  const bad = stale || (s !== null && s > 60);
  return (
    <span className={`flex items-center gap-2 text-[13px] font-medium tabular-nums ${bad ? "text-amber-700" : "text-wall-ink/60"}`}>
      <span className="relative flex w-2.5 h-2.5">
        {!bad && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />}
        <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${bad ? "bg-amber-400" : "bg-emerald-400"}`} />
      </span>
      {bad && stale ? "Reconnecting…" : label}
    </span>
  );
}

// ── KPI tile ──

function Kpi({
  label,
  icon,
  value,
  sub,
  alert,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`${PANEL} relative px-5 py-4 flex flex-col min-w-0 overflow-hidden ${alert ? "!border-red-400/40 !bg-red-500/[0.08]" : ""}`}>
      {alert && <span aria-hidden className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-red-400" />}
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] 2xl:text-[13px] font-semibold uppercase tracking-wider text-wall-ink/50 truncate">{label}</span>
        <span className={alert ? "text-red-700" : "text-wall-ink/30"}>{icon}</span>
      </span>
      <span
        className={`text-[40px] 2xl:text-[52px] font-bold leading-none tabular-nums mt-2 ${
          alert ? "text-red-700" : "text-wall-ink"
        }`}
      >
        {value}
      </span>
      <span className="text-[13px] 2xl:text-[14px] font-medium text-wall-ink/50 mt-2 truncate min-h-[18px]">{sub}</span>
    </div>
  );
}

function KpiRow({ overview }: { overview: SupervisionOverview | null }) {
  if (!overview) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 2xl:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${PANEL} h-[132px] 2xl:h-[148px] animate-pulse`} />
        ))}
      </div>
    );
  }
  const k = overview.kpis;
  const sla = overview.slaMinutes;
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 2xl:gap-4">
      <Kpi
        label="Waiting now"
        icon={<Clock className="w-5 h-5" />}
        value={k.waiting}
        alert={k.waitingOverSla > 0}
        sub={
          k.waiting === 0 ? (
            "Nobody is waiting"
          ) : k.waitingOverSla > 0 ? (
            <>
              <span className="text-red-700 font-bold">{k.waitingOverSla} over {sla} min</span> · longest {formatMinutes(k.longestWaitMinutes)}
            </>
          ) : (
            <>
              <span className="text-emerald-700">All under {sla} min</span> · longest {formatMinutes(k.longestWaitMinutes)}
            </>
          )
        }
      />
      <Kpi
        label="Gone cold"
        icon={<Snowflake className="w-5 h-5" />}
        value={k.goneCold}
        sub={k.goneCold > 0 ? <span className="text-amber-700">Waiting over a day</span> : "None waiting over a day"}
      />
      <Kpi
        label="Avg first response"
        icon={<Timer className="w-5 h-5" />}
        value={formatMinutes(k.avgFirstResponseMinutes)}
        alert={k.avgFirstResponseMinutes !== null && k.avgFirstResponseMinutes >= sla}
        sub={
          k.unansweredToday > 0 ? <span className="text-red-700 font-semibold">{k.unansweredToday} unanswered today</span> : "Today · working time"
        }
      />
      <Kpi
        label="Follow-ups due"
        icon={<Inbox className="w-5 h-5" />}
        value={k.followUpsDue}
        alert={k.followUpsDue > 0}
        sub={k.followUpsDue > 0 ? <span className="text-red-700 font-semibold">Due now or overdue</span> : "Nothing due"}
      />
    </div>
  );
}

// ── Agents ──

function AgentStat({ label, value, tone }: { label: string; value: string | number; tone?: "red" | "muted" }) {
  return (
    <div className="min-w-0">
      <p
        className={`text-[20px] 2xl:text-[22px] font-bold leading-none tabular-nums ${
          tone === "red" ? "text-red-700" : tone === "muted" ? "text-wall-ink/25" : "text-wall-ink"
        }`}
      >
        {value}
      </p>
      <p className="text-[10.5px] 2xl:text-[11px] font-semibold text-wall-ink/40 uppercase tracking-wider mt-1 truncate">{label}</p>
    </div>
  );
}

function AgentTile({ agent, slaMinutes, now }: { agent: SupervisionAgent; slaMinutes: number; now: number }) {
  const presence = PRESENCE[agent.status] ?? PRESENCE.OFFLINE;
  const online = agent.status === "ONLINE";
  const late = agent.waitingOverSla > 0;
  const sinceReply = agent.lastReplyAt ? (now - new Date(agent.lastReplyAt).getTime()) / 60_000 : null;
  // Online, people waiting on them, and no reply for a while: worth a look.
  const quiet = online && agent.waiting > 0 && (sinceReply === null || sinceReply > slaMinutes);
  return (
    <div
      className={`${PANEL} p-3.5 2xl:p-4 ${agent.status === "OFFLINE" ? "opacity-55" : ""} ${late ? "!border-red-400/40" : ""}`}
    >
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <span
            className={`w-11 h-11 rounded-full flex items-center justify-center text-[14px] font-bold ${
              online ? "bg-brand text-white" : "bg-wall-ink/10 text-wall-ink/60"
            }`}
          >
            {personInitials(agent)}
          </span>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-[3px] ring-wall-panel ${presence.dot}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] 2xl:text-[17px] font-bold text-wall-ink truncate leading-tight">{personName(agent)}</p>
          <p className="text-[12.5px] truncate mt-0.5">
            <span className={online ? "text-emerald-700" : agent.status === "ON_BREAK" ? "text-amber-700" : "text-wall-ink/40"}>{presence.label}</span>
            <span className={quiet ? "text-amber-700 font-semibold" : "text-wall-ink/45"}>
              {" · "}
              {agent.lastReplyAt ? `replied ${timeAgo(agent.lastReplyAt, now)}` : "no replies yet today"}
            </span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-wall-ink/[0.06]">
        <AgentStat label="Open" value={agent.openChats} tone={agent.openChats === 0 ? "muted" : undefined} />
        <AgentStat
          label={late ? `${agent.waitingOverSla} late` : "Waiting"}
          value={agent.waiting}
          tone={late ? "red" : agent.waiting === 0 ? "muted" : undefined}
        />
        <AgentStat label="Answered" value={agent.answeredToday} tone={agent.answeredToday === 0 ? "muted" : undefined} />
        <AgentStat label="Avg" value={formatMinutes(agent.avgResponseMinutes)} tone={agent.avgResponseMinutes === null ? "muted" : undefined} />
      </div>
    </div>
  );
}

// ── Section header ──

function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 mb-2.5 shrink-0">
      <h2 className="flex items-center gap-2 text-[13px] 2xl:text-[14px] font-bold uppercase tracking-[0.12em] text-wall-ink/70">
        {icon}
        {title}
      </h2>
      {right && <div className="text-[13px] text-wall-ink/50 font-medium">{right}</div>}
    </div>
  );
}

function LineChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-[11px] font-semibold text-wall-ink/60 bg-wall-ink/[0.07] border border-wall-ink/[0.08] rounded px-1.5 py-px max-w-[150px] truncate">
      {label}
    </span>
  );
}

// ── Sound ──

function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  const prime = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctxRef.current = new Ctor();
    }
    void ctxRef.current.resume().catch(() => {});
  }, []);
  const beep = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + 0.22);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }, []);
  useEffect(
    () => () => {
      void ctxRef.current?.close().catch(() => {});
    },
    [],
  );
  return { prime, beep };
}

// ── The wall ──

export function LiveWall() {
  const router = useRouter();
  const params = useSearchParams();
  const { numbers } = useActiveNumber();

  const [numberId, setNumberId] = useState<number | undefined>(() => parsePositiveInt(params.get("number")) ?? undefined);
  const key = String(numberId ?? "all");

  const [overview, setOverview] = useState<{ key: string; data: SupervisionOverview } | null>(null);
  const [overviewStale, setOverviewStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [attention, setAttention] = useState<AttentionState | null>(null);
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sound, setSound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  const soundRef = useRef(sound);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const prevAgents = useRef<{ key: string; status: Map<number, SupervisionAgent["status"]> } | null>(null);
  const prevOverSla = useRef<{ key: string; ids: Set<number> } | null>(null);
  const { prime, beep } = useBeep();

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // Line filter lives in the URL, like on the Supervision page.
  useEffect(() => {
    const q = new URLSearchParams();
    if (numberId) q.set("number", String(numberId));
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [numberId]);

  // Clock for "x ago" labels.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // ── Fullscreen ──
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // Leaving the wall (back button etc.) shouldn't strand the app in fullscreen.
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const leaveTo = useCallback(
    async (href: string) => {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      router.push(href);
    },
    [router],
  );
  const openChat = (conversationId: number) => void leaveTo(`/supervision?c=${conversationId}`);

  // ── Notifications ──
  const dismiss = useCallback((id: string) => {
    const t = toastTimers.current.get(id);
    if (t) clearTimeout(t);
    toastTimers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback(
    (items: Toast[]) => {
      if (items.length === 0) return;
      const fresh = items.slice(0, TOAST_MAX);
      setToasts((list) => {
        const next = [...fresh, ...list.filter((x) => !fresh.some((f) => f.id === x.id))];
        for (const dropped of next.slice(TOAST_MAX)) {
          const t = toastTimers.current.get(dropped.id);
          if (t) clearTimeout(t);
          toastTimers.current.delete(dropped.id);
        }
        return next.slice(0, TOAST_MAX);
      });
      for (const t of fresh) {
        if (toastTimers.current.has(t.id)) continue;
        toastTimers.current.set(
          t.id,
          setTimeout(() => dismiss(t.id), TOAST_MS),
        );
      }
      if (soundRef.current) beep();
    },
    [beep, dismiss],
  );

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // ── Live: socket (debounced) + 10s poll ──
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => setRefreshKey((k) => k + 1);
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(bump, DEBOUNCE_MS);
    };
    const socket = getSocket();
    LIVE_EVENTS.forEach((e) => socket.on(e, schedule));
    const poll = setInterval(() => {
      if (!document.hidden) bump();
    }, OVERVIEW_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      LIVE_EVENTS.forEach((e) => socket.off(e, schedule));
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ── Overview ──
  useEffect(() => {
    let cancelled = false;
    apiGetSupervisionOverview(numberId)
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        // Agents who just went offline / on break.
        const prev = prevAgents.current;
        if (prev && prev.key === key) {
          const out: Toast[] = [];
          for (const a of data.agents) {
            const was = prev.status.get(a.id);
            if (was === "ONLINE" && a.status !== "ONLINE") {
              out.push({
                id: `presence-${a.id}-${a.status}-${Date.now()}`,
                tone: a.status === "ON_BREAK" ? "amber" : "gray",
                icon: a.status === "ON_BREAK" ? <Moon className="w-[18px] h-[18px]" /> : <UserRound className="w-[18px] h-[18px]" />,
                title: `${personName(a)} ${a.status === "ON_BREAK" ? "went on break" : "went offline"}`,
                body: a.waiting > 0 ? `${a.waiting} patient${a.waiting === 1 ? "" : "s"} waiting on them` : a.openChats > 0 ? `${a.openChats} open chats` : null,
                conversationId: null,
              });
            }
          }
          notify(out);
        }
        prevAgents.current = { key, status: new Map(data.agents.map((a) => [a.id, a.status])) };
        setOverview({ key, data });
        setOverviewStale(false);
        setLastUpdated(Date.now());
      })
      .catch(() => {
        if (!cancelled) setOverviewStale(true);
      });
    return () => {
      cancelled = true;
    };
  }, [numberId, key, refreshKey, notify]);

  // ── Needs attention ──
  useEffect(() => {
    let cancelled = false;
    apiGetSupervisionConversations({ filter: "waiting", numberId, page: 1, limit: ATTENTION_LIMIT })
      .then((res) => {
        if (cancelled) return;
        const rows = [...res.data].sort(
          (a, b) => Number(b.overSla) - Number(a.overSla) || (b.waitingMinutes ?? 0) - (a.waitingMinutes ?? 0),
        );
        const sla = res.slaMinutes ?? 30;
        // Patients whose wait just crossed the SLA since the last refresh.
        const prev = prevOverSla.current;
        if (prev && prev.key === key) {
          const crossed = rows.filter(
            (r) => r.overSla && !prev.ids.has(r.id) && (r.waitingMinutes ?? 0) < sla + 10,
          );
          notify(
            crossed.map((r) => ({
              id: `sla-${r.id}-${r.awaitingReplySince ?? ""}`,
              tone: "red" as const,
              icon: <AlertTriangle className="w-[18px] h-[18px]" />,
              title: `${patientName(r.customer)} waiting over ${sla} min`,
              body: r.assignedAgent ? `With ${personName(r.assignedAgent)}` : "Unassigned — nobody has this chat",
              conversationId: r.id,
            })),
          );
        }
        prevOverSla.current = { key, ids: new Set(rows.filter((r) => r.overSla).map((r) => r.id)) };
        setAttention({ key, rows, total: res.pagination.total });
      })
      .catch(() => {
        /* keep the last list; the top bar shows the connection state */
      });
    return () => {
      cancelled = true;
    };
  }, [numberId, key, refreshKey, notify]);

  // ── Feed: initial 40, then poll every 5s for what's new ──
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let loaded = false;
    let newest: string | null = null;
    const seen = new Set<string>();

    const byTimeDesc = (a: SupervisionActivity, b: SupervisionActivity) => new Date(b.at).getTime() - new Date(a.at).getTime();

    const tick = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        if (!loaded) {
          const res = await apiGetSupervisionActivity({ limit: 40, numberId });
          if (cancelled) return;
          const items = [...res.data].sort(byTimeDesc);
          items.forEach((i) => seen.add(i.id));
          newest = items[0]?.at ?? res.serverTime ?? new Date().toISOString();
          loaded = true;
          setFeed({ key, items: items.slice(0, FEED_KEEP), error: false });
        } else {
          const res = await apiGetSupervisionActivity({ after: newest ?? undefined, limit: 50, numberId });
          if (cancelled) return;
          const fresh = res.data.filter((i) => !seen.has(i.id)).sort(byTimeDesc);
          fresh.forEach((i) => seen.add(i.id));
          if (fresh.length > 0) {
            if (!newest || new Date(fresh[0].at).getTime() > new Date(newest).getTime()) newest = fresh[0].at;
            setFeed((p) => ({
              key,
              items: [...fresh, ...(p && p.key === key ? p.items : [])].slice(0, FEED_KEEP),
              error: false,
            }));
            notify(
              fresh
                .map((a) => ({ a, d: describeActivity(a) }))
                .filter((x) => x.d.notify)
                .map(({ a, d }) => ({
                  id: `feed-${a.id}`,
                  tone: d.tone,
                  icon: d.icon,
                  title: d.plainTitle,
                  body: d.text,
                  conversationId: a.conversationId,
                })),
            );
          } else {
            setFeed((p) => (p && p.error ? { ...p, error: false } : p));
          }
        }
      } catch {
        if (!cancelled) setFeed((p) => (p && p.key === key ? { ...p, error: true } : { key, items: [], error: true }));
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const id = setInterval(() => {
      if (!document.hidden) void tick();
    }, FEED_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [numberId, key, notify]);

  // ── Derived ──
  const ov = overview && overview.key === key ? overview.data : null;
  const slaMinutes = ov?.slaMinutes ?? 30;
  const agents = useMemo(
    () =>
      [...(ov?.agents ?? [])].sort(
        (a, b) =>
          (PRESENCE_ORDER[a.status] ?? 3) - (PRESENCE_ORDER[b.status] ?? 3) || personName(a).localeCompare(personName(b)),
      ),
    [ov],
  );
  const onlineCount = agents.filter((a) => a.status === "ONLINE").length;
  const att = attention && attention.key === key ? attention : null;
  const overCount = att?.rows.filter((r) => r.overSla).length ?? 0;
  const feedNow = feed && feed.key === key ? feed : null;
  const showLines = numbers.length > 1;

  const toggleSound = () => {
    if (!sound) {
      prime();
      setTimeout(beep, 50);
    }
    setSound((s) => !s);
  };

  return (
    <div
      className={`fixed inset-0 z-[60] bg-wall text-wall-ink flex flex-col overflow-y-auto lg:overflow-hidden ${SCROLL} antialiased`}
      style={{ backgroundImage: "radial-gradient(1200px 500px at 85% -10%, var(--wall-glow), transparent 60%)" }}
    >
      {/* Top bar */}
      <header className="shrink-0 flex items-center gap-4 flex-wrap px-5 2xl:px-7 py-3 border-b border-wall-ink/[0.07]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-white" />
          </span>
          <h1 className="text-[20px] 2xl:text-[22px] font-bold tracking-tight whitespace-nowrap">
            <span className="text-emerald-700">Live</span>
            <span className="text-wall-ink/30 mx-2">·</span>
            Supervision
          </h1>
        </div>
        <DubaiClock />
        <div className="ml-auto flex items-center gap-2.5 flex-wrap">
          <UpdatedAgo at={lastUpdated} stale={overviewStale} />
          {showLines && (
            <select
              value={numberId ?? ""}
              onChange={(e) => setNumberId(e.target.value ? Number(e.target.value) : undefined)}
              aria-label="WhatsApp line"
              className="h-9 text-[13px] font-medium text-wall-ink bg-wall-ink/[0.06] border border-wall-ink/10 hover:border-wall-ink/20 rounded-lg pl-3 pr-8 outline-none focus:border-emerald-400/50 cursor-pointer [&>option]:text-gray-900"
            >
              <option value="">All lines</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                  {n.displayPhoneNumber ? ` · ${n.displayPhoneNumber}` : ""}
                </option>
              ))}
            </select>
          )}
          <ThemeToggleButton className="h-9 w-9 flex items-center justify-center rounded-lg border bg-wall-ink/[0.06] border-wall-ink/10 text-wall-ink/60 hover:text-wall-ink transition-colors cursor-pointer" />
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            title={sound ? "Sound on — click to mute" : "Sound off — click for a soft beep on notifications"}
            className={`h-9 w-9 flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              sound ? "bg-brand border-brand text-white" : "bg-wall-ink/[0.06] border-wall-ink/10 text-wall-ink/60 hover:text-wall-ink"
            }`}
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-wall-ink/[0.06] border border-wall-ink/10 text-[13px] font-semibold text-wall-ink/80 hover:text-wall-ink hover:bg-wall-ink/10 transition-colors cursor-pointer"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            <span className="hidden sm:inline">{isFullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>
          <button
            type="button"
            onClick={() => void leaveTo(`/supervision${numberId ? `?number=${numberId}` : ""}`)}
            title="Back to Supervision"
            className="h-9 flex items-center gap-1.5 px-3 rounded-lg text-[13px] font-semibold text-wall-ink/50 hover:text-wall-ink hover:bg-wall-ink/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
            Exit
          </button>
        </div>
      </header>

      <main className="flex-1 lg:min-h-0 flex flex-col gap-3 2xl:gap-4 px-5 2xl:px-7 py-4">
        <KpiRow overview={ov} />

        <div className="flex-1 lg:min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,36%)] 2xl:grid-cols-[minmax(0,1fr)_minmax(480px,34%)] gap-3 2xl:gap-4">
          {/* Left: team + needs attention */}
          <div className="min-h-0 flex flex-col gap-3 2xl:gap-4">
            <section className="shrink-0 flex flex-col min-h-0 lg:max-h-[46%]">
              <SectionHead
                icon={<Users className="w-4 h-4 text-emerald-700" />}
                title="Team"
                right={ov ? `${onlineCount} of ${agents.length} online` : null}
              />
              <div className={`min-h-0 ${SCROLL} pr-1`}>
                {!ov ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className={`${PANEL} h-[124px] animate-pulse`} />
                    ))}
                  </div>
                ) : agents.length === 0 ? (
                  <div className={`${PANEL} px-5 py-6 text-[14px] text-wall-ink/50`}>No agents on the team yet.</div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                    {agents.map((a) => (
                      <AgentTile key={a.id} agent={a} slaMinutes={slaMinutes} now={now} />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className={`${PANEL} flex-1 min-h-[280px] lg:min-h-0 flex flex-col pt-3.5 overflow-hidden`}>
              <div className="px-4">
                <SectionHead
                  icon={<AlertTriangle className={`w-4 h-4 ${overCount > 0 ? "text-red-700" : "text-amber-700"}`} />}
                  title="Needs attention now"
                  right={
                    att ? (
                      <>
                        {att.total} waiting
                        {overCount > 0 && <span className="text-red-700 font-bold"> · {overCount} over {slaMinutes} min</span>}
                      </>
                    ) : null
                  }
                />
              </div>
              <div className={`flex-1 min-h-0 ${SCROLL}`}>
                {!att ? (
                  <div className="px-4 space-y-2.5 animate-pulse">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-12 bg-wall-ink/[0.04] rounded-lg" />
                    ))}
                  </div>
                ) : att.rows.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <span className="w-14 h-14 rounded-full bg-emerald-400/15 dark:bg-brand/40 flex items-center justify-center mb-3">
                      <CalendarCheck className="w-7 h-7 text-emerald-700" />
                    </span>
                    <p className="text-[18px] font-bold text-wall-ink">Nobody is waiting</p>
                    <p className="text-[14px] text-wall-ink/50 mt-1">Every patient has had a reply.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-wall-ink/[0.05]">
                    {att.rows.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => openChat(r.id)}
                          className={`w-full text-left grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_auto] xl:grid-cols-[minmax(0,1fr)_minmax(0,150px)_minmax(0,1.4fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-wall-ink/[0.04] transition-colors cursor-pointer ${
                            r.overSla ? "bg-red-500/[0.06]" : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 min-w-0">
                              {r.overSla && <span className="w-2 h-2 rounded-full bg-red-400 shrink-0 animate-pulse" />}
                              <span className="text-[15px] 2xl:text-[16px] font-bold text-wall-ink truncate">{patientName(r.customer)}</span>
                            </span>
                            {showLines && (
                              <span className="block mt-0.5">
                                <LineChip label={r.whatsappNumber.label} />
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 text-[13.5px] truncate">
                            {r.assignedAgent ? (
                              <span className="text-wall-ink/80 font-medium">{personName(r.assignedAgent)}</span>
                            ) : (
                              <span className="text-amber-700 font-semibold">Unassigned</span>
                            )}
                          </span>
                          <span className="bidi-line hidden xl:block min-w-0 text-[13px] text-wall-ink/50 truncate">
                            {r.lastMessage ? messagePreview({ content: r.lastMessage }) : "—"}
                          </span>
                          <span className="justify-self-end">
                            <WaitChip minutes={r.waitingMinutes} slaMinutes={slaMinutes} size="md" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* Right: live feed */}
          <section className={`${PANEL} min-h-[420px] lg:min-h-0 flex flex-col pt-3.5 overflow-hidden`}>
            <div className="px-4">
              <SectionHead
                icon={
                  <span className="relative flex w-2.5 h-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  </span>
                }
                title="Live feed"
                right={feedNow?.error ? <span className="text-amber-700">Reconnecting…</span> : "Every 5s"}
              />
            </div>
            <div className={`flex-1 min-h-0 ${SCROLL} px-3 pb-3`}>
              {!feedNow ? (
                <div className="space-y-2.5 px-1 animate-pulse">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="h-[68px] bg-wall-ink/[0.04] rounded-xl" />
                  ))}
                </div>
              ) : feedNow.items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-10">
                  <Activity className="w-8 h-8 text-wall-ink/20 mb-2" />
                  <p className="text-[15px] font-semibold text-wall-ink/70">{feedNow.error ? "Couldn't load the feed" : "Quiet for now"}</p>
                  <p className="text-[13px] text-wall-ink/40 mt-1">Messages, hand-offs and follow-ups show up here as they happen.</p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {feedNow.items.map((a) => {
                    const d = describeActivity(a);
                    const tone = TONE[d.tone];
                    return (
                      <li
                        key={a.id}
                        className="transition-[opacity,transform] duration-500 ease-out starting:opacity-0 starting:-translate-y-2"
                      >
                        <button
                          type="button"
                          onClick={() => openChat(a.conversationId)}
                          className="relative w-full text-left flex gap-3 rounded-xl bg-wall-ink/[0.03] hover:bg-wall-ink/[0.07] border border-wall-ink/[0.05] pl-4 pr-3 py-2.5 transition-colors cursor-pointer overflow-hidden"
                        >
                          <span aria-hidden className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${tone.bar}`} />
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${tone.icon}`}>{d.icon}</span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-baseline gap-2">
                              <span className="flex-1 min-w-0 text-[14px] 2xl:text-[15px] text-wall-ink/75 leading-snug truncate">{d.title}</span>
                              <span className="text-[12px] text-wall-ink/40 tabular-nums shrink-0" title={new Date(a.at).toLocaleString()}>
                                {timeAgo(a.at, now)}
                              </span>
                            </span>
                            {d.text && (
                              <span className="block text-[13px] 2xl:text-[14px] text-wall-ink/55 leading-snug mt-0.5 line-clamp-2 break-words">{d.text}</span>
                            )}
                            {showLines && (
                              <span className="block mt-1">
                                <LineChip label={a.line.label} />
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Notifications */}
      <div className="fixed top-[72px] right-5 z-[61] w-[380px] max-w-[calc(100vw-2.5rem)] flex flex-col gap-2.5 pointer-events-none" aria-live="polite">
        {toasts.map((t) => {
          const tone = TONE[t.tone];
          return (
            <div
              key={t.id}
              className="pointer-events-auto relative flex gap-3 rounded-2xl bg-wall-raised/95 backdrop-blur border border-wall-ink/10 shadow-2xl shadow-black/10 dark:shadow-black/50 pl-4 pr-2 py-3 overflow-hidden transition-[opacity,transform] duration-300 ease-out starting:opacity-0 starting:translate-x-6"
            >
              <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} />
              <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tone.icon}`}>{t.icon}</span>
              <button
                type="button"
                disabled={t.conversationId === null}
                onClick={() => t.conversationId !== null && openChat(t.conversationId)}
                className="flex-1 min-w-0 text-left enabled:cursor-pointer"
              >
                <span className="block text-[15px] font-bold text-wall-ink leading-snug">{t.title}</span>
                {t.body && <span className="block text-[13px] text-wall-ink/60 leading-snug mt-0.5 line-clamp-2">{t.body}</span>}
              </button>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="self-start p-1 rounded-md text-wall-ink/40 hover:text-wall-ink hover:bg-wall-ink/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
