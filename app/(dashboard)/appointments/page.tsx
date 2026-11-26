"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, MessageSquare, RefreshCw, Search, Send } from "lucide-react";
import { apiGetAppointments } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { NoAccess } from "@/components/NoAccess";
import { PageSpinner } from "@/components/ui/spinner";
import type { AppointmentStatusGroup, AppointmentsDay, ClinicAppointment } from "@/types";

// The clinic's appointments for a day, read from Dok32 (read-only): who is
// coming, when, with whom, where each stands in Dok32 — and who the
// appointment confirmation message would go to (statuses Unconfirmed / No
// answer, one message per phone). Supervisors and admins (appointment:read).
// Nothing is sent from this page and nothing is written to Dok32.

const TZ = "Asia/Dubai";

const GROUPS: { key: AppointmentStatusGroup; label: string; tone: string }[] = [
  { key: "unconfirmed", label: "Unconfirmed", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "no_answer", label: "No answer", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  { key: "confirmed", label: "Confirmed", tone: "bg-teal-50 text-teal-700 border-teal-200" },
  { key: "arrived", label: "Arrived / being seen", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  { key: "done", label: "Complete", tone: "bg-gray-100 text-gray-600 border-gray-200" },
  { key: "cancelled", label: "Cancelled / missed", tone: "bg-red-50 text-red-600 border-red-200" },
  { key: "other", label: "Other", tone: "bg-gray-50 text-gray-500 border-gray-200" },
];
const toneOf = (g: AppointmentStatusGroup) => GROUPS.find((x) => x.key === g)?.tone ?? "";

const todayInClinic = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
function shiftDay(date: string, by: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
const dayLabel = (date: string) => {
  const today = todayInClinic();
  const name = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  if (date === today) return `Today · ${name}`;
  if (date === shiftDay(today, 1)) return `Tomorrow · ${name}`;
  if (date === shiftDay(today, -1)) return `Yesterday · ${name}`;
  return name;
};

export default function AppointmentsPage() {
  const { ready, can } = useCurrentUser();
  const allowed = can("appointment:read");
  const [date, setDate] = useState(todayInClinic);
  const [day, setDay] = useState<AppointmentsDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [group, setGroup] = useState<AppointmentStatusGroup | "all">("all");
  const [onlyMessages, setOnlyMessages] = useState(false);
  const [provider, setProvider] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    apiGetAppointments(date)
      .then((res) => { if (!cancelled) { setDay(res.data); setError(null); } })
      .catch((err) => { if (!cancelled) { setDay(null); setError(err instanceof Error ? err.message : "Couldn't load the appointments"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, date, reload]);

  const providers = useMemo(() => [...new Set((day?.appointments ?? []).map((a) => a.provider || "—"))].sort(), [day]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (day?.appointments ?? []).filter((a) =>
      (group === "all" || a.statusGroup === group) &&
      (!onlyMessages || a.willBeSent) &&
      (!provider || (a.provider || "—") === provider) &&
      (!q || a.name.toLowerCase().includes(q) || (a.phone || "").includes(q.replace(/\s/g, "")) || (a.session || "").toLowerCase().includes(q)),
    );
  }, [day, group, onlyMessages, provider, search]);

  if (!ready) return <PageSpinner />;
  if (!allowed) return <NoAccess what="appointments" />;

  const go = (next: string) => { setLoading(true); setDate(next); };
  const s = day?.summary;
  const confirmed = s?.byGroup.confirmed ?? 0;
  const waiting = (s?.byGroup.unconfirmed ?? 0) + (s?.byGroup.no_answer ?? 0);

  return (
    <div className="p-6 lg:p-8 bg-canvas min-h-full overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-400 mt-0.5 max-w-2xl">
            The clinic&apos;s appointments from Dok32, and who the appointment confirmation message would go to. Read-only: nothing here changes Dok32.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
            <button type="button" onClick={() => go(shiftDay(date, -1))} disabled={loading} aria-label="Previous day" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && go(e.target.value)}
              className="text-[13px] font-semibold text-gray-700 bg-transparent px-1 outline-none cursor-pointer"
              aria-label="Day"
            />
            <button type="button" onClick={() => go(shiftDay(date, 1))} disabled={loading} aria-label="Next day" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {[["Today", todayInClinic()], ["Tomorrow", shiftDay(todayInClinic(), 1)]].map(([label, d]) => (
            <button
              key={label}
              type="button"
              onClick={() => go(d)}
              className={`px-3 py-1.5 rounded-xl text-[13px] font-medium border cursor-pointer ${date === d ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={() => { setLoading(true); setReload((n) => n + 1); }} disabled={loading} title="Read Dok32 again" aria-label="Refresh" className="p-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => day && downloadAppointmentsXlsx(day, shown)}
            disabled={!day || shown.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      <p className="mt-4 text-[13px] font-semibold text-gray-700">{dayLabel(date)}</p>

      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-600">{error}</div>
      )}

      {!day ? (
        !error && <div className="mt-3 h-40 bg-white rounded-xl border border-gray-100 animate-pulse" />
      ) : (
        <div className={`mt-3 space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Appointments" value={s!.appointments} hint={`${s!.patients} patients`} />
            <Stat label="Confirmed" value={confirmed} hint={s!.appointments ? `${Math.round((confirmed / s!.appointments) * 100)}% of the day` : undefined} />
            <Stat label="Not confirmed yet" value={waiting} hint="Unconfirmed or No answer" tone={waiting > 0 ? "amber" : undefined} />
            <Stat label="Would get the message" value={s!.messages} hint="One per phone, statuses Unconfirmed / No answer" icon={<Send className="w-3.5 h-3.5" />} />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={group === "all"} onClick={() => setGroup("all")} label="All" count={s!.appointments} />
            {GROUPS.filter((g) => s!.byGroup[g.key]).map((g) => (
              <Chip key={g.key} active={group === g.key} onClick={() => setGroup(g.key)} label={g.label} count={s!.byGroup[g.key] ?? 0} tone={g.tone} />
            ))}
            <label className="inline-flex items-center gap-1.5 ml-1 text-[13px] text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={onlyMessages} onChange={(e) => setOnlyMessages(e.target.checked)} className="accent-teal-600" />
              Only who gets the message
            </label>
            <div className="flex-1" />
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="text-[13px] bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 text-gray-700 cursor-pointer" aria-label="Doctor">
              <option value="">All doctors</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, session" className="text-[13px] bg-white border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 w-52 outline-none focus:border-teal-400" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Patient</th>
                  <th className="px-3 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">Doctor</th>
                  <th className="px-3 py-2.5 font-medium">Session</th>
                  <th className="px-3 py-2.5 font-medium">Dok32 status</th>
                  <th className="px-3 py-2.5 font-medium">Confirmation message</th>
                  <th className="px-3 py-2.5 font-medium sr-only">Chat</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">{day.appointments.length ? "No appointments match these filters." : "No appointments on this day."}</td></tr>
                ) : shown.map((a) => <Row key={a.id} a={a} />)}
              </tbody>
            </table>
          </div>

          <p className="text-[12px] text-gray-400">
            Read from Dok32 at {new Date(day.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ })} (Dubai). Staff keep changing statuses in Dok32 — refresh for the latest.
            Doctor names in the message are suggestions until the clinic confirms them.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ a }: { a: ClinicAppointment }) {
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 align-top">
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
        <span className="font-semibold text-gray-800">{a.time}</span>
        <span className="text-gray-400"> – {a.endTime}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-gray-800 font-medium" dir="auto">{a.name || "—"}</span>
        {a.language === "ar" && <span className="ml-1.5 text-[11px] text-gray-400">Arabic</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600">{a.phone || <span className="text-gray-300">none</span>}</td>
      <td className="px-3 py-2.5">
        <span className="text-gray-800">{a.provider || "—"}</span>
        {a.providerInMessage !== a.provider && <span className="block text-[11.5px] text-gray-400">In message: {a.providerInMessage}</span>}
      </td>
      <td className="px-3 py-2.5 text-gray-600 max-w-[260px]">{a.session || "—"}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded-full border text-[12px] font-medium ${toneOf(a.statusGroup)}`}>{a.status}</span>
      </td>
      <td className="px-3 py-2.5">
        {a.willBeSent ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-teal-700"><Send className="w-3.5 h-3.5" /> Will be sent</span>
        ) : (
          <span className="text-[12.5px] text-gray-400">{a.whyNot}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {a.conversationId ? (
          <Link href={`/chats/${a.conversationId}`} title="Open the chat" className="inline-flex items-center gap-1 text-[12.5px] text-teal-700 hover:underline whitespace-nowrap">
            <MessageSquare className="w-3.5 h-3.5" /> Chat
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

function Stat({ label, value, hint, tone, icon }: { label: string; value: number; hint?: string; tone?: "amber"; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "amber" ? "bg-amber-50/60 border-amber-200" : "bg-white border-gray-100"}`}>
      <p className="text-[12px] text-gray-500 flex items-center gap-1">{icon}{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value.toLocaleString("en-US")}</p>
      {hint && <p className="text-[11.5px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Chip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-[12.5px] font-medium cursor-pointer ${active ? "bg-gray-900 text-white border-gray-900" : tone || "bg-white text-gray-600 border-gray-200"}`}
    >
      {label} <span className={active ? "text-white/70" : "opacity-60"}>{count}</span>
    </button>
  );
}

// The rows shown, as an Excel file — the same columns as the review sheet.
async function downloadAppointmentsXlsx(day: AppointmentsDay, rows: ClinicAppointment[]) {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Everlast CRM";
  const ws = wb.addWorksheet(`Appointments ${day.date}`, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Will be sent?", key: "send", width: 13 },
    { header: "Why not", key: "why", width: 34 },
    { header: "Name", key: "name", width: 26 },
    { header: "Phone", key: "phone", width: 17 },
    { header: "Language", key: "language", width: 10 },
    { header: "Appointment date {{1}}", key: "date", width: 21 },
    { header: "Time {{2}}", key: "time", width: 11 },
    { header: "Doctor in message {{3}}", key: "doctorMsg", width: 24 },
    { header: "Doctor in Dok32", key: "doctor", width: 32 },
    { header: "Session", key: "session", width: 42 },
    { header: "Dok32 status", key: "status", width: 18 },
    { header: "Appointment id", key: "id", width: 14 },
  ];
  for (const a of rows) {
    ws.addRow({
      send: a.willBeSent ? "Yes" : "No", why: a.whyNot ?? "", name: a.name, phone: a.phone ?? "",
      language: a.language === "ar" ? "Arabic" : "English", date: a.date, time: a.time,
      doctorMsg: a.providerInMessage, doctor: a.provider ?? "", session: a.session ?? "", status: a.status, id: a.id,
    });
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF4F0" } };
  ws.autoFilter = { from: "A1", to: "L1" };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `Appointments ${day.date}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
