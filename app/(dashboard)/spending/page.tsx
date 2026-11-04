"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { apiGetSpending } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { NoAccess } from "@/components/NoAccess";
import { PageSpinner } from "@/components/ui/spinner";
import type { SpendBucket, SpendCategory, SpendingLine, SpendingReport } from "@/types";

// What WhatsApp is costing: per line, per month, from what Meta delivered.
// Admins and directors (stats:spend). The numbers are an estimate of Meta's
// invoice — see modules/stats/spending.controller.js in the API.

const CATEGORY_LABEL: Record<SpendCategory, string> = {
  service: "Replies (service)",
  utility: "Utility templates",
  marketing: "Marketing templates",
  authentication: "Authentication",
};
const CATEGORY_ORDER: SpendCategory[] = ["service", "marketing", "utility", "authentication"];

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthName = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

export default function SpendingPage() {
  const { ready, can } = useCurrentUser();
  const allowed = can("stats:spend");
  // undefined = this month (the server decides what "this month" is, in the
  // billing timezone); afterwards the month shown.
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<SpendingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    apiGetSpending(month)
      .then((res) => { if (!cancelled) { setReport(res.data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load spending"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, month]);

  if (!ready) return <PageSpinner />;
  if (!allowed) return <NoAccess what="spending" />;

  const go = (by: number) => {
    if (!report) return;
    setLoading(true);
    setMonth(shiftMonth(report.month, by));
  };
  const busiest = report?.lines.reduce<SpendingLine | null>((a, l) => (!a || l.freeServiceUsed > a.freeServiceUsed ? l : a), null);

  return (
    <div className="p-6 lg:p-8 bg-canvas min-h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Spending</h1>
          <p className="text-sm text-gray-400 mt-0.5 max-w-2xl">
            What WhatsApp is costing, from the messages Meta delivered. An estimate — WhatsApp Manager → Billing has the final invoice.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
          <button type="button" onClick={() => go(-1)} disabled={!report || loading} aria-label="Previous month" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 text-[13px] font-semibold text-gray-700 min-w-[120px] text-center">
            {report ? monthName(report.month) : "…"}
          </span>
          <button type="button" onClick={() => go(1)} disabled={!report || loading || report.isCurrentMonth} aria-label="Next month" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-600">{error}</div>
      )}

      {!report ? (
        !error && <div className="mt-6 h-40 bg-white rounded-xl border border-gray-100 animate-pulse" />
      ) : (
        <div className={`mt-6 space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={report.isCurrentMonth ? "Spent so far" : "Spent"} value={usd(report.total.costUsd)} />
            {report.isCurrentMonth ? (
              <Stat label="Month-end at this pace" value={usd(report.total.projectedUsd)} hint="A straight-line projection" />
            ) : (
              <Stat label="Charged messages" value={num(sumCharged(report.total))} />
            )}
            <Stat label="Messages delivered" value={num(report.total.delivered)} hint={`${num(report.total.serviceByFlow)} by flows · ${num(report.total.serviceByAgent)} by agents · rest templates`} />
            <Stat
              label="Free replies left"
              value={busiest ? `${num(busiest.freeServiceLeft)} / ${num(report.freeServicePerLine)}` : "—"}
              hint={busiest ? `On the busiest line (${busiest.label}). Each line has its own ${num(report.freeServicePerLine)} a month.` : undefined}
              tone={busiest ? allowanceTone(busiest.freeServiceUsed, report.freeServicePerLine) : undefined}
            />
          </div>

          <Notes report={report} />

          {/* Per line */}
          <div className="space-y-3">
            {report.lines.map((l) => <LineCard key={l.id} line={l} free={report.freeServicePerLine} />)}
          </div>

          {/* Rates used */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[12px] font-semibold text-gray-600 mb-2">Rates used (USD per delivered message, by the patient&apos;s country)</p>
            <div className="overflow-x-auto">
              <table className="text-[12px] text-gray-600">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left font-medium pr-6 py-1">Country</th>
                    {CATEGORY_ORDER.map((c) => <th key={c} className="text-right font-medium px-3 py-1">{CATEGORY_LABEL[c]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.rates).map(([country, r]) => (
                    <tr key={country}>
                      <td className="pr-6 py-1 font-medium">{country === "AE" ? "UAE" : country === "EG" ? "Egypt" : country}</td>
                      {CATEGORY_ORDER.map((c) => <td key={c} className="text-right px-3 py-1 tabular-nums">{r[c] != null ? `$${r[c]}` : "—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Replies inside the 24-hour window (from agents and flows) are charged since October 1, 2026, after each line&apos;s first {num(report.freeServicePerLine)} of the month. Months follow {report.timeZone === "Asia/Dubai" ? "Dubai" : report.timeZone} time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const sumCharged = (b: SpendBucket) => CATEGORY_ORDER.reduce((n, c) => n + (b.byCategory[c]?.charged ?? 0), 0);

function allowanceTone(used: number, free: number): "good" | "warn" | "over" {
  if (used >= free) return "over";
  if (used >= free * 0.8) return "warn";
  return "good";
}
const TONE_TEXT = { good: "text-gray-900", warn: "text-amber-600", over: "text-red-600" } as const;
const TONE_BAR = { good: "bg-brand", warn: "bg-amber-500", over: "bg-red-500" } as const;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warn" | "over" }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular-nums ${tone ? TONE_TEXT[tone] : "text-gray-900"}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{hint}</p>}
    </div>
  );
}

function Notes({ report }: { report: SpendingReport }) {
  const t = report.total;
  const notes: { tone: "warn" | "info"; text: string }[] = [];
  for (const l of report.lines) {
    const tone = allowanceTone(l.freeServiceUsed, report.freeServicePerLine);
    if (tone === "over") notes.push({ tone: "warn", text: `${l.label} has used all ${num(report.freeServicePerLine)} free replies — every reply from agents and flows now costs money until the month ends.` });
    else if (tone === "warn") notes.push({ tone: "warn", text: `${l.label} has used ${num(l.freeServiceUsed)} of its ${num(report.freeServicePerLine)} free replies.` });
  }
  if (t.noRate > 0) notes.push({ tone: "warn", text: `${num(t.noRate)} charged message${t.noRate > 1 ? "s" : ""} went to countries with no rate set here, so they're not in the total.` });
  if (t.unpriced > 0) notes.push({ tone: "info", text: `${num(t.unpriced)} template${t.unpriced > 1 ? "s are" : " is"} waiting for Meta's pricing and not counted yet.` });
  if (t.awaitingDelivery > 0) notes.push({ tone: "info", text: `${num(t.awaitingDelivery)} message${t.awaitingDelivery > 1 ? "s are" : " is"} sent but not delivered yet — Meta only charges on delivery.` });
  if (!notes.length) return null;
  return (
    <div className="space-y-2">
      {notes.map((n, i) => (
        <div key={i} className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${n.tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-gray-50 border-gray-100 text-gray-500"}`}>
          {n.tone === "warn" ? <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> : <Info className="w-4 h-4 shrink-0 mt-px" />}
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

function LineCard({ line, free }: { line: SpendingLine; free: number }) {
  const tone = allowanceTone(line.freeServiceUsed, free);
  const pct = Math.min(100, Math.round((line.freeServiceUsed / free) * 100));
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-gray-900 truncate">
            {line.label}
            {line.isDefault && <span className="ml-2 align-middle text-[10.5px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5">Main number</span>}
            {!line.isActive && <span className="ml-2 text-[11px] font-medium text-gray-400">(inactive)</span>}
          </p>
          {line.phone && <p className="text-[12px] text-gray-400 tabular-nums" dir="ltr">{line.phone}</p>}
        </div>
        <p className="text-[18px] font-bold text-gray-900 tabular-nums">{usd(line.costUsd)}</p>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-[11.5px] mb-1">
          <span className="text-gray-500">Free replies used</span>
          <span className={`tabular-nums font-medium ${TONE_TEXT[tone]}`}>
            {num(line.freeServiceUsed)} / {num(free)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10.5px] text-gray-400 mt-1">
          {line.freeServiceSource === "meta"
            ? "Counted by WhatsApp"
            : "Counted from this app's messages (WhatsApp's count isn't available for this line)"}
        </p>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-gray-400 text-[11.5px]">
              <th className="text-left font-medium py-1">Kind</th>
              <th className="text-right font-medium py-1 px-2">Delivered</th>
              <th className="text-right font-medium py-1 px-2">Free</th>
              <th className="text-right font-medium py-1 px-2">Charged</th>
              <th className="text-right font-medium py-1">Cost</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {CATEGORY_ORDER.filter((c) => c === "service" || line.byCategory[c]?.delivered).map((c) => {
              const v = line.byCategory[c];
              return (
                <tr key={c} className="border-t border-gray-50">
                  <td className="py-1.5">
                    {CATEGORY_LABEL[c]}
                    {c === "service" && v.delivered > 0 && (
                      <span className="block text-[11px] text-gray-400">
                        {num(line.serviceByFlow)} by flows · {num(line.serviceByAgent)} by agents
                      </span>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums">{num(v.delivered)}</td>
                  <td className="text-right px-2 tabular-nums">{num(v.free)}</td>
                  <td className="text-right px-2 tabular-nums">{num(v.charged)}</td>
                  <td className="text-right tabular-nums font-medium">{usd(v.costUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
