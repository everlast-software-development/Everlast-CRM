"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, FileText, MessagesSquare, MonitorPlay, RefreshCw } from "lucide-react";
import { apiGetSupervisionConversations, apiGetSupervisionOverview } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { homePathFor } from "@/lib/permissions";
import type { SupervisionConversation, SupervisionFilter, SupervisionOverview } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { ErrorPanel } from "@/components/ErrorPanel";
import { KpiStrip } from "@/components/supervision/KpiStrip";
import { AgentBoard, type AgentFilter } from "@/components/supervision/AgentBoard";
import { ConversationList, FILTER_TABS } from "@/components/supervision/ConversationList";
import { ConversationDetail } from "@/components/supervision/ConversationDetail";
import { personName } from "@/components/supervision/format";

// ── Supervision ───────────────────────────────────────────────────────────────
//
// The screen a supervisor lives in: who is waiting and for how long, what every
// agent is doing, and one chat in full on the right. Data spans ALL WhatsApp
// lines (the switcher doesn't scope it); the number filter here narrows it.
//
// Live: socket events schedule a debounced refresh; a 30s poll covers lines this
// socket isn't in (the socket only joins the active number's room).
//
// The filter, agent, line and open chat live in the URL. Switching the
// active number (needed to act on another line's chat) remounts the dashboard,
// and the URL is what brings the supervisor straight back to the same chat.

const PAGE = 30;
const POLL_MS = 15_000;
const DEBOUNCE_MS = 800;
const LIVE_EVENTS = ["message.created", "conversation.updated", "conversation.assigned", "conversation.outcome", "conversation.note", "flow.handoff"];

type ListState = { key: string; rows: SupervisionConversation[] | null; total: number | null; error: Error | null };

const SECTION_SCROLL =
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/25 [&::-webkit-scrollbar-thumb]:rounded-full";

function parseAgent(v: string | null): AgentFilter {
  if (v === "unassigned") return "unassigned";
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
}

function parsePositiveInt(v: string | null): number | null {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
}

function updatedLabel(at: number | null, now: number): string {
  if (!at) return "Loading…";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  return `Updated ${Math.floor(s / 60)}m ago`;
}

