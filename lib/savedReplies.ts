import type { SavedReply } from "@/types";

// The chat composer's "/" picker. Checked by scripts/check-saved-replies.ts.

const MAX_SHOWN = 8;

/**
 * The picker's search text, or null when it shouldn't be open. Only a "/" at
 * the very start of the box counts ("1/2 price" never opens it), and a space
 * or newline closes it: shortcuts have no spaces, so the agent is writing.
 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const rest = text.slice(1);
  return /\s/.test(rest) ? null : rest;
}

/** Shortcuts starting with the query first, then any shortcut or title containing it. */
export function filterReplies(replies: SavedReply[], query: string): SavedReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return replies.slice(0, MAX_SHOWN);
  const starts = replies.filter((r) => r.shortcut.startsWith(q));
  const contains = replies.filter((r) => !r.shortcut.startsWith(q) && (r.shortcut.includes(q) || r.title.toLowerCase().includes(q)));
  return [...starts, ...contains].slice(0, MAX_SHOWN);
}

/**
 * {name} → the patient's first name. A contact saved as just a phone number has
 * no name, so {name} is dropped and the line tidied: "Hi {name}," → "Hi,".
 * Lines without {name} are left exactly as written.
 */
export function fillReply(body: string, fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const name = /\p{L}/u.test(first) ? first : "";
  if (name) return body.replace(/\{name\}/g, name);
  return body
    .split("\n")
    .map((line) => {
      if (!line.includes("{name}")) return line;
      return line
        .replace(/\{name\}/g, "")
        .replace(/ {2,}/g, " ")
        .replace(/ ([,.!?،؟])/g, "$1")
        .trim();
    })
    .join("\n");
}
