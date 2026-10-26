"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, MessageCircle, RefreshCw } from "lucide-react";
import { apiGetFlowRuns } from "@/lib/api";
import { RUN_STATUS_META } from "@/lib/flows";
import type { FlowGraph, FlowRun, FlowRunStatus } from "@/types";
import { FlowRunJourney } from "./FlowRunJourney";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/components/CurrentUserProvider";

const STATUSES = Object.keys(RUN_STATUS_META) as FlowRunStatus[];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function journey(run: FlowRun): string {
  return (run.data.path || [])
    .map((p) => p.choice || p.answer || (p.tag ? `#${p.tag}` : "") || (p.handedOffTo ? `→ ${p.handedOffTo}` : ""))
    .filter(Boolean)
    .join(" › ");
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function FlowResponses({ flowId, flowName, graph }: { flowId: number; flowName: string; graph: FlowGraph }) {
  const { error: toastError } = useToast();
  // The chat link opens the inbox, which MARKETING doesn't have.
  const canOpenChat = useCurrentUser().can("conversation:write");
  const [status, setStatus] = useState<FlowRunStatus | "">("");
  const [page, setPage] = useState(1);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [variables, setVariables] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  // The response whose path is open in the side panel.
  const [openRun, setOpenRun] = useState<FlowRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGetFlowRuns(flowId, { page, limit: 50, status: status || undefined })
      .then((res) => {
        if (cancelled) return;
        setRuns(res.data);
        setVariables(res.variables);
        setTotal(res.pagination.total);
        setTotalPages(Math.max(1, res.pagination.totalPages));
      })
      .catch((err) => { if (!cancelled) toastError(err instanceof Error ? err.message : "Couldn't load responses"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [flowId, page, status, reloadKey, toastError]);

  const changeStatus = (s: FlowRunStatus | "") => { setLoading(true); setPage(1); setStatus(s); };
  const changePage = (p: number) => { setLoading(true); setPage(p); };
  const refresh = () => { setLoading(true); setReloadKey((k) => k + 1); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: FlowRun[] = [];
      let vars = variables;
      for (let p = 1; ; p++) {
        const res = await apiGetFlowRuns(flowId, { page: p, limit: 500, status: status || undefined });
        all.push(...res.data);
        vars = res.variables;
        if (p >= res.pagination.totalPages) break;
      }
      const header = ["Customer", "Phone", "Campaign", "Status", ...vars, "Journey", "Started", "Finished"];
      const lines = [header, ...all.map((r) => [
        r.customer.name || "", r.customer.phone, r.campaign?.name || "", RUN_STATUS_META[r.status].label,
        ...vars.map((v) => r.data.answers?.[v] ?? ""), journey(r), r.startedAt, r.completedAt || "",
      ])].map((row) => row.map(csvCell).join(","));
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${flowName.replace(/[^\w-]+/g, "_") || "flow"}-responses.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => changeStatus("")}
          className={`text-[12px] font-semibold rounded-full px-3 py-1.5 border ${status === "" ? "bg-brand text-white border-brand" : "bg-white text-gray-600 border-gray-200"}`}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => changeStatus(s)}
            className={`text-[12px] font-semibold rounded-full px-3 py-1.5 border ${status === s ? "bg-brand text-white border-brand" : "bg-white text-gray-600 border-gray-200"}`}
          >
            {RUN_STATUS_META[s].label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={refresh} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-50 rounded-lg px-3 py-1.5">
            <Download className="w-3.5 h-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              {variables.map((v) => <th key={v} className="px-4 py-3 font-semibold font-mono normal-case">{v}</th>)}
              <th className="px-4 py-3 font-semibold">Journey</th>
              <th className="px-4 py-3 font-semibold">Campaign</th>
              <th className="px-4 py-3 font-semibold">Started</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => setOpenRun(r)}
                title="See the path this patient took"
                className="align-top cursor-pointer hover:bg-gray-50/80 transition-colors"
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{r.customer.name || "—"}</p>
                  <p className="text-[12px] text-gray-400">{r.customer.phone}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${RUN_STATUS_META[r.status].cls}`}>
                    {RUN_STATUS_META[r.status].label}
                  </span>
                  {r.lastError && <p className="text-[11px] text-red-500 mt-1 max-w-[220px]">{r.lastError}</p>}
                </td>
                {variables.map((v) => (
                  <td key={v} className="px-4 py-3 text-gray-800">{r.data.answers?.[v] ?? <span className="text-gray-300">—</span>}</td>
                ))}
                <td className="px-4 py-3 text-gray-500 max-w-[280px]">{journey(r) || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{r.campaign?.name || "—"}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(r.startedAt)}</td>
                <td className="px-4 py-3">
                  {canOpenChat && (
                    <Link href={`/chats/${r.conversationId}`} title="Open chat" onClick={(e) => e.stopPropagation()} className="inline-flex w-8 h-8 rounded-lg items-center justify-center text-gray-400 hover:text-brand-fg hover:bg-brand-100">
                      <MessageCircle className="w-4 h-4" />
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && runs.length === 0 && (
          <p className="text-center text-[13px] text-gray-400 py-12">
            No responses yet. They appear here as customers tap the campaign&apos;s buttons.
          </p>
        )}
      </div>

      {openRun && (
        <FlowRunJourney run={openRun} graph={graph} canOpenChat={canOpenChat} onClose={() => setOpenRun(null)} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-4 text-[13px]">
          <span className="text-gray-400">{total} responses · page {page} of {totalPages}</span>
          <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="border border-gray-200 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => changePage(page + 1)} className="border border-gray-200 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
