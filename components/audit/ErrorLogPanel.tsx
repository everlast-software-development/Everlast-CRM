"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, RotateCcw, Search } from "lucide-react";
import { apiGetErrorLog, apiResolveAllErrors, apiSetErrorResolved } from "@/lib/api";
import type { ErrorLogEntry, ErrorSource } from "@/types";
import { useToast } from "@/components/ui/toast";

// Where each kind of problem comes from, in admin words.
const SOURCES: { value: ErrorSource; label: string; cls: string }[] = [
  { value: "webhook", label: "Webhook", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  { value: "delivery", label: "Delivery", cls: "bg-red-50 text-red-700 border-red-200" },
  { value: "send", label: "Inbox send", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  { value: "campaign", label: "Campaign", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "flow", label: "Flow", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "templates", label: "Templates", cls: "bg-teal-50 text-teal-700 border-teal-200" },
  { value: "number", label: "Number", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  { value: "api", label: "Server (API)", cls: "bg-gray-100 text-gray-700 border-gray-200" },
  { value: "job", label: "Background job", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "system", label: "System", cls: "bg-zinc-100 text-zinc-700 border-zinc-200" },
];
const SOURCE_META = Object.fromEntries(SOURCES.map((s) => [s.value, s])) as Record<ErrorSource, (typeof SOURCES)[number]>;

// Meta's most common error codes, said plainly — what it means and what to do.
const META_HINTS: Record<string, string> = {
  "100": "Invalid parameter — something in the message (a variable, a link, the media) isn't accepted by Meta.",
  "190": "The WhatsApp access token expired or was revoked — renew it in Meta Business settings.",
  "368": "Meta temporarily blocked this number for policy reasons.",
  "130429": "Rate limit — too many messages too fast. Sending slows down and retries.",
  "131000": "Meta had an internal problem. Usually temporary — retry later.",
  "131005": "Permission denied — the token can't use this number or account.",
  "131008": "A required field is missing from the message.",
  "131009": "A value in the message isn't valid (often a variable or a button).",
  "131016": "WhatsApp is temporarily overloaded. Retry later.",
  "131021": "The recipient is the business number itself.",
  "131026": "Couldn't deliver: the person isn't on WhatsApp, has an old app, or hasn't accepted the latest terms.",
  "131031": "The business account is locked by Meta.",
  "131042": "Payment problem on the WhatsApp Business account — check the payment method in Meta.",
  "131047": "More than 24 hours since the patient last wrote — only an approved template can be sent.",
  "131049": "Meta held this marketing message back to protect the patient's experience (too many marketing messages). Try again later.",
  "131050": "The patient stopped marketing messages in WhatsApp. They're marked opted out.",
  "131051": "This message type isn't supported.",
  "131052": "Couldn't download the patient's media from WhatsApp.",
  "131053": "Couldn't upload the media — check the file is a supported type and size, and the link is public.",
  "131056": "Too many messages to the same person in a short time. Slow down.",
  "132000": "The template's variables don't match what was sent (count or format).",
  "132001": "The template doesn't exist in this language, or isn't approved yet.",
  "132005": "The template's text is too long once the variables are filled in.",
  "132007": "The template breaks a Meta policy.",
  "132012": "A template variable has the wrong format.",
  "132015": "The template is paused by Meta (low quality).",
  "132016": "The template is disabled by Meta.",
  "133010": "The phone number isn't registered with WhatsApp Business.",
};

const timeAgo = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
};
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ErrorRow({ e, onToggleResolved }: { e: ErrorLogEntry; onToggleResolved: (e: ErrorLogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const meta = SOURCE_META[e.source] ?? SOURCE_META.system;
  const hint = e.code ? META_HINTS[e.code] : undefined;
  const flowId = typeof e.details?.flowId === "number" ? e.details.flowId : null;

  return (
    <div className={`border-b border-gray-100 last:border-b-0 ${e.resolvedAt ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide details" : "Show details"}
          className="mt-0.5 text-gray-400 hover:text-gray-700"
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
            {e.code && <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{e.code}</span>}
            {e.count > 1 && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600" title="Times it happened since it was first seen">
                ×{e.count}
              </span>
            )}
            {e.resolvedAt && <span className="text-[11px] font-semibold text-green-700">Resolved</span>}
          </div>
          <p dir="auto" className="mt-1 text-[13.5px] text-gray-800 leading-snug break-words">{e.message}</p>
          {hint && <p className="mt-1 text-[12.5px] text-gray-500 leading-snug">💡 {hint}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-400">
            <span title={when(e.lastSeenAt)}>Last {timeAgo(e.lastSeenAt)}</span>
            {e.count > 1 && <span title={when(e.firstSeenAt)}>first {timeAgo(e.firstSeenAt)}</span>}
            {e.conversationId && <Link href={`/chats/${e.conversationId}`} className="text-brand-fg hover:underline">Open chat</Link>}
            {e.campaignId && <Link href={`/campaigns/${e.campaignId}`} className="text-brand-fg hover:underline">Open campaign</Link>}
            {flowId && <Link href={`/campaigns/flows/${flowId}`} className="text-brand-fg hover:underline">Open flow</Link>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleResolved(e)}
          className={`shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg px-2.5 py-1.5 border ${
            e.resolvedAt ? "text-gray-600 border-gray-200 hover:bg-gray-50" : "text-green-700 border-green-200 bg-green-50 hover:bg-green-100"
          }`}
        >
          {e.resolvedAt ? <><RotateCcw className="w-3.5 h-3.5" /> Reopen</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Resolve</>}
        </button>
      </div>
      {open && (
        <pre className="mx-5 mb-4 ml-12 max-h-80 overflow-auto rounded-lg bg-gray-50 border border-gray-100 p-3 text-[11.5px] leading-relaxed text-gray-700 whitespace-pre-wrap break-words">
          {e.details && Object.keys(e.details).length ? JSON.stringify(e.details, null, 2) : "No extra details were recorded."}
        </pre>
      )}
    </div>
  );
}

// Things that went wrong with nobody watching: webhooks, deliveries Meta
// refused, flows, campaigns, background jobs, server errors. Repeats are one
// row with a count; Resolve clears it (the next occurrence opens a new one).
export function ErrorLogPanel() {
  const toast = useToast();
  const [source, setSource] = useState<ErrorSource | "">("");
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ErrorLogEntry[] | null>(null);
  const [openBySource, setOpenBySource] = useState<Partial<Record<ErrorSource, number>>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const res = await apiGetErrorLog({ source: source || undefined, status, q: q || undefined, page: nextPage });
      setRows((prev) => (nextPage === 1 || !prev ? res.data : [...prev, ...res.data]));
      setOpenBySource(res.openBySource);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
      setPage(nextPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the error log");
    } finally {
      setLoading(false);
    }
  }, [source, status, q, toast]);

  useEffect(() => {
    const t = setTimeout(() => void load(1), 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggleResolved = async (e: ErrorLogEntry) => {
    const resolve = !e.resolvedAt;
    try {
      await apiSetErrorResolved(e.id, resolve);
      // Leaves the list when it no longer matches the status filter.
      setRows((list) =>
        (list ?? [])
          .map((x) => (x.id === e.id ? { ...x, resolvedAt: resolve ? new Date().toISOString() : null } : x))
          .filter((x) => status === "all" || (status === "open" ? !x.resolvedAt : !!x.resolvedAt)),
      );
      setOpenBySource((m) => ({ ...m, [e.source]: Math.max(0, (m[e.source] ?? 0) + (resolve ? -1 : 1)) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update it");
    }
  };

  const resolveAll = async () => {
    try {
      const res = await apiResolveAllErrors({ source: source || undefined, q: q || undefined });
      toast.success(`Resolved ${res.data.count} entr${res.data.count === 1 ? "y" : "ies"}`);
      void load(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't resolve them");
    }
  };

  const totalOpen = Object.values(openBySource).reduce((a, b) => a + (b ?? 0), 0);
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-full px-3 py-1.5 border transition-colors ${
      active ? "bg-brand text-white border-brand" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
    }`;

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
      <div className="pt-4 pb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={chip(source === "")} onClick={() => setSource("")}>
            All {totalOpen > 0 && <span className="opacity-80">{totalOpen}</span>}
          </button>
          {SOURCES.map((s) => (
            <button key={s.value} type="button" className={chip(source === s.value)} onClick={() => setSource(s.value)}>
              {s.label}
              {(openBySource[s.value] ?? 0) > 0 && <span className="opacity-80">{openBySource[s.value]}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
            {(["open", "resolved", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatus(v)}
                className={`text-[12px] font-semibold rounded-md px-3 py-1.5 ${status === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}
              >
                {v === "open" ? "Open" : v === "resolved" ? "Resolved" : "All"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 w-64">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search message or code…"
              className="flex-1 text-[13px] outline-none bg-transparent"
            />
          </div>
          <button
            type="button"
            onClick={() => void load(1)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          {status !== "resolved" && (rows?.some((r) => !r.resolvedAt) ?? false) && (
            <button
              type="button"
              onClick={() => void resolveAll()}
              className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-green-700 border border-green-200 bg-green-50 rounded-lg px-3 py-1.5 hover:bg-green-100"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Resolve all {source ? SOURCE_META[source].label.toLowerCase() : ""} ({total})
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {rows === null ? (
          <div className="py-16 text-center text-[13px] text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            {status === "open" ? <CheckCircle2 className="w-9 h-9 text-green-500" /> : <AlertTriangle className="w-9 h-9 text-gray-300" />}
            <p className="text-[14px] font-semibold text-gray-700">{status === "open" ? "No open problems" : "Nothing here"}</p>
            <p className="text-[13px] text-gray-400 max-w-sm">
              Webhook, delivery, flow, campaign and server errors show up here as they happen.
            </p>
          </div>
        ) : (
          <>
            {rows.map((e) => <ErrorRow key={e.id} e={e} onToggleResolved={(x) => void toggleResolved(x)} />)}
            {totalPages > page && (
              <div className="flex justify-center py-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => void load(page + 1)}
                  disabled={loading}
                  className="px-5 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-3 text-[11.5px] text-gray-400">
        Repeats of the same problem are grouped (×N). Resolved entries are kept 30 days, everything else 90. Phone numbers are shortened to the last 4 digits.
      </p>
    </div>
  );
}
