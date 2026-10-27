// WhatsApp text formatting (*bold* _italic_ ~strike~) applied to a selection.
//
// WhatsApp only formats when both markers sit on the same line and hug the
// words (no space or line break just inside), so each selected line is wrapped
// on its own, around its words, leaving spaces and blank lines outside.

export type WaMarker = "*" | "_" | "~";

export function wrapSelection(
  text: string,
  start: number,
  end: number,
  marker: WaMarker,
): { text: string; selStart: number; selEnd: number } {
  // Nothing selected: a pair with the cursor between them.
  if (start === end) {
    return { text: text.slice(0, start) + marker + marker + text.slice(end), selStart: start + 1, selEnd: start + 1 };
  }
  const wrapped = text
    .slice(start, end)
    .split("\n")
    .map((line) => {
      const m = /^(\s*)(.*?)(\s*)$/.exec(line);
      return m && m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : line;
    })
    .join("\n");
  return { text: text.slice(0, start) + wrapped + text.slice(end), selStart: start, selEnd: start + wrapped.length };
}
