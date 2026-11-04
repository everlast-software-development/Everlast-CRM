// Pure check of lib/savedReplies.ts — the "/" picker's query, filter and
// {name} fill. No browser, no network.
// Run: node scripts/check-saved-replies.ts   (Node 24 strips the types)

import { fillReply, filterReplies, slashQuery } from "../lib/savedReplies.ts";
import type { SavedReply } from "../types/index.ts";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
}

check("'/ho' opens with query ho", slashQuery("/ho"), "ho");
check("'/' alone opens with empty query", slashQuery("/"), "");
check("'1/2 price' does not open", slashQuery("1/2 price"), null);
check("plain text does not open", slashQuery("hi"), null);
check("a newline closes it", slashQuery("/a\nb"), null);
check("a space after the query closes it", slashQuery("/hours please"), null);

check("{name} becomes the first name", fillReply("Hi {name}, welcome", "Sara Ahmed"), "Hi Sara, welcome");
check("no name: 'Hi {name},' → 'Hi,'", fillReply("Hi {name}, welcome", null), "Hi, welcome");
check("no name at the start", fillReply("{name} hello", ""), "hello");
check("no name mid-sentence keeps one space", fillReply("Thanks {name} for writing", undefined), "Thanks for writing");
check("other lines untouched", fillReply("Hi {name}!\n  Address: X", null), "Hi!\n  Address: X");
check("Arabic name and text", fillReply("أهلاً {name}", "محمد علي"), "أهلاً محمد");
check("a phone number is not a name", fillReply("Hi {name},", "+971501234567"), "Hi,");

const r = (id: number, shortcut: string, title: string): SavedReply => ({ id, shortcut, title, body: "", updatedAt: "" });
const list = [r(1, "address", "Clinic address"), r(2, "hours", "Opening hours"), r(3, "price-list", "Prices")];
check("prefix match comes first", filterReplies(list, "pr")[0]?.shortcut, "price-list");
check("title match is found", filterReplies(list, "opening")[0]?.shortcut, "hours");
check("matching ignores case", filterReplies(list, "CLINIC")[0]?.shortcut, "address");
check("empty query lists everything", filterReplies(list, "").length, 3);
check("no match is empty", filterReplies(list, "zzz").length, 0);
check("at most 8", filterReplies(Array.from({ length: 12 }, (_, i) => r(i, `a${i}`, "t")), "a").length, 8);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
