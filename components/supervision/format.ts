// Formatting shared by the Supervision page's pieces.

import type { PersonRef } from "@/types";
import { isUnsupportedMessage, UNSUPPORTED_LABEL } from "@/lib/specialMessages";

/** Waiting amber from this many working minutes; red from the SLA. */
export const WAIT_WARN_MINUTES = 15;

/** "45m", "2h 10m", "3d 4h". Null → "—". */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return "< 1m";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(min / (24 * 60));
  const h = Math.floor((min % (24 * 60)) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/** "just now", "4m ago", "3h ago", "2d ago" — against a `now` the caller ticks. */
export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Inbox-style list time: 10:42 today, "Yesterday", weekday, then a date. */
export function listTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Tue 14 Oct" (+ year when not this year). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "Tue 14 Oct · 10:30" */
export function dateTime(iso: string): string {
  return `${shortDate(iso)} · ${clockTime(iso)}`;
}

/** Today / Tomorrow / Yesterday / "Tue 14 Oct" — for day headings. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return shortDate(iso);
}

/** Local YYYY-MM-DD, for grouping by day. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function personName(p: { name?: string | null; username: string } | null | undefined): string {
  if (!p) return "Unassigned";
  return p.name || p.username;
}

export function initials(text: string | null | undefined): string {
  if (!text) return "?";
  const out = text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return out || "?";
}

export function personInitials(p: PersonRef | { name?: string | null; username: string } | null | undefined): string {
  return initials(p ? p.name || p.username : null);
}

export function patientName(c: { name: string | null; phone: string }): string {
  return c.name || formatPhone(c.phone);
}

export function formatPhone(phone: string): string {
  if (!phone) return "";
  return phone.startsWith("+") ? phone : `+${phone}`;
}

// A template / interactive message is stored as JSON ({ body, buttons, list… }).
// Mirrors the inbox's messagePreview (not exported from the chat page).
export function parseStructured(content: string | null | undefined): {
  header?: string;
  body: string;
  footer?: string;
  buttons?: { title: string }[];
  list?: { buttonLabel: string; rows: { title: string }[] };
} | null {
  if (!content || content[0] !== "{") return null;
  try {
    const p = JSON.parse(content);
    if (p && typeof p === "object" && typeof p.body === "string") return p;
  } catch {}
  return null;
}

const MEDIA_LABEL: Record<string, string> = {
  IMAGE: "Photo",
  VIDEO: "Video",
  AUDIO: "Voice message",
  DOCUMENT: "Document",
  STICKER: "Sticker",
  LOCATION: "Location",
  CONTACTS: "Contact card",
};

/** One readable line for any message: text, a template's body, or "Photo". */
export function messagePreview(m: { messageType?: string | null; content: string | null }): string {
  const type = (m.messageType || "TEXT").toUpperCase();
  const structured = parseStructured(m.content);
  if (structured?.body) return structured.body;
  if (MEDIA_LABEL[type]) return MEDIA_LABEL[type];
  if (isUnsupportedMessage(m.content)) return UNSUPPORTED_LABEL;
  if (type === "TEXT" || !m.messageType) return m.content || "";
  return m.content && !m.content.startsWith("http") ? m.content : `[${type.toLowerCase()}]`;
}

/** "preferred_date" → "Preferred date". */
export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(answerText).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
