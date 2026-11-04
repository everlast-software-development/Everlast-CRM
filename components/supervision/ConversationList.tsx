"use client";

import { Search, StickyNote, X } from "lucide-react";
import type { SupervisionConversation, SupervisionFilter } from "@/types";
import { Spinner } from "@/components/ui/spinner";
import { FlowChip, NumberChip, OutcomeChip, WaitChip } from "./chips";
import { WAIT_WARN_MINUTES, formatPhone, initials, messagePreview, patientName, personInitials, personName, timeAgo } from "./format";

export const FILTER_TABS: { value: SupervisionFilter; label: string }[] = [
  { value: "waiting", label: "Waiting" },
  { value: "cold", label: "Gone cold" },
  { value: "halfway", label: "Dropped halfway" },
  { value: "follow_up", label: "Follow up" },
  { value: "all", label: "All chats" },
];

const EMPTY: Partial<Record<SupervisionFilter, { title: string; sub: string }>> = {
  waiting: { title: "Nobody is waiting — nice.", sub: "Every patient who wrote in today has had a reply." },
  cold: { title: "Nothing has gone cold.", sub: "Patients still waiting a day after they wrote show here." },
  halfway: { title: "Nobody dropped out of a flow.", sub: "Patients who stop or go quiet halfway through a flow show here." },
  follow_up: { title: "No follow-ups scheduled.", sub: "Chats an agent marked “Follow up” show here, soonest first." },
  all: { title: "No chats here yet.", sub: "Conversations from every WhatsApp line show here." },
};

const SENDER_PREFIX: Record<string, string> = { CUSTOMER: "Patient: ", AGENT: "Agent: ", BOT: "Bot: " };

const SCROLL =
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/25 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-brand/50";

