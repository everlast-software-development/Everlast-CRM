// Dates, labels and print CSS for the Supervisor report.
//
// Every day/time in the report is shown in the clinic's time zone (the report
// says which; Dubai until it does), whatever the browser's own zone is — a
// supervisor printing from a laptop abroad still gets clinic times.

import type { ResponseBandKey, SupervisionReport, UserRole } from "@/types";
import { activeOutcome } from "@/lib/chatOutcome";
import { humanizeKey } from "../format";

export const CLINIC_TZ = "Asia/Dubai";
/** The API's limit on one report, in days (both ends included). */
export const MAX_REPORT_DAYS = 92;
/** The API's limit on transcripts per request. */
export const MAX_TRANSCRIPTS = 100;

// ── Day strings (YYYY-MM-DD) ──────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD as a UTC-midnight Date (null when it isn't a real day). */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !DAY_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  if (!d) return day;
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
}

/** Inclusive day count from → to (0 when either is invalid or to < from). */
export function spanDays(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Today's date in the clinic's time zone. */
export function clinicToday(tz = CLINIC_TZ): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ── Range presets ─────────────────────────────────────────────────────────

export const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "7d", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "custom", label: "Custom" },
] as const;

export type Preset = (typeof PRESETS)[number]["value"];
export type ReportRange = { preset: Preset; from: string; to: string };

/** from/to for a preset, as of `today`. The week starts on Monday. */
export function presetRange(preset: Exclude<Preset, "custom">, today = clinicToday()): { from: string; to: string } {
  const t = parseDay(today) ?? new Date();
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "week": {
      const back = (t.getUTCDay() + 6) % 7; // Mon = 0
      return { from: addDays(today, -back), to: today };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "month":
      return { from: dayString(new Date(Date.UTC(y, m, 1))), to: today };
    case "lastmonth":
      return { from: dayString(new Date(Date.UTC(y, m - 1, 1))), to: dayString(new Date(Date.UTC(y, m, 0))) };
  }
}

/** Range from the URL (?range=&from=&to=). A named preset is recomputed so a bookmark stays relative. */
export function parseRange(params: { get(name: string): string | null }): ReportRange {
  const r = params.get("range");
  const named = PRESETS.find((p) => p.value === r && p.value !== "custom");
  if (named) return { preset: named.value, ...presetRange(named.value as Exclude<Preset, "custom">) };
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const span = spanDays(from, to);
  if (span >= 1 && span <= MAX_REPORT_DAYS) return { preset: "custom", from, to };
  return { preset: "today", ...presetRange("today") };
}

/** Why a custom range can't be run, or null. */
export function rangeProblem(from: string, to: string): string | null {
  if (!parseDay(from) || !parseDay(to)) return "Pick both dates.";
  const span = spanDays(from, to);
  if (span < 1) return "“From” must be on or before “To”.";
  if (span > MAX_REPORT_DAYS) return `A report covers at most ${MAX_REPORT_DAYS} days.`;
  return null;
}

// ── Period and time labels ────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 13 Oct 2026", "1 – 31 Oct 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function periodLabel(from: string, to: string): string {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return `${from} – ${to}`;
  const [ad, am, ay] = [a.getUTCDate(), a.getUTCMonth(), a.getUTCFullYear()];
  const [bd, bm, by] = [b.getUTCDate(), b.getUTCMonth(), b.getUTCFullYear()];
  if (from === to) return `${WEEKDAYS[a.getUTCDay()]} ${ad} ${MONTHS[am]} ${ay}`;
  if (ay === by && am === bm) return `${ad} – ${bd} ${MONTHS[bm]} ${by}`;
  if (ay === by) return `${ad} ${MONTHS[am]} – ${bd} ${MONTHS[bm]} ${by}`;
  return `${ad} ${MONTHS[am]} ${ay} – ${bd} ${MONTHS[bm]} ${by}`;
}

