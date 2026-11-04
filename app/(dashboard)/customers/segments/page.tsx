"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Filter, Users, Trash2, Megaphone, ShieldCheck, TriangleAlert, RefreshCw } from "lucide-react";
import { apiGetSegments, apiDeleteSegment, apiGetMe } from "@/lib/api";
import { describeRule } from "@/components/SegmentBuilder";
import { can } from "@/lib/permissions";
import type { Segment } from "@/types";
import { NoAccess } from "@/components/NoAccess";
import { PageSpinner } from "@/components/ui/spinner";
import { useCurrentUser } from "@/components/CurrentUserProvider";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function SegmentsList() {
  const router = useRouter();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether this viewer may author segments. Reads are open to every role, so
  // the page renders for all of them; only the create, delete and campaign
  // affordances depend on this.
  const [canWrite, setCanWrite] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiGetSegments();
      setSegments(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load segments");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGetMe().then((res) => setCanWrite(can(res.data, "segment:write"))).catch(() => {});
  }, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDeleteSegment(deleteTarget.id);
      setSegments((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete segment");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Segments</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">
            Saved rules that re-check who qualifies every time you use them
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Recount
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
        {canWrite && (
          <button
            type="button"
            onClick={() => router.push("/customers/segments/new")}
            className="w-full flex flex-col items-center justify-center gap-2 py-8 mb-6 rounded-2xl border-2 border-dashed border-gray-200 hover:border-brand hover:bg-brand-100 transition-colors cursor-pointer group"
          >
            <div className="w-11 h-11 rounded-2xl bg-brand-200 group-hover:bg-white flex items-center justify-center transition-colors">
              <svg className="w-5 h-5 text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </div>
            <p className="text-[14px] font-semibold text-gray-700 group-hover:text-brand-fg">Create Segment</p>
          </button>
        )}

        {error && <p className="text-[13px] text-red-500 text-center mb-4">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-10">
            <svg className="w-6 h-6 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          </div>
        ) : segments.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mx-auto mb-4">
              <Filter className="w-6 h-6 text-brand-fg" />
            </div>
            <h2 className="text-[16px] font-semibold text-gray-800">No segments yet</h2>
            <p className="text-[13.5px] text-gray-400 mt-1.5 max-w-md mx-auto leading-relaxed">
              A list holds the contacts you picked. A segment holds the rule — so someone who
              qualifies next month is included next month, without you rebuilding anything.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {segments.map((s) => {
              const rules = s.definition?.rules ?? [];
              const broken = !!s.error;
              return (
                <div
                  key={s.id}
                  onClick={() => router.push(`/customers/segments/${s.id}`)}
                  className="relative p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-sm bg-white transition-all cursor-pointer group flex flex-col"
                >
                  {canWrite && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                      className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="Delete segment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center mb-3">
                    <Filter className="w-4 h-4 text-brand-fg" />
                  </div>

                  <p className="text-[14px] font-semibold text-gray-900 truncate pr-6">{s.name}</p>
                  <p className="text-[12px] text-gray-400 mt-0.5 line-clamp-2 min-h-[32px]">
                    {s.description || rules.map((r) => describeRule(r, null)).join(s.definition?.match === "ANY" ? " or " : " and ") || "No rules"}
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    {broken ? (
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-amber-600">
                        <TriangleAlert className="w-3.5 h-3.5" />
                        Rule needs fixing
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500">
                        <Users className="w-3.5 h-3.5" />
                        <span className="tabular-nums">{(s.reachable ?? 0).toLocaleString()}</span>
                        {" "}contact{s.reachable === 1 ? "" : "s"} now
                      </span>
                    )}
                    <span className="text-[11px] text-gray-300">{formatDate(s.updatedAt)}</span>
                  </div>

                  <div className="flex items-center gap-2 mt-2.5">
                    {s.excludeOptedOut && (
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-brand-fg bg-brand-100 rounded-md px-1.5 py-0.5">
                        <ShieldCheck className="w-3 h-3" />
                        Consent-safe
                      </span>
                    )}
                    <span className="text-[10.5px] font-semibold text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">
                      {rules.length} rule{rules.length === 1 ? "" : "s"}
                    </span>
                    {!!s.campaignCount && (
                      <span className="text-[10.5px] font-semibold text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">
                        {s.campaignCount} campaign{s.campaignCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {canWrite && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(`/campaigns/new?segmentId=${s.id}`); }}
                      disabled={broken || !s.reachable}
                      title={broken ? "Fix this segment's rules first" : !s.reachable ? "Nobody matches this segment right now" : undefined}
                      className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-brand-100 hover:border-brand hover:text-brand-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-600 transition-colors cursor-pointer"
                    >
                      <Megaphone className="w-3.5 h-3.5" />
                      Create Campaign
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-6 w-[420px] max-w-full space-y-4">
            <div>
              <h3 className="text-[15px] font-bold text-gray-900">Delete &ldquo;{deleteTarget.name}&rdquo;?</h3>
              <p className="text-[12.5px] text-gray-500 mt-1.5 leading-relaxed">
                The rule is removed. Contacts are untouched, and campaigns already built from it keep
                the exact recipients they were approved with.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[13px] font-semibold hover:bg-red-600 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Not in the menu without segment:read; a typed-in address gets a clear answer
// instead of a page of server errors.
export default function SegmentsPage() {
  const { ready, can: holds } = useCurrentUser();
  if (!ready) return <PageSpinner />;
  if (!holds("segment:read")) return <NoAccess what="segments" />;
  return <SegmentsList />;
}
