"use client";

import { forwardRef, useEffect, useRef } from "react";
import Link from "next/link";
import type { SavedReply } from "@/types";

// The list that opens above the chat composer when an agent types "/" (or
// clicks the saved-replies button). The composer owns the keyboard: ↑/↓ move
// `activeIndex`, Enter/Tab pick, Esc closes. See lib/savedReplies.ts.
export const SavedReplyPicker = forwardRef<HTMLDivElement, {
  replies: SavedReply[];
  /** Nothing saved at all (not just nothing matching). */
  empty: boolean;
  activeIndex: number;
  canManage: boolean;
  onPick: (reply: SavedReply) => void;
  onHover: (index: number) => void;
}>(function SavedReplyPicker({ replies, empty, activeIndex, canManage, onPick, onHover }, ref) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div ref={ref} className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        Saved replies
      </div>
      {empty ? (
        <div className="px-3 py-3 text-[12.5px] text-gray-500">
          No saved replies yet.
          {canManage && <> <Link href="/settings?tab=saved-replies" className="text-brand-fg font-medium hover:underline">Add some in Settings</Link></>}
        </div>
      ) : replies.length === 0 ? (
        <p className="px-3 py-3 text-[12.5px] text-gray-500">No saved replies match.</p>
      ) : (
        <ul ref={listRef} role="listbox" aria-label="Saved replies" className="max-h-64 overflow-y-auto py-1">
          {replies.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown, not click: keeps focus in the textarea.
              onMouseDown={(e) => { e.preventDefault(); onPick(r); }}
              onMouseEnter={() => onHover(i)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2.5 ${i === activeIndex ? "bg-brand-100" : "hover:bg-gray-50"}`}
            >
              <span className="shrink-0 text-[12px] font-mono font-semibold text-brand-fg pt-px">/{r.shortcut}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-gray-800 truncate" dir="auto">{r.title}</span>
                <span className="block text-[12px] text-gray-500 truncate" dir="auto">{r.body}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="px-3 py-1.5 border-t border-gray-100 text-[11px] text-gray-400">
        ↑↓ to move · Enter to insert · Esc to close
      </div>
    </div>
  );
});
