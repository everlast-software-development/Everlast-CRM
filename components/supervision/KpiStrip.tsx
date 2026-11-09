"use client";

import type { ReactNode } from "react";
import { CheckCheck, Clock, Inbox, MailOpen, Timer, Workflow } from "lucide-react";
import type { SupervisionFilter, SupervisionOverview } from "@/types";
import { formatMinutes } from "./format";

interface CardProps {
  title: string;
  icon: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  active?: boolean;
  alert?: boolean;
  onClick?: () => void;
}

// Same anatomy as the Dashboard's StatCard, made clickable: each card is a
// shortcut to the chat list filtered to exactly those chats. Also the
// Marketing dashboard's audience tiles.
export function KpiCard({ title, icon, value, sub, active, alert, onClick }: CardProps) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide leading-tight truncate">{title}</span>
        <span className={alert ? "text-red-500" : active ? "text-brand-fg" : "text-gray-300"}>{icon}</span>
      </span>
      <span className={`text-[26px] font-bold leading-tight tabular-nums ${alert ? "text-red-600" : "text-gray-900"}`}>{value}</span>
      <span className="text-[12px] font-medium leading-tight text-gray-400 min-h-[16px]">{sub}</span>
    </>
  );
  const base = "relative text-left bg-white rounded-xl border p-4 flex flex-col gap-1 transition-colors min-w-0";
  if (!onClick) {
    return <div className={`${base} border-gray-100`}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} cursor-pointer ${
        active
          ? "border-brand bg-brand-50 ring-1 ring-brand/15"
          : alert
            ? "border-red-200 hover:border-red-300 hover:bg-red-50/40"
            : "border-gray-100 hover:border-gray-200 hover:bg-gray-50/60"
      }`}
    >
      {alert && !active && <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-red-500" />}
      {body}
    </button>
  );
}

export function KpiStrip({
  overview,
  loading,
  filter,
  onFilter,
}: {
  overview: SupervisionOverview | null;
  loading: boolean;
  /** The list's current filter, or null when the list isn't showing. */
  filter: SupervisionFilter | null;
  onFilter: (f: SupervisionFilter) => void;
}) {
  if (!overview) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-[104px] bg-white rounded-xl border border-gray-100 p-4 ${loading ? "animate-pulse" : ""}`}>
            <div className="h-2.5 w-24 bg-gray-100 rounded" />
            <div className="h-6 w-12 bg-gray-100 rounded mt-3" />
            <div className="h-2.5 w-20 bg-gray-100 rounded mt-3" />
          </div>
        ))}
      </div>
    );
  }

  const k = overview.kpis;
  const sla = overview.slaMinutes;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard
        title="Waiting for reply"
        icon={<Clock className="w-4 h-4" />}
        value={k.waiting}
        alert={k.waitingOverSla > 0}
        active={filter === "waiting"}
        onClick={() => onFilter("waiting")}
        sub={
          k.waiting === 0 ? (
            "Nobody is waiting"
          ) : (
            <>
              {k.waitingOverSla > 0 ? (
                <span className="text-red-600 font-semibold">{k.waitingOverSla} over {sla} min</span>
              ) : (
                <span className="text-brand-fg">All under {sla} min</span>
              )}
              <span> · longest {formatMinutes(k.longestWaitMinutes)}</span>
            </>
          )
        }
      />
      <KpiCard
        title="Unread"
        icon={<MailOpen className="w-4 h-4" />}
        value={k.unreadChats}
        active={filter === "unread"}
        onClick={() => onFilter("unread")}
        sub={
          k.unreadChats === 0 ? (
            "Everything has been opened"
          ) : (
            <>
              {k.unreadMessages} message{k.unreadMessages === 1 ? "" : "s"}
              {k.unreadUnassignedChats > 0 && <span className="text-amber-600 font-semibold"> · {k.unreadUnassignedChats} unassigned</span>}
            </>
          )
        }
      />
      <KpiCard
        title="Answered today"
        icon={<CheckCheck className="w-4 h-4" />}
        value={k.answeredToday}
        sub="Patients replied to by the team"
      />
      <KpiCard
        title="Dropped halfway"
        icon={<Workflow className="w-4 h-4" />}
        value={k.droppedHalfwayToday}
        active={filter === "halfway"}
        onClick={() => onFilter("halfway")}
        sub={`Today · ${k.flowsStartedToday} flow${k.flowsStartedToday === 1 ? "" : "s"} started`}
      />
      <KpiCard
        title="Follow-ups due"
        icon={<Inbox className="w-4 h-4" />}
        value={k.followUpsDue}
        alert={k.followUpsDue > 0}
        active={filter === "follow_up"}
        onClick={() => onFilter("follow_up")}
        sub={k.followUpsDue > 0 ? <span className="text-red-600 font-semibold">Due now or overdue</span> : "Nothing due"}
      />
      <KpiCard
        title="Avg first response"
        icon={<Timer className="w-4 h-4" />}
        value={formatMinutes(k.avgFirstResponseMinutes)}
        alert={k.avgFirstResponseMinutes !== null && k.avgFirstResponseMinutes >= sla}
        sub={
          k.unansweredToday > 0 ? (
            <span className="text-red-600 font-semibold">{k.unansweredToday} unanswered today</span>
          ) : (
            "Today · working time"
          )
        }
      />
    </div>
  );
}