function parts(iso: string, tz: string): Record<string, string> | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  // Newer ICU writes "Sept" in en-GB; keep three letters like the period label.
  if (out.month) out.month = out.month.slice(0, 3);
  return out;
}

/** Formats times in one zone; the year is shown only when it differs from `refYear`. */
export function makeTimeFormat(tz: string, refYear: number) {
  const date = (iso: string | null | undefined, withWeekday = true): string => {
    if (!iso) return "—";
    const p = parts(iso, tz);
    if (!p) return "—";
    const y = Number(p.year) !== refYear ? ` ${p.year}` : "";
    return `${withWeekday ? `${p.weekday} ` : ""}${p.day} ${p.month}${y}`;
  };
  const time = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    const p = parts(iso, tz);
    return p ? `${p.hour}:${p.minute}` : "—";
  };
  /** A clinic-time day key, for grouping a transcript by day. */
  const day = (iso: string): string => {
    const p = parts(iso, tz);
    return p ? `${p.year}-${p.month}-${p.day}` : "";
  };
  return {
    date,
    time,
    day,
    /** "Mon 13 Oct · 10:42" */
    dateTime: (iso: string | null | undefined) => (iso ? `${date(iso)} · ${time(iso)}` : "—"),
    /** "13 Oct, 10:42" — for narrow columns. */
    short: (iso: string | null | undefined) => (iso ? `${date(iso, false)}, ${time(iso)}` : "—"),
  };
}
export type TimeFormat = ReturnType<typeof makeTimeFormat>;

// ── Labels ────────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  SUPERVISOR: "Supervisor",
  AGENT: "Agent",
  MARKETING: "Marketing",
  DIRECTOR: "Director",
};

/**
 * Outcome keys the reports show: a chat's follow-up, and (in the per-person
 * counts) follow-ups cancelled. Anything else the server sends — the legacy
 * BOOKED / NOT_INTERESTED / NO_ANSWER on old chats or in old periods — counts
 * as no outcome and isn't listed (see activeOutcome).
 */
export const OUTCOME_LABEL: Record<string, string> = {
  FOLLOW_UP: "Follow up",
  CLEARED: "Follow-up cancelled",
};

export const OUTCOME_ORDER = ["FOLLOW_UP", "CLEARED"];

/** A chat's outcome key for the reports: "FOLLOW_UP", or "NONE" (incl. legacy values). */
export const chatOutcomeKey = (o: string | null | undefined): "FOLLOW_UP" | "NONE" => activeOutcome(o) ?? "NONE";

/** True when a chat has an outcome worth showing (a follow-up). */
export const hasOutcome = (o: string | null | undefined) => activeOutcome(o) !== null;

/** A chat's outcome, "—" for none (incl. legacy values). */
export function outcomeLabel(o: string | null | undefined): string {
  return hasOutcome(o) ? OUTCOME_LABEL.FOLLOW_UP : "—";
}

/** Only the outcome counts the reports show (OUTCOME_ORDER), zeros kept; legacy keys dropped. */
export const outcomeCounts = (record: Record<string, number> | null | undefined): [string, number][] =>
  OUTCOME_ORDER.map((k) => [k, record?.[k] ?? 0]);

/** The chats report's per-chat-outcome counts: follow-up, then no outcome (legacy values folded in). */
export function chatOutcomeCounts(byOutcome: Record<string, number> | null | undefined): [string, number][] {
  let followUp = 0;
  let none = 0;
  for (const [k, v] of Object.entries(byOutcome ?? {})) {
    if (chatOutcomeKey(k) === "FOLLOW_UP") followUp += v ?? 0;
    else none += v ?? 0;
  }
  return ([["FOLLOW_UP", followUp], ["NONE", none]] as [string, number][]).filter(([, v]) => v > 0);
}

