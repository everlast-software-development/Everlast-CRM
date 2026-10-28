"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon, Plus, Trash2, Video } from "lucide-react";
import MediaField from "@/components/MediaField";
import type { FlowCard } from "@/types";
import { CARD_LIMITS, flowCardLabel, newFlowCard } from "@/lib/flows";
import { FormatTextarea } from "./FormatTextarea";

// WhatsApp's interactive carousel rules (validated again on the server):
// 2–10 cards; every card the same buttons — 1 or 2 quick replies, or a single
// link; card text ≤160 characters with ≤2 line breaks; JPEG/PNG images.
type Layout = "QR1" | "QR2" | "URL";
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "QR2", label: "2 buttons (e.g. View offer + Book now)" },
  { value: "QR1", label: "1 button" },
  { value: "URL", label: "A link (opens your website)" },
];

const layoutOf = (cards: FlowCard[]): Layout => {
  const b = cards[0]?.buttons || [];
  return b[0]?.type === "URL" ? "URL" : b.length >= 2 ? "QR2" : "QR1";
};

function withLayout(card: FlowCard, layout: Layout, template?: FlowCard): FlowCard {
  if (layout === "URL") {
    const old = card.buttons.find((b) => b.type === "URL");
    return { ...card, buttons: [{ id: "b0", type: "URL", title: old?.title ?? template?.buttons[0]?.title ?? "Shop now", url: old?.url ?? "" }] };
  }
  const n = layout === "QR2" ? 2 : 1;
  const qr = card.buttons.filter((b) => b.type !== "URL");
  return {
    ...card,
    buttons: Array.from({ length: n }, (_, j) => ({
      id: `b${j}`,
      type: "QUICK_REPLY" as const,
      title: qr[j]?.title ?? template?.buttons[j]?.title ?? (j === 0 ? "View offer" : "Book now"),
    })),
  };
}

const inputCls = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-800 outline-none focus:border-brand bg-white";

// Every change is "change the current cards", applied to the latest list —
// never a whole list captured earlier. An upload that finishes after more cards
// were added used to put the old list back and drop the new cards.
type CardsUpdate = (prev: FlowCard[]) => FlowCard[];

export function CardsEditor({ cards, onChange }: { cards: FlowCard[]; onChange: (update: CardsUpdate) => void }) {
  const layout = layoutOf(cards);
  const [open, setOpen] = useState<number | null>(0);

  // Cards are addressed by id (falling back to position for cards saved
  // without one), so a late update still lands on the right card after a reorder.
  const keyOf = (c: FlowCard, i: number) => c.id ?? i;
  const updateCard = (key: string | number, change: (c: FlowCard) => FlowCard) =>
    onChange((prev) => prev.map((c, j) => (keyOf(c, j) === key ? change(c) : c)));
  const update = (i: number, patch: Partial<FlowCard>) => updateCard(keyOf(cards[i], i), (c) => ({ ...c, ...patch }));
  const setButtonTitle = (i: number, j: number, title: string) =>
    updateCard(keyOf(cards[i], i), (c) => ({ ...c, buttons: c.buttons.map((b, k) => (k === j ? { ...b, title } : b)) }));
  const setButtonUrl = (i: number, url: string) =>
    updateCard(keyOf(cards[i], i), (c) => ({ ...c, buttons: c.buttons.map((b) => (b.type === "URL" ? { ...b, url } : b)) }));
  const move = (i: number, d: -1 | 1) => {
    onChange((prev) => {
      const next = [...prev];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
    setOpen(i + d);
  };

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1.5">Buttons on every card</span>
        <select
          className={inputCls}
          value={layout}
          onChange={(e) => {
            const next = e.target.value as Layout;
            onChange((prev) => prev.map((c) => withLayout(c, next, prev[0])));
          }}
        >
          {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">Every card gets the same buttons — WhatsApp&apos;s rule. Each button gets its own branch.</p>
      </div>

      {cards.map((c, i) => {
        const isOpen = open === i;
        const breaks = ((c.body || "").match(/\n/g) || []).length;
        return (
          <div key={c.id ?? i} className="border border-gray-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="w-full flex items-center gap-2 px-2.5 py-2 bg-gray-50/70 text-left">
              <span className="w-9 h-9 rounded-md overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                {c.mediaUrl && c.mediaType !== "VIDEO" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : c.mediaUrl ? <Video className="w-4 h-4 text-gray-400" /> : <ImageIcon className="w-4 h-4 text-gray-300" />}
              </span>
              <span className="flex-1 min-w-0 text-[12px] font-semibold text-gray-700 truncate">{i + 1}. {flowCardLabel(c, i)}</span>
              {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {isOpen && (
              <div className="p-2.5 space-y-2.5 border-t border-gray-100">
                <MediaField
                  mediaType={c.mediaType === "VIDEO" ? "VIDEO" : "IMAGE"}
                  value={c.mediaUrl || null}
                  onChange={(url) => update(i, { mediaUrl: url ?? "" })}
                />

                <div>
                  <FormatTextarea
                    rows={3}
                    value={c.body || ""}
                    onChange={(body) => update(i, { body })}
                    placeholder={"*Ulthera Skin Tightening*\n~3,500 AED~ *From 2,911 AED*"}
                    className={`${inputCls} resize-none font-normal`}
                  />
                  <div className="flex justify-between text-[11px] mt-0.5">
                    <span className={breaks > CARD_LIMITS.lineBreaks ? "text-red-500" : "text-gray-400"}>
                      {breaks}/{CARD_LIMITS.lineBreaks} line breaks · *bold* ~strike~
                    </span>
                    <span className={(c.body || "").length > CARD_LIMITS.body ? "text-red-500 font-semibold" : "text-gray-400"}>
                      {(c.body || "").length}/{CARD_LIMITS.body}
                    </span>
                  </div>
                </div>

                {c.buttons.map((b, j) => (
                  <div key={b.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-500 w-16 shrink-0">{b.type === "URL" ? "🔗 Link" : `Button ${j + 1}`}</span>
                      <input value={b.title} maxLength={CARD_LIMITS.button} onChange={(e) => setButtonTitle(i, j, e.target.value)} className={inputCls} />
                    </div>
                    {b.type === "URL" && (
                      <input value={b.url || ""} onChange={(e) => setButtonUrl(i, e.target.value)} placeholder="https://everlastwellness.store/…" className={`${inputCls} font-mono`} />
                    )}
                  </div>
                ))}

                <div className="flex items-center gap-1 pt-1">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-[12px] text-gray-500 px-2 py-1 rounded-md hover:bg-gray-50 disabled:opacity-30">↑ Move up</button>
                  <button type="button" disabled={i === cards.length - 1} onClick={() => move(i, 1)} className="text-[12px] text-gray-500 px-2 py-1 rounded-md hover:bg-gray-50 disabled:opacity-30">↓ Move down</button>
                  <button
                    type="button"
                    disabled={cards.length <= CARD_LIMITS.min}
                    onClick={() => {
                      const key = keyOf(c, i);
                      onChange((prev) => prev.filter((x, k) => keyOf(x, k) !== key));
                      setOpen(null);
                    }}
                    className="ml-auto flex items-center gap-1 text-[12px] text-gray-400 hover:text-red-500 px-2 py-1 rounded-md disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove card
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {cards.length < CARD_LIMITS.max && (
        <button
          type="button"
          onClick={() => {
            onChange((prev) => [...prev, withLayout(newFlowCard(2), layoutOf(prev), prev[0])]);
            setOpen(cards.length);
          }}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-fg hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add card ({cards.length}/{CARD_LIMITS.max})
        </button>
      )}
    </div>
  );
}