function Row({
  c,
  selected,
  slaMinutes,
  now,
  onSelect,
}: {
  c: SupervisionConversation;
  selected: boolean;
  slaMinutes: number;
  now: number;
  onSelect: () => void;
}) {
  const waiting = c.waitingMinutes;
  const late = c.overSla || (waiting !== null && waiting >= slaMinutes);
  const warn = !late && waiting !== null && waiting >= WAIT_WARN_MINUTES;
  const name = patientName(c.customer);
  const prefix = c.lastSenderType ? SENDER_PREFIX[c.lastSenderType] : "";
  const preview = c.lastMessage ? messagePreview({ messageType: null, content: c.lastMessage }) : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`group relative w-full text-left flex gap-3 px-4 py-3 border-b border-gray-100 transition-colors cursor-pointer ${
        selected ? "bg-brand-100" : late ? "bg-red-50 hover:bg-red-100/70" : "bg-white hover:bg-gray-50"
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${
          selected ? "bg-brand" : late ? "bg-red-500" : warn ? "bg-amber-400" : "bg-transparent"
        }`}
      />

      <div className="shrink-0 mt-0.5">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-[12px] ${
            selected || waiting !== null ? "bg-brand-200 text-brand-strong" : "bg-[#EEF1EF] text-gray-500"
          }`}
        >
          {initials(c.customer.name || c.customer.phone)}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {/* Name + when */}
        <div className="flex justify-between items-baseline gap-2">
          <span className="min-w-0 truncate">
            <span className={`text-[14px] ${waiting !== null ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>{name}</span>
            {c.customer.name && <span className="text-[11.5px] text-gray-400 ml-1.5">{formatPhone(c.customer.phone)}</span>}
          </span>
          <span className={`text-[11px] shrink-0 tabular-nums ${late ? "text-red-600 font-semibold" : "text-gray-400"}`}>
            {c.lastMessageAt ? timeAgo(c.lastMessageAt, now) : "—"}
          </span>
        </div>

        {/* Latest message + the wait */}
        <div className="flex justify-between items-center gap-2 mt-0.5">
          <span className={`min-w-0 flex text-[13px] ${c.lastSenderType === "CUSTOMER" ? "text-gray-700" : "text-gray-500"}`}>
            {prefix && <span className={`shrink-0 whitespace-pre ${c.lastSenderType === "CUSTOMER" ? "text-gray-500 font-medium" : "text-gray-400"}`}>{prefix}</span>}
            <span className="bidi-line truncate">{preview || <span className="italic text-gray-400">No messages yet</span>}</span>
          </span>
          <WaitChip minutes={waiting} slaMinutes={slaMinutes} />
        </div>

        {/* State: follow-up, flow, notes · line, owner */}
        <div className="flex items-center gap-1.5 mt-1.5 min-h-[20px]">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
            <OutcomeChip outcome={c.outcome} followUpAt={c.followUpAt} followUpOverdue={c.followUpOverdue} />
            <FlowChip flow={c.flow} />
            {c.noteCount > 0 && (
              <span title={`${c.noteCount} note${c.noteCount === 1 ? "" : "s"}`} className="inline-flex items-center gap-0.5 text-[10.5px] text-gray-400">
                <StickyNote className="w-3 h-3" />
                {c.noteCount}
              </span>
            )}
          </div>
          <NumberChip label={c.whatsappNumber.label} />
          {c.otherChats.length > 0 && (
            <span
              title={c.otherChats.map((o) => `Also on ${o.whatsappNumber.label}`).join("\n")}
              className="shrink-0 text-[10.5px] font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5"
            >
              +{c.otherChats.length} line{c.otherChats.length === 1 ? "" : "s"}
            </span>
          )}
          {c.assignedAgent ? (
            <span
              title={`Assigned to ${personName(c.assignedAgent)}`}
              className="w-5 h-5 shrink-0 rounded-full bg-gray-200 text-gray-600 text-[9px] font-bold flex items-center justify-center"
            >
              {personInitials(c.assignedAgent)}
            </span>
          ) : c.status !== "RESOLVED" ? (
            <span className="text-[10.5px] font-medium text-amber-600 shrink-0">Unassigned</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function ConversationList({
  filter,
  onFilter,
  counts,
  search,
  onSearch,
  rows,
  total,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  selectedId,
  onSelect,
  slaMinutes,
  now,
  scopeLabel,
}: {
  filter: SupervisionFilter;
  onFilter: (f: SupervisionFilter) => void;
  counts: Partial<Record<SupervisionFilter, number>>;
  search: string;
  onSearch: (s: string) => void;
  rows: SupervisionConversation[] | null;
  total: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  slaMinutes: number;
  now: number;
  /** "Sara's chats", "Unassigned chats" — shown when an agent filter is on. */
  scopeLabel: string | null;
}) {
  const empty = EMPTY[filter] ?? EMPTY.all!;

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Search */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 focus-within:border-brand/40">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search patient name or number..."
            aria-label="Search chats"
            className="flex-1 min-w-0 text-[13px] text-gray-600 placeholder:text-gray-400 outline-none bg-transparent [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button type="button" onClick={() => onSearch("")} aria-label="Clear search" className="text-gray-300 hover:text-gray-500 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div
        role="tablist"
        aria-label="Chat filter"
        className="flex gap-4 px-4 border-b border-gray-100 overflow-x-auto shrink-0 [scrollbar-width:thin] [scrollbar-color:rgba(59,105,76,0.25)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/25 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        {FILTER_TABS.map((t) => {
          const active = filter === t.value;
          const n = counts[t.value];
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(t.value)}
              className={`shrink-0 flex items-center gap-1.5 pb-2 -mb-px border-b-2 text-[13px] transition-colors cursor-pointer ${
                active ? "border-brand text-brand-fg font-semibold" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
              {n !== undefined && n > 0 && (
                <span
                  className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-semibold flex items-center justify-center tabular-nums ${
                    t.value === "waiting" ? "bg-red-100 text-red-700" : active ? "bg-brand-200 text-brand-fg" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {n > 999 ? "999+" : n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {scopeLabel && (
        <div className="px-4 py-1.5 text-[11.5px] text-gray-500 bg-gray-50/70 border-b border-gray-100 shrink-0">
          Showing <span className="font-semibold text-gray-700">{scopeLabel}</span>
          {total !== null && ` · ${total} chat${total === 1 ? "" : "s"}`}
        </div>
      )}

      {/* Rows */}
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          if (hasMore && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < 150) onLoadMore();
        }}
        className={`flex-1 min-h-0 overflow-y-auto ${SCROLL}`}
      >
        {rows === null || (loading && rows.length === 0) ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-4 py-3 border-b border-gray-100 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 bg-gray-200 rounded w-2/3" />
                <div className="h-2.5 bg-gray-100 rounded w-full" />
                <div className="h-2.5 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-14">
            <p className="text-[14px] font-semibold text-gray-700">
              {search ? `No chats match “${search}”` : empty.title}
            </p>
            <p className="text-[12.5px] text-gray-400 mt-1 max-w-[280px]">
              {search ? "Try a different name or number, or another tab." : scopeLabel ? `Nothing for ${scopeLabel.toLowerCase()} in this tab.` : empty.sub}
            </p>
          </div>
        ) : (
          rows.map((c) => (
            <Row key={c.id} c={c} selected={selectedId === c.id} slaMinutes={slaMinutes} now={now} onSelect={() => onSelect(c.id)} />
          ))
        )}

        {rows && rows.length > 0 && (
          <div className="flex items-center justify-center py-3">
            {loadingMore ? (
              <Spinner size="sm" label="Loading more" />
            ) : hasMore ? (
              <button type="button" onClick={onLoadMore} className="text-[12px] font-semibold text-brand-fg hover:underline cursor-pointer">
                Load more
              </button>
            ) : (
              <span className="text-[11px] text-gray-300">No more chats</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