export function percent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${Math.round(n)}%`;
}

/** "12.5%" — for the campaign rates, which come with one decimal. */
export function percent1(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

/** part ÷ whole as a percentage, null when whole is 0. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

// ── Labels for the detailed reports ───────────────────────────────────────

export const CHAT_STATUS_ORDER = ["OPEN", "PENDING", "RESOLVED"];
export const CHAT_STATUS_LABEL: Record<string, string> = { OPEN: "Open", PENDING: "Pending", RESOLVED: "Resolved" };
export const chatStatusLabel = (s: string | null | undefined) => (s ? CHAT_STATUS_LABEL[s] ?? humanizeKey(s) : "—");

/** Outcome incl. the chats report's NONE bucket (legacy values read as none). */
export const outcomeOrNone = (o: string | null | undefined) => (hasOutcome(o) ? outcomeLabel(o) : "No follow-up");

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  SCHEDULED: "Scheduled",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
export const campaignStatusLabel = (s: string | null | undefined) => (s ? CAMPAIGN_STATUS_LABEL[s] ?? humanizeKey(s) : "—");
export const campaignCategoryLabel = (s: string | null | undefined) => (s ? humanizeKey(s) : "—");

export const BAND_ORDER: ResponseBandKey[] = ["under5", "5to15", "15to30", "30to60", "over60"];
export const BAND_LABEL: Record<ResponseBandKey, string> = {
  under5: "Under 5 min",
  "5to15": "5–15 min",
  "15to30": "15–30 min",
  "30to60": "30–60 min",
  over60: "Over 1 hour",
};

/** Known keys in the given order (zeros kept when `keepZeros`), then any others the server sent, then `last` keys. */
export function orderedEntries(
  record: Record<string, number | undefined> | null | undefined,
  order: readonly string[],
  { keepZeros = false, last = [] as readonly string[] } = {},
): [string, number][] {
  const r = record ?? {};
  const known = order.filter((k) => keepZeros || (r[k] ?? 0) > 0).map((k) => [k, r[k] ?? 0] as [string, number]);
  const other = Object.entries(r)
    .filter(([k, v]) => !order.includes(k) && !last.includes(k) && (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, v]) => [k, v ?? 0] as [string, number]);
  const tail = last.filter((k) => (r[k] ?? 0) > 0).map((k) => [k, r[k] ?? 0] as [string, number]);
  return [...known, ...other, ...tail];
}

/** "Everlast Chats 2026-10-01 to 2026-10-13" — file names and the PDF's suggested name. */
export function reportFileName(report: string, from: string, to: string): string {
  return `Everlast ${report} ${from} to ${to}`;
}

/** "2026-10-13 14:05" in the clinic's zone — for CSV cells Excel reads as dates. */
export function isoLocal(iso: string | null | undefined, tz = CLINIC_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * A Date whose UTC fields are the clinic's wall-clock time. Spreadsheets have
 * no time zones, and exceljs writes a Date's UTC value — so this makes Excel
 * show the clinic time.
 */
export function wallClockDate(iso: string | null | undefined, tz = CLINIC_TZ): Date | null {
  const s = isoLocal(iso, tz);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
}

// ── Transcript picks ──────────────────────────────────────────────────────

type ReportChat = SupervisionReport["chats"][number];

export const PICKS = {
  attention: (c: ReportChat) => c.lateResponses > 0 || c.unanswered,
  /** The default: anything a supervisor would want to read. */
  default: (c: ReportChat) => c.lateResponses > 0 || c.unanswered,
  all: () => true,
} as const;

export function pickIds(chats: ReportChat[], test: (c: ReportChat) => boolean): Set<number> {
  const out = new Set<number>();
  for (const c of chats) {
    if (out.size >= MAX_TRANSCRIPTS) break;
    if (test(c)) out.add(c.id);
  }
  return out;
}

// ── Print CSS ─────────────────────────────────────────────────────────────

function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n<>]/g, " ")}"`;
}

