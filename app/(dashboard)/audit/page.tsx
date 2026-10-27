"use client";

import { useState, useEffect, useRef } from "react";
import { Lock } from "lucide-react";
import { apiGetAuditLog } from "@/lib/api";
import type { AuditLog } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";
import { ErrorLogPanel } from "@/components/audit/ErrorLogPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateDetails(details: Record<string, unknown> | null, max = 80): string {
  if (!details) return "—";
  const str = JSON.stringify(details);
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function actionColorClass(action: string): string {
  const lower = action.toLowerCase();
  // Checked before "sent" so a dry-run test never wears the live-send colour.
  if (lower.includes("test_send")) return "bg-slate-100 text-slate-600 border-slate-200";
  // A real outbound blast is the highest-consequence entry in this log — give
  // it the strongest badge so it's findable at a glance.
  if (lower.includes("sent")) return "bg-purple-100 text-purple-700 border-purple-200";
  // A wrong password (or a password-guessing run) should stand out.
  if (lower.includes("login_failed")) return "bg-amber-100 text-amber-700 border-amber-200";
  if (lower.includes("deleted")) return "bg-red-100 text-red-700 border-red-200";
  if (lower.includes("password")) return "bg-orange-100 text-orange-700 border-orange-200";
  if (lower.includes("cancelled") || lower.includes("paused")) {
    return "bg-orange-100 text-orange-700 border-orange-200";
  }
  if (lower.includes("assigned")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (lower.includes("status_changed")) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (lower.includes("created") || lower.includes("imported") || lower.includes("uploaded") || lower.includes("added")) {
    return "bg-green-100 text-green-700 border-green-200";
  }
  return "bg-gray-100 text-gray-600 border-gray-200";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-100 animate-pulse">
      <div className="h-5 w-28 rounded-full bg-gray-200 shrink-0" />
      <div className="h-4 w-24 rounded bg-gray-200 shrink-0" />
      <div className="h-4 w-32 rounded bg-gray-200 shrink-0" />
      <div className="h-4 flex-1 rounded bg-gray-100" />
      <div className="h-4 w-28 rounded bg-gray-100 shrink-0" />
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
        <Lock className="w-7 h-7 text-red-400" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-[17px] font-bold text-gray-900">Access Denied</h2>
        <p className="text-[14px] text-gray-500">This page is for admins only.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  // Access comes from the server's permission list, never from the role
  // name: see CurrentUserProvider. `ready` is false until /users/me answers.
  const { ready, can } = useCurrentUser();
  const allowed = can("audit:read");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  // Activity = who did what; Errors = what went wrong (webhooks, deliveries…).
  // /audit?tab=errors opens Errors (the sidebar badge links there).
  const [tab, setTab] = useState<"activity" | "errors">("activity");
  useEffect(() => {
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("tab") === "errors") setTab("errors");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);

  // Debounce ref for action filter
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch logs whenever page or actionFilter changes (debounced on filter)
  useEffect(() => {
    if (!allowed) return;

    async function fetchLogs(resetPage: boolean) {
      const targetPage = resetPage ? 1 : page;
      if (resetPage) setPage(1);
      setLoading(true);
      try {
        const res = await apiGetAuditLog(
          targetPage,
          20,
          actionFilter.trim() || undefined
        );
        setLogs((prev) =>
          targetPage === 1 ? res.data : [...prev, ...res.data]
        );
        setTotalPages(res.pagination.totalPages);
      } catch {
        // keep existing list on error
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    }

    // When actionFilter changes, debounce and reset to page 1
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchLogs(true);
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, allowed]);

  // Separate effect for page increments (load more)
  useEffect(() => {
    if (page === 1) return; // handled by the filter effect above
    if (!allowed) return;

    async function fetchMore() {
      setLoadingMore(true);
      try {
        const res = await apiGetAuditLog(
          page,
          20,
          actionFilter.trim() || undefined
        );
        setLogs((prev) => [...prev, ...res.data]);
        setTotalPages(res.pagination.totalPages);
      } catch {
        // keep existing list
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    }

    fetchMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // While user is not yet read from localStorage, render nothing to avoid flicker
  if (!ready) {
    return (
      <div className="flex flex-col h-full bg-canvas-warm">
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <div className="h-6 w-32 rounded bg-gray-200 animate-pulse" />
        </div>
        <div className="flex-1 bg-white m-4 rounded-2xl overflow-hidden shadow-sm border border-gray-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!ready) return <PageSpinner />;
  if (!allowed) {
    return (
      <div className="flex flex-col h-full bg-canvas-warm">
        <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
          <h1 className="text-[18px] font-bold text-gray-900">Audit Log</h1>
        </div>
        <AccessDenied />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-canvas-warm">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0 flex items-center gap-4">
        <h1 className="text-[18px] font-bold text-gray-900">Audit Log</h1>
        <div className="inline-flex bg-gray-50 border border-gray-100 rounded-lg p-1 gap-1">
          {([
            ["activity", "Activity"],
            ["errors", "Errors"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`text-[13px] font-semibold rounded-md px-3.5 py-1.5 transition-colors ${tab === value ? "bg-brand text-white" : "text-gray-500 hover:text-gray-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "errors" ? (
        <ErrorLogPanel />
      ) : (
      <>
      {/* Filter bar */}
      <div className="px-6 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 max-w-xs shadow-sm">
          <svg
            className="w-3.5 h-3.5 text-gray-400 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by action..."
            className="flex-1 text-[13px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
          />
          {actionFilter && (
            <button
              type="button"
              onClick={() => setActionFilter("")}
              className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-auto px-6 pb-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-w-[640px]">
          {/* Table header */}
          <div className="grid grid-cols-[180px_140px_180px_1fr_160px] gap-4 px-5 py-2.5 border-b border-gray-100 bg-gray-50">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Action</span>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Actor</span>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Target</span>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Details</span>
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Date / Time</span>
          </div>

          {/* Loading skeleton */}
          {loading && logs.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
          ) : logs.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12h6M9 16h6M7 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
                  <rect x="7" y="2" width="10" height="4" rx="1" ry="1" />
                </svg>
              </div>
              <div className="space-y-1">
                <p className="text-[14px] font-semibold text-gray-700">No audit entries found</p>
                <p className="text-[13px] text-gray-400">
                  {actionFilter ? "Try a different action filter." : "Activity will appear here once actions are recorded."}
                </p>
              </div>
            </div>
          ) : (
            /* Log rows */
            <>
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[180px_140px_180px_1fr_160px] gap-4 px-5 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors items-center"
                >
                  {/* Action pill */}
                  <div>
                    <span
                      className={`inline-block font-mono text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${actionColorClass(entry.action)}`}
                    >
                      {entry.action}
                    </span>
                  </div>

                  {/* Actor */}
                  <span className="text-[13px] text-gray-700 truncate">
                    {entry.actorUsername ?? <span className="text-gray-400 italic">system</span>}
                  </span>

                  {/* Target */}
                  <span className="text-[13px] text-gray-600 truncate">
                    <span className="font-medium text-gray-800">{entry.targetType}</span>
                    <span className="text-gray-400"> #{entry.targetId}</span>
                  </span>

                  {/* Details */}
                  <span className="text-[12px] text-gray-400 font-mono truncate" title={entry.details ? JSON.stringify(entry.details) : undefined}>
                    {truncateDetails(entry.details)}
                  </span>

                  {/* Date/time */}
                  <span className="text-[12px] text-gray-400 whitespace-nowrap">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
              ))}

              {/* Load more */}
              {totalPages > page && (
                <div className="flex justify-center py-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={loadingMore}
                    className="px-5 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
