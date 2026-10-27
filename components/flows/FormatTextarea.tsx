"use client";

import { useRef } from "react";
import { Bold, Italic, Strikethrough } from "lucide-react";
import { wrapSelection, type WaMarker } from "@/lib/waFormat";

const TOOLS: { marker: WaMarker; label: string; icon: typeof Bold }[] = [
  { marker: "*", label: "Bold", icon: Bold },
  { marker: "_", label: "Italic", icon: Italic },
  { marker: "~", label: "Strikethrough — e.g. an old price: ~150~ 99", icon: Strikethrough },
];

// A flow text box with WhatsApp's Bold / Italic / Strikethrough. Select the
// words (e.g. the old price) and press a button. dir="auto" keeps Arabic
// right-to-left.
export function FormatTextarea({
  value,
  onChange,
  rows = 4,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(marker: WaMarker) {
    const el = ref.current;
    if (!el) return;
    const { text, selStart, selEnd } = wrapSelection(value, el.selectionStart ?? 0, el.selectionEnd ?? 0, marker);
    onChange(text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  return (
    <div>
      <textarea
        ref={ref}
        rows={rows}
        dir="auto"
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex items-center gap-0.5 mt-1">
        {TOOLS.map(({ marker, label, icon: Icon }) => (
          <button
            key={marker}
            type="button"
            title={label}
            aria-label={label.split(" —")[0]}
            // Keep the selection in the textarea while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(marker)}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
        <span className="ml-1 text-[11px] text-gray-400">Select text, then format</span>
      </div>
    </div>
  );
}