/**
 * The report's stylesheet. Everything is scoped under .sr-* classes so it
 * can't leak into the rest of the CRM.
 *
 * Printing: the report renders inside the dashboard layout (sidebar, top bar,
 * a viewport-high overflow:hidden column). Rather than hiding things by
 * visibility and pulling the report out with position:absolute — which Chrome
 * won't break across pages properly — every element that neither is, holds,
 * nor sits inside the report is display:none'd, and the report's ancestors are
 * flattened to plain blocks, so the report prints in normal flow and page
 * breaks / repeated table headers work.
 *
 * The running footer uses @page margin boxes (Chrome/Edge 131+). Browsers
 * without them still get the report title + period in the closing footer.
 *
 * Theme: the report is a sheet of paper — light on screen even in the app's
 * dark theme (every colour below is a literal, and .sr-root pins
 * color-scheme), and always light when printed.
 */
export function reportCss(footer: string, { landscape = false }: { landscape?: boolean } = {}): string {
  return `
.sr-sheet{background:#fff;color:#1f2937;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:10pt;line-height:1.4;width:100%;max-width:${landscape ? "297mm" : "210mm"};margin:0 auto;padding:14mm;border:1px solid #eceeed;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04)}
.sr-root{color-scheme:light}
.sr-sheet *{box-sizing:border-box}
.sr-cover{border-top:4pt solid #3B694C;padding-top:10pt;margin-bottom:6pt}
.sr-brand{font-size:8.5pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#3B694C}
.sr-title{font-size:20pt;font-weight:700;color:#111827;margin:2pt 0 10pt;line-height:1.2}
.sr-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6pt 14pt;padding:8pt 0;border-top:.75pt solid #e5e7eb;border-bottom:.75pt solid #e5e7eb}
.sr-meta dt{font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
.sr-meta dd{margin:1pt 0 0;font-size:10pt;font-weight:600;color:#111827}
.sr-section{margin-top:18pt}
.sr-h2{font-size:13pt;font-weight:700;color:#111827;margin:0 0 7pt;padding-bottom:3pt;border-bottom:1.25pt solid #3B694C;break-after:avoid;page-break-after:avoid;display:flex;align-items:baseline;justify-content:space-between;gap:8pt}
.sr-h2 small{font-size:8.5pt;font-weight:500;color:#6b7280}
.sr-h3{font-size:9.5pt;font-weight:700;color:#374151;margin:10pt 0 4pt;break-after:avoid;page-break-after:avoid}
.sr-note{font-size:8.5pt;color:#6b7280;margin:5pt 0 0}
.sr-break{margin-top:26pt;padding-top:14pt;border-top:1px dashed #d1d5db}
.sr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5pt}
.sr-kpi{border:.75pt solid #d6e2da;border-radius:4pt;padding:6pt 7pt;break-inside:avoid;page-break-inside:avoid;background:#fbfcfb}
.sr-kpi-label{font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;line-height:1.25}
.sr-kpi-value{font-size:15pt;font-weight:700;color:#111827;margin-top:2pt;line-height:1.15;font-variant-numeric:tabular-nums}
.sr-kpi-sub{font-size:7.5pt;color:#6b7280;margin-top:1pt}
.sr-kpi.sr-kpi-bad{border-color:#f3c4c4;background:#fdf6f6}
.sr-kpi.sr-kpi-bad .sr-kpi-value{color:#b91c1c}
.sr-kpi.sr-kpi-good .sr-kpi-value{color:#2f5840}
.sr-twocol{display:grid;grid-template-columns:1fr 1fr;gap:14pt;margin-top:4pt}
.sr-table{width:100%;border-collapse:collapse;font-size:8.5pt;line-height:1.3}
.sr-table thead{display:table-header-group}
.sr-table tfoot{display:table-row-group}
.sr-table tr{break-inside:avoid;page-break-inside:avoid}
.sr-table th{text-align:left;font-weight:600;color:#374151;background:#eef4f0;border-bottom:1pt solid #9fb5a6;padding:3.5pt 4pt;vertical-align:bottom}
.sr-table td{border-bottom:.5pt solid #e5e7eb;padding:3pt 4pt;vertical-align:top}
.sr-table .sr-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sr-table .sr-nowrap{white-space:nowrap}
.sr-table .sr-total td{font-weight:700;border-top:1pt solid #9ca3af;border-bottom:0;background:#f7f8f7}
.sr-table-compact{font-size:8pt}
.sr-bad{color:#b91c1c;font-weight:700}
.sr-good{color:#2f5840;font-weight:600}
.sr-muted{color:#6b7280}
.sr-sub{display:block;font-size:7.5pt;color:#6b7280}
.sr-struck{text-decoration:line-through;color:#9ca3af}
.sr-tag{display:inline-block;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:.75pt solid currentColor;border-radius:2pt;padding:0 2.5pt;margin-left:3pt;vertical-align:1pt}
.sr-empty{padding:9pt;border:.75pt dashed #d1d5db;border-radius:4pt;color:#6b7280;text-align:center;font-size:9pt;break-inside:avoid}
.sr-tx{margin-top:14pt}
.sr-tx-head{background:#eef4f0;border-left:3pt solid #3B694C;padding:5pt 8pt;break-after:avoid;page-break-after:avoid;break-inside:avoid}
.sr-tx-name{font-size:10.5pt;font-weight:700;color:#111827}
.sr-tx-meta{font-size:8pt;color:#4b5563;margin-top:1pt}
.sr-tx-small{break-inside:avoid;page-break-inside:avoid}
.sr-day{font-size:7.5pt;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;padding:6pt 6pt 2pt;break-after:avoid;page-break-after:avoid}
.sr-msg{display:grid;grid-template-columns:30pt 78pt 1fr;gap:6pt;padding:2.5pt 6pt;font-size:8.5pt;line-height:1.35;border-bottom:.5pt solid #f1f1f1;break-inside:avoid;page-break-inside:avoid}
.sr-msg-time{color:#6b7280;font-variant-numeric:tabular-nums}
.sr-msg-who{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-msg-text{white-space:pre-wrap;overflow-wrap:anywhere}
.sr-msg-patient{background:#f4f4f5;border-left:2pt solid #9ca3af}
.sr-msg-patient .sr-msg-who{color:#374151}
.sr-msg-agent{border-left:2pt solid #3B694C}
.sr-msg-agent .sr-msg-who{color:#2f5840}
.sr-msg-bot,.sr-msg-campaign{border-left:2pt solid #d1d5db}
.sr-msg-bot .sr-msg-who,.sr-msg-campaign .sr-msg-who{color:#6b7280}
.sr-msg-bot .sr-msg-text,.sr-msg-campaign .sr-msg-text{color:#4b5563}
.sr-end{margin-top:22pt;padding-top:6pt;border-top:.75pt solid #d1d5db;font-size:7.5pt;color:#6b7280;display:flex;justify-content:space-between;gap:8pt}
.sr-kpis-3{grid-template-columns:repeat(3,1fr)}
.sr-kpis-5{grid-template-columns:repeat(5,1fr)}
.sr-threecol{display:grid;grid-template-columns:repeat(3,1fr);gap:12pt;margin-top:4pt}
.sr-table-tiny{font-size:7.25pt;line-height:1.25}
.sr-table-tiny th{padding:3pt 3pt}
.sr-table-tiny td{padding:2.5pt 3pt}
.sr-list{margin:0;padding:0;list-style:none}
.sr-list li+li{margin-top:1.5pt}
.sr-block{margin-top:12pt;border:.75pt solid #d6e2da;border-radius:4pt;padding:8pt 9pt;break-inside:avoid;page-break-inside:avoid}
.sr-block-head{display:flex;justify-content:space-between;align-items:baseline;gap:8pt;border-bottom:.75pt solid #e5e7eb;padding-bottom:4pt;margin-bottom:6pt}
.sr-block-title{font-size:11pt;font-weight:700;color:#111827}
.sr-facts{display:grid;grid-template-columns:repeat(4,1fr);gap:3pt 10pt;font-size:8pt;margin-bottom:6pt}
.sr-facts dt{font-size:7pt;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
.sr-facts dd{margin:0;font-weight:600;color:#111827}
.sr-bars{display:grid;gap:3pt}
.sr-bar-row{display:grid;grid-template-columns:82pt 1fr 62pt;gap:6pt;align-items:center;font-size:8.5pt;break-inside:avoid}
.sr-bar-label{color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-bar-value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sr-bar-track{height:8pt;background:#eef1ef;border-radius:2pt;overflow:hidden}
.sr-bar-fill{display:block;height:100%;background:#3B694C;border-radius:2pt}
.sr-mini{display:inline-block;width:46pt;height:5pt;background:#eef1ef;border-radius:1.5pt;overflow:hidden;vertical-align:1pt;margin-right:4pt}
.sr-mini>span{display:block;height:100%;background:#7fa38b}
.sr-stack{display:flex;height:8pt;border-radius:2pt;overflow:hidden;background:#eef1ef;min-width:60pt}
.sr-stack>span{display:block;height:100%}
.sr-band-under5{background:#3B694C}
.sr-band-5to15{background:#86ab92}
.sr-band-15to30{background:#e3bd55}
.sr-band-30to60{background:#e08a3c}
.sr-band-over60{background:#c0392b}
.sr-legend{display:flex;flex-wrap:wrap;gap:3pt 10pt;font-size:7.5pt;color:#4b5563;margin:4pt 0}
.sr-legend i{display:inline-block;width:7pt;height:7pt;border-radius:1.5pt;margin-right:3pt;vertical-align:-.5pt}
.sr-hours{display:grid;grid-template-columns:repeat(24,1fr);gap:2pt;align-items:end;height:70pt;border-bottom:.75pt solid #9ca3af;padding:0 1pt}
.sr-hour{display:flex;align-items:flex-end;justify-content:center;gap:.75pt;height:100%}
.sr-hour>span{display:block;width:42%;min-height:.5pt}
.sr-hour-p{background:#3B694C}
.sr-hour-s{background:#b9c7be}
.sr-hour-labels{display:grid;grid-template-columns:repeat(24,1fr);gap:2pt;font-size:6.5pt;color:#6b7280;text-align:center;margin-top:2pt;font-variant-numeric:tabular-nums}
.sr-funnel{display:grid;gap:2.5pt}
.sr-funnel-row{display:grid;grid-template-columns:86pt 1fr 44pt 40pt;gap:6pt;align-items:center;font-size:8.5pt}
.sr-funnel-row .sr-bar-track{height:9pt}
.sr-pct{text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}
.sr-index td:first-child{color:#6b7280;font-variant-numeric:tabular-nums}
@page{size:A4 ${landscape ? "landscape" : "portrait"};margin:14mm 14mm 16mm 14mm;
  @bottom-left{content:${cssString(footer)};font-size:7.5pt;color:#6b7280;font-family:ui-sans-serif,system-ui,"Segoe UI",Arial,sans-serif}
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#6b7280;font-family:ui-sans-serif,system-ui,"Segoe UI",Arial,sans-serif}
}
@media print{
  html,body{background:#fff!important;color:#1f2937!important;color-scheme:light!important;height:auto!important;min-height:0!important;overflow:visible!important}
  body *:not(:has(.sr-root)):not(.sr-root):not(.sr-root *){display:none!important}
  *:has(.sr-root){display:block!important;position:static!important;overflow:visible!important;height:auto!important;min-height:0!important;max-height:none!important;width:auto!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;background:#fff!important;box-shadow:none!important;transform:none!important}
  .sr-root{display:block!important;margin:0!important;padding:0!important}
  .sr-root *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sr-sheet{max-width:none;padding:0 8mm;margin:0;border:0;border-radius:0;box-shadow:none}
  .sr-break{break-before:page;page-break-before:always;margin-top:0;padding-top:0;border-top:0}
  .sr-tx-long{break-before:page;page-break-before:always;margin-top:0}
}
`;
}