function AccessRestricted() {
  const router = useRouter();
  const { me } = useCurrentUser();
  return (
    <div className="flex-1 overflow-y-auto bg-canvas px-6">
      <div className="max-w-md mx-auto mt-16 bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h2 className="text-[17px] font-bold text-gray-700 mb-2">Access Restricted</h2>
        <p className="text-[13px] text-gray-400">Supervision is for supervisors and admins. Ask an admin if you need it.</p>
        <button
          type="button"
          onClick={() => router.push(homePathFor(me))}
          className="mt-6 inline-flex items-center gap-2 bg-brand hover:bg-[#2f5840] active:bg-[#264a33] text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl transition-colors cursor-pointer"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

function SupervisionScreen() {
  const params = useSearchParams();
  const toast = useToast();
  const { numbers } = useActiveNumber();

  // ── Selection (mirrored to the URL) ──
  const [filter, setFilter] = useState<SupervisionFilter>(() => {
    const f = params.get("filter");
    return FILTER_TABS.some((t) => t.value === f) ? (f as SupervisionFilter) : "waiting";
  });
  const [agentFilter, setAgentFilter] = useState<AgentFilter>(() => parseAgent(params.get("agent")));
  const [numberId, setNumberId] = useState<number | undefined>(() => parsePositiveInt(params.get("number")) ?? undefined);
  const [selectedId, setSelectedId] = useState<number | null>(() => parsePositiveInt(params.get("c")));
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // ── Data ──
  const [overview, setOverview] = useState<SupervisionOverview | null>(null);
  const [overviewError, setOverviewError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [list, setList] = useState<ListState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<ListState | null>(null);

  useEffect(() => {
    listRef.current = list;
  }, [list]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (filter !== "waiting") q.set("filter", filter);
    if (agentFilter !== null) q.set("agent", String(agentFilter));
    if (numberId) q.set("number", String(numberId));
    if (selectedId) q.set("c", String(selectedId));
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filter, agentFilter, numberId, selectedId]);

  // Search is server-side; wait for the typing to settle.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Clock for "x ago" labels.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // ── Live: socket events (debounced) + poll ──
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
    }, POLL_MS);
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

  // ── Overview (KPIs + agents) ──
  useEffect(() => {
    let cancelled = false;
    apiGetSupervisionOverview(numberId)
      .then((res) => {
        if (cancelled) return;
        setOverview(res.data);
        setOverviewError(null);
        setLastUpdated(Date.now());
      })
      .catch((err) => {
        if (!cancelled) setOverviewError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [numberId, refreshKey, retry]);

  // ── Chat list ──
  const listKey = `${filter}|${agentFilter ?? ""}|${numberId ?? ""}|${query}`;

  useEffect(() => {
    let cancelled = false;
    const prev = listRef.current;
    const prevRows = prev && prev.key === listKey ? prev.rows : null;
    // A refresh reloads everything already on screen (up to 100), so live
    // updates don't snap a scrolled list back to its first page.
    const loaded = prevRows?.length ?? 0;
    const limit = prevRows ? Math.min(100, Math.max(PAGE, Math.ceil(loaded / PAGE) * PAGE)) : PAGE;
    apiGetSupervisionConversations({
      filter,
      agentId: agentFilter ?? undefined,
      numberId,
      search: query || undefined,
      page: 1,
      limit,
    })
      .then((res) => {
        if (cancelled) return;
        let rows = res.data;
        if (prevRows && loaded > limit) {
          const seen = new Set(rows.map((r) => r.id));
          rows = [...rows, ...prevRows.slice(limit).filter((r) => !seen.has(r.id))];
        }
        setList({ key: listKey, rows, total: res.pagination.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setList((p) =>
          p && p.key === listKey && p.rows ? p : { key: listKey, rows: null, total: null, error: err instanceof Error ? err : new Error(String(err)) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [listKey, filter, agentFilter, numberId, query, refreshKey, retry]);

  const current = list && list.key === listKey ? list : null;
  const rows = current?.rows ?? null;
  const total = current?.total ?? null;
  const hasMore = !!rows && total !== null && rows.length < total;

  const loadMore = useCallback(async () => {
    const cur = listRef.current;
    if (!cur?.rows || loadingMore || cur.key !== listKey || cur.rows.length >= (cur.total ?? 0)) return;
    setLoadingMore(true);
    try {
      const res = await apiGetSupervisionConversations({
        filter,
        agentId: agentFilter ?? undefined,
        numberId,
        search: query || undefined,
        page: Math.floor(cur.rows.length / PAGE) + 1,
        limit: PAGE,
      });
      setList((p) => {
        if (!p || p.key !== cur.key || !p.rows) return p;
        const seen = new Set(p.rows.map((r) => r.id));
        return { ...p, rows: [...p.rows, ...res.data.filter((r) => !seen.has(r.id))], total: res.pagination.total };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load more chats");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, listKey, filter, agentFilter, numberId, query, toast]);

  // ── Derived ──
  const agentLabel = useMemo(() => {
    if (agentFilter === null) return null;
    if (agentFilter === "unassigned") return "Unassigned chats";
    const a = overview?.agents.find((x) => x.id === agentFilter);
    return a ? `${personName(a)}’s chats` : "One agent’s chats";
  }, [agentFilter, overview]);

  const counts = useMemo(() => {
    const c: Partial<Record<SupervisionFilter, number>> = {};
    if (overview) {
      const k = overview.kpis;
      if (agentFilter === null) {
        c.waiting = k.waiting;
        c.unread = k.unreadChats;
        c.cold = k.goneCold;
      } else if (agentFilter === "unassigned") {
        c.waiting = k.unassignedWaiting;
        c.unread = k.unreadUnassignedChats;
      } else {
        const a = overview.agents.find((x) => x.id === agentFilter);
        if (a) {
          c.waiting = a.waiting;
          c.unread = a.unreadChats;
        }
      }
    }
    // The open tab's own total is exact, whatever the filters.
    if (total !== null && !query) c[filter] = total;
    return c;
  }, [overview, agentFilter, total, filter, query]);

  const slaMinutes = overview?.slaMinutes ?? 30;

  const pickFilter = (f: SupervisionFilter) => setFilter(f);
  const pickAgent = (a: AgentFilter) => setAgentFilter(a);
  const refreshNow = () => setRefreshKey((k) => k + 1);

  // Escape closes the open chat (mostly for the mobile drawer).
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || t?.closest("input, textarea, [role=listbox]")) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  if (overviewError && !overview) {
    return <ErrorPanel error={overviewError} reset={() => setRetry((n) => n + 1)} title="Couldn't load Supervision" />;
  }

  return (
    <div className={`flex-1 overflow-y-auto bg-canvas ${SECTION_SCROLL}`}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-gray-900 flex items-center gap-2">
              <Eye className="w-5 h-5 text-brand-fg" />
              Supervision
            </h1>
            <p className="text-[13px] text-gray-400 mt-0.5">
              Who&apos;s waiting, what every agent is doing, and every chat across all WhatsApp lines — live.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {numbers.length > 1 && (
              <select
                value={numberId ?? ""}
                onChange={(e) => setNumberId(e.target.value ? Number(e.target.value) : undefined)}
                aria-label="WhatsApp line"
                className="h-[38px] text-[13px] font-medium text-gray-700 bg-white border border-gray-200 hover:border-gray-300 rounded-xl pl-3 pr-8 outline-none focus:border-brand/50 cursor-pointer"
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
            <Link
              href={`/supervision/live${numberId ? `?number=${numberId}` : ""}`}
              title="Full-screen live dashboard for a wall screen"
              className="flex items-center gap-1.5 h-[38px] text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3.5 rounded-xl transition-colors"
            >
              <MonitorPlay className="w-4 h-4" />
              Live view
            </Link>
            <Link
              href={`/supervision/reports${numberId ? `?number=${numberId}` : ""}`}
              title="Supervisor reports for a period — PDF, CSV and Excel"
              className="flex items-center gap-1.5 h-[38px] text-[13px] font-semibold text-brand-fg bg-white border border-brand/30 hover:bg-brand-100 px-3.5 rounded-xl transition-colors"
            >
              <FileText className="w-4 h-4" />
              Report
            </Link>
            <button
              type="button"
              onClick={refreshNow}
              title="Refresh now"
              className="flex items-center gap-1.5 h-[38px] text-[12px] text-gray-500 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 bg-white px-3 rounded-xl transition-colors cursor-pointer"
            >
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-green-500" />
              </span>
              <span className="tabular-nums">{updatedLabel(lastUpdated, now)}</span>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <KpiStrip overview={overview} loading={!overview} filter={filter} onFilter={pickFilter} />

        <AgentBoard overview={overview} loading={!overview} agentFilter={agentFilter} onAgentFilter={pickAgent} now={now} onHandedOver={refreshNow} />

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden lg:grid lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:h-[calc(100dvh-7rem)] lg:min-h-[560px]">
          {/* Master: the chat list */}
          <div className="flex flex-col min-h-0 h-[75dvh] lg:h-auto lg:border-r border-gray-100">
            {current?.error && !rows ? (
              <ErrorPanel compact error={current.error} reset={() => setRetry((n) => n + 1)} title="Couldn't load chats" />
            ) : (
              <ConversationList
                filter={filter}
                onFilter={setFilter}
                counts={counts}
                search={search}
                onSearch={setSearch}
                rows={rows}
                total={total}
                loading={!current}
                loadingMore={loadingMore}
                hasMore={hasMore}
                onLoadMore={loadMore}
                selectedId={selectedId}
                onSelect={setSelectedId}
                slaMinutes={slaMinutes}
                now={now}
                scopeLabel={agentLabel}
              />
            )}
          </div>

          {/* Detail: a column on desktop, a full-screen drawer below lg */}
          {selectedId !== null ? (
            <div className="fixed inset-0 z-[70] flex flex-col bg-white lg:static lg:z-auto min-h-0">
              <ConversationDetail
                key={selectedId}
                conversationId={selectedId}
                refreshKey={refreshKey}
                now={now}
                onClose={() => setSelectedId(null)}
                onChanged={refreshNow}
                onOpenChat={(id) => setSelectedId(id)}
              />
            </div>
          ) : (
            <div className="hidden lg:flex flex-col items-center justify-center text-center px-8 bg-canvas">
              <div className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center mb-3">
                <MessagesSquare className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-[14px] font-semibold text-gray-700">Pick a chat to see it in full</p>
              <p className="text-[12.5px] text-gray-400 mt-1 max-w-xs">
                Latest messages, how long each reply took, flow answers, notes and who handled it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SupervisionPage() {
  const { ready, can } = useCurrentUser();
  if (!ready) return <PageSpinner />;
  if (!can("team:supervise")) return <AccessRestricted />;
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<PageSpinner />}>
      <SupervisionScreen />
    </Suspense>
  );
}
