"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSearchMessages } from "@/lib/api";
import type { Message } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";
import { NoAccess } from "@/components/NoAccess";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function HighlightedText({ text, term }: { text: string; term: string }) {
  if (!term.trim()) return <span>{text}</span>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="bg-yellow-100 text-inherit rounded-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="flex flex-col gap-2 p-4 border border-gray-100 rounded-2xl bg-white animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 bg-gray-200 rounded w-20" />
        <div className="h-3 bg-gray-100 rounded w-14" />
      </div>
      <div className="h-3.5 bg-gray-200 rounded w-full" />
      <div className="h-3.5 bg-gray-100 rounded w-3/4" />
      <div className="h-3 bg-gray-100 rounded w-1/3" />
    </div>
  );
}

// Searches patients' messages, so it needs inbox read access (MARKETING has none).
export default function SearchPage() {
  const { ready, can } = useCurrentUser();
  if (!ready) return <PageSpinner />;
  if (!can("conversation:read")) return <NoAccess what="Message search" />;
  return <MessageSearch />;
}

function MessageSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(false);
    setLastQuery(q);
    try {
      const res = await apiSearchMessages(q);
      setResults(res.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  return (
    <div className="flex flex-col h-full bg-canvas-warm">
      {/* Page header */}
      <div className="shrink-0 px-6 pt-6 pb-4 bg-white border-b border-gray-100">
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-4">
          Search Messages
        </h1>

        {/* Search bar */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10 transition-all">
          <svg
            className="w-5 h-5 text-gray-400 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search across all conversations..."
            className="flex-1 text-[15px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setSearched(false);
              }}
              className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className="ml-1 bg-brand hover:bg-[#2f5840] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            Search
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/20 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Initial state */}
        {!loading && !searched && (
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] gap-5 text-center">
            <div className="w-[80px] h-[80px] rounded-2xl bg-brand-200 flex items-center justify-center">
              <svg
                className="w-9 h-9 text-brand-fg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
            <div className="space-y-2">
              <p className="text-[18px] font-bold text-gray-800 tracking-tight">
                Search across all conversations
              </p>
              <p className="text-[14px] text-gray-400 leading-relaxed max-w-xs">
                Type a keyword above to find messages from any conversation.
              </p>
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {/* Empty state after search */}
        {!loading && searched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] gap-4 text-center">
            <div className="w-[72px] h-[72px] rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-gray-500">
              No messages found for &ldquo;{lastQuery}&rdquo;
            </p>
          </div>
        )}

        {/* Results */}
        {!loading && searched && results.length > 0 && (
          <>
            <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-widest pb-1">
              {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{lastQuery}&rdquo;
            </p>
            {results.map((msg, i) => {
              const mid = msg._id != null ? String(msg._id) : msg.id != null ? String(msg.id) : `msg-${i}`;
              const isCustomer = msg.senderType === "CUSTOMER";

              return (
                <button
                  key={mid}
                  type="button"
                  onClick={() => router.push(`/chats/${msg.conversationId}`)}
                  className="w-full text-left flex flex-col gap-2 p-4 bg-white border border-gray-100 rounded-2xl hover:border-brand/30 hover:shadow-sm transition-all cursor-pointer group"
                >
                  {/* Top row: sender badge + timestamp */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        isCustomer
                          ? "bg-blue-50 text-blue-600 border-blue-200"
                          : "bg-brand-200 text-brand-fg border-brand/20"
                      }`}
                    >
                      {msg.senderType}
                    </span>
                    <span className="text-[12px] text-gray-400 shrink-0">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>

                  {/* Message content — 2-line clamp */}
                  <p className="bidi text-[14px] text-gray-700 leading-relaxed line-clamp-2 break-words">
                    <HighlightedText text={msg.content} term={lastQuery} />
                  </p>

                  {/* Conversation link hint */}
                  <div className="flex items-center gap-1 text-[12px] text-gray-400 group-hover:text-brand-fg transition-colors">
                    <svg
                      className="w-3.5 h-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>View conversation</span>
                    <svg
                      className="w-3 h-3 shrink-0 ml-0.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
