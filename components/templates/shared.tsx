import { Type, Image as ImageIcon, Video, FileText, Ban, Link2, Phone, MessageSquareText, Copy } from "lucide-react";
import type { TemplateButtonType, TemplateHeaderType } from "@/types";

// Shared between the Templates list page and the Create/Edit Template page so
// the two never drift. The message previews themselves are drawn by
// components/whatsapp/WaPreview.

export const LIMITS = { name: 512, header: 60, body: 800, footer: 60, button: 25 };

// Kept in sync with the backend's RESOLVERS in utils/templateVars.js — these
// are the only placeholders the send pipeline can actually resolve.
export const PERSONALIZE_VARS: { key: string; label: string }[] = [
  { key: "customer_name", label: "Customer name" },
  { key: "first_name", label: "First name" },
  { key: "agent_name", label: "Agent name" },
];

export const HEADER_TYPE_OPTIONS: { value: TemplateHeaderType; label: string; icon: typeof Type }[] = [
  { value: "NONE", label: "None", icon: Ban },
  { value: "TEXT", label: "Text", icon: Type },
  { value: "IMAGE", label: "Image", icon: ImageIcon },
  { value: "VIDEO", label: "Video", icon: Video },
  { value: "DOCUMENT", label: "Document", icon: FileText },
];

export const BUTTON_TYPE_META: Record<TemplateButtonType, { label: string; icon: typeof Link2 | null }> = {
  QUICK_REPLY: { label: "Quick Reply", icon: MessageSquareText },
  URL: { label: "URL", icon: Link2 },
  PHONE_NUMBER: { label: "Call Number", icon: Phone },
  COPY_CODE: { label: "Copy code", icon: Copy },
};

// Meta's button rules, mirrored from the API's utils/templateValidation.js.
// More than 3 buttons: WhatsApp shows two and folds the rest under "See all
// options". Quick Replies must sit together (QR, QR, URL — not QR, URL, QR).
export const BUTTON_LIMITS: Record<TemplateButtonType | "total", number> = { total: 10, QUICK_REPLY: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1 };
export const COPY_CODE_TITLE = "Copy offer code";

// Quick Replies kept together, on the side of whichever kind comes first —
// the order Meta accepts and the API saves (groupButtons there).
export function groupButtons<T extends { type: TemplateButtonType }>(buttons: T[]): T[] {
  if (!buttons.length) return buttons;
  const qr = buttons.filter((b) => b.type === "QUICK_REPLY");
  const other = buttons.filter((b) => b.type !== "QUICK_REPLY");
  return buttons[0].type === "QUICK_REPLY" ? [...qr, ...other] : [...other, ...qr];
}

export const OPT_OUT_TEXT = "Reply STOP to opt out";
export const PLACEHOLDER_RE = /\{\{\s*[a-z0-9_]+\s*\}\}/gi;

// Meta rejects a text header with newlines, emojis or formatting characters
// (same rule as the API's headerCharError). Placeholders are ignored — the
// underscore in {{customer_name}} is fine.
const HEADER_FORBIDDEN_RE = /[\r\n*_~`]|\p{Extended_Pictographic}/u;
export function headerCharError(text: string): string | null {
  const bad = text.replace(/\{\{[^{}]*\}\}/g, "").match(HEADER_FORBIDDEN_RE);
  if (!bad) return null;
  const what = bad[0] === "\n" || bad[0] === "\r" ? "a new line" : `"${bad[0]}"`;
  return `Headers can't contain ${what} — Meta doesn't allow emojis or formatting characters (* _ ~ \`) in a header.`;
}

// WhatsApp folds a tall message behind "Read more" on the phone. Meta doesn't
// publish the cut-off, so this is an estimate: lines as a phone wraps them
// (about 38 characters a line), blank lines included. Tuned from real sends —
// the Anniversary template (~18 lines) folded.
export const WA_CHARS_PER_LINE = 38;
export const WA_FOLD_LINES = 10;
export function estimateWaLines(text: string): number {
  return renderPreview(text)
    .replace(/[*_~`]/g, "")
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil([...line.trim()].length / WA_CHARS_PER_LINE)), 0);
}

export function renderPreview(text: string): string {
  let out = text;
  PERSONALIZE_VARS.forEach(({ key }) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), key === "agent_name" ? "Agent" : "Customer");
  });
  return out;
}

// WhatsApp's own formatting — *bold*, _italic_, ~strike~, ```mono``` — so a
// preview looks like the message on the phone instead of showing the markers.
// Markers must hug the text (no space just inside) and stay on one line, as
// in WhatsApp.
const WA_FORMAT_RE = /(```[^`]+```|\*[^\s*](?:[^*\n]*[^\s*])?\*|_[^\s_](?:[^_\n]*[^\s_])?_|~[^\s~](?:[^~\n]*[^\s~])?~)/g;
export function WaText({ text }: { text: string }) {
  const parts = text.split(WA_FORMAT_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        if (p.startsWith("```")) return <code key={i} className="font-mono text-[0.95em]">{p.slice(3, -3)}</code>;
        const inner = p.slice(1, -1);
        if (p[0] === "*") return <strong key={i} className="font-bold">{inner}</strong>;
        if (p[0] === "_") return <em key={i}>{inner}</em>;
        return <s key={i}>{inner}</s>;
      })}
    </>
  );
}

export function CharCount({ val, max }: { val: string; max: number }) {
  const over = val.length > max;
  return (
    <span className={`text-[11px] tabular-nums ${over ? "text-red-500 font-semibold" : "text-gray-400"}`}>
      {val.length}/{max}
    </span>
  );
}
