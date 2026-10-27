"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Plus, Trash2, Upload, Video, X } from "lucide-react";
import { apiUploadToMediaLibrary } from "@/lib/api";
import MediaPicker, { ACCEPT_BY_TYPE } from "@/components/MediaPicker";
import type { MediaAsset, TemplateCard, TemplateCardButton } from "@/types";

// Meta's media-card carousel rules, enforced again on the server:
// 2–10 cards; every card the same media type and the same buttons in the same
// order; card text ≤160; 1–2 buttons per card (Quick Reply and/or URL).
export const CAROUSEL_LIMITS = { minCards: 2, maxCards: 10, cardBody: 160, button: 25 };

export type CardLayout = "QR" | "QR_URL" | "URL";
const LAYOUTS: { value: CardLayout; label: string; hint: string }[] = [
  { value: "QR", label: "Quick reply", hint: "e.g. “Interested” — continues the flow" },
  { value: "QR_URL", label: "Quick reply + link", hint: "“Interested” and “Shop now”" },
  { value: "URL", label: "Link only", hint: "“Shop now” — opens your site" },
];
const LAYOUT_TYPES: Record<CardLayout, TemplateCardButton["type"][]> = {
  QR: ["QUICK_REPLY"],
  QR_URL: ["QUICK_REPLY", "URL"],
  URL: ["URL"],
};

export function layoutOf(cards: TemplateCard[]): CardLayout {
  const types = (cards[0]?.buttons || []).map((b) => b.type).join(",");
  return types === "QUICK_REPLY,URL" ? "QR_URL" : types === "URL" ? "URL" : "QR";
}

function buttonsFor(layout: CardLayout, prev: TemplateCardButton[] = []): TemplateCardButton[] {
  return LAYOUT_TYPES[layout].map((type, j) => {
    const old = prev.find((b) => b.type === type);
    return type === "URL"
      ? { id: `b${j}`, type, title: old?.title ?? "Shop now", url: old?.url ?? "" }
      : { id: `b${j}`, type, title: old?.title ?? "Interested" };
  });
}

export function newCard(layout: CardLayout, mediaType: TemplateCard["mediaType"]): TemplateCard {
  return { mediaType, mediaUrl: "", body: "", buttons: buttonsFor(layout) };
}

/** First problem with the cards, or null. Mirrors the server's validateCards. */
export function carouselError(cards: TemplateCard[]): string | null {
  if (cards.length < CAROUSEL_LIMITS.minCards) return `A carousel needs at least ${CAROUSEL_LIMITS.minCards} cards.`;
  for (const [i, c] of cards.entries()) {
    const n = i + 1;
    if (!c.mediaUrl) return `Card ${n} needs its ${c.mediaType === "VIDEO" ? "video" : "image"}.`;
    if (!c.body.trim()) return `Card ${n} needs some text.`;
    if (c.body.length > CAROUSEL_LIMITS.cardBody) return `Card ${n}'s text is over ${CAROUSEL_LIMITS.cardBody} characters.`;
    if (/\{\{/.test(c.body)) return `Card ${n}: placeholders aren't supported in card text.`;
    for (const b of c.buttons) {
      if (!b.title.trim()) return `Card ${n}: every button needs a title.`;
      if (b.title.length > CAROUSEL_LIMITS.button) return `Card ${n}: “${b.title}” is over ${CAROUSEL_LIMITS.button} characters.`;
      if (b.type === "URL" && !/^https?:\/\//i.test(b.url || "")) return `Card ${n}: “${b.title}” needs a link starting with https://`;
    }
  }
  return null;
}

const inputCls = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-800 outline-none focus:border-brand";

export function CarouselEditor({ cards, onChange }: { cards: TemplateCard[]; onChange: (cards: TemplateCard[]) => void }) {
  const layout = layoutOf(cards);
  const mediaType = cards[0]?.mediaType ?? "IMAGE";
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<number | null>(null);

  const update = (i: number, patch: Partial<TemplateCard>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updateButton = (i: number, j: number, patch: Partial<TemplateCardButton>) =>
    update(i, { buttons: cards[i].buttons.map((b, k) => (k === j ? { ...b, ...patch } : b)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...cards];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  // Layout and media type apply to every card — Meta requires identical shapes.
  const setLayout = (l: CardLayout) => onChange(cards.map((c) => ({ ...c, buttons: buttonsFor(l, c.buttons) })));
  const setMediaType = (t: TemplateCard["mediaType"]) =>
    onChange(cards.map((c) => ({ ...c, mediaType: t, mediaUrl: c.mediaType === t ? c.mediaUrl : "" })));

  async function upload(file: File | undefined) {
    const i = uploadTarget.current;
    if (!file || i === null) return;
    setUploadingFor(i);
    setUploadError(null);
    try {
      const res = await apiUploadToMediaLibrary(file, file.name);
      update(i, { mediaUrl: res.data.url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingFor(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Card media</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(["IMAGE", "VIDEO"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMediaType(t)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-[12px] font-medium cursor-pointer ${mediaType === t ? "border-brand bg-brand-100 text-brand-fg" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {t === "IMAGE" ? <ImageIcon className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                {t === "IMAGE" ? "Images" : "Videos"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Buttons on every card</label>
          <select value={layout} onChange={(e) => setLayout(e.target.value as CardLayout)} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] bg-white outline-none focus:border-brand">
            {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">{LAYOUTS.find((l) => l.value === layout)?.hint}</p>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((c, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-bold text-gray-700">Card {i + 1}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Move left" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" disabled={i === cards.length - 1} onClick={() => move(i, 1)} title="Move right" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
                <button type="button" disabled={cards.length <= CAROUSEL_LIMITS.minCards} onClick={() => onChange(cards.filter((_, j) => j !== i))} title="Remove card" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 border border-gray-100 shrink-0 flex items-center justify-center">
                {c.mediaUrl && c.mediaType === "IMAGE" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : c.mediaUrl ? <Video className="w-4 h-4 text-gray-400" /> : <ImageIcon className="w-4 h-4 text-gray-300" />}
              </div>
              <div className="flex-1 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setPickerFor(i)} className="flex items-center gap-1 text-[12px] font-semibold text-brand-fg border border-brand/30 bg-brand-100 px-2.5 py-1.5 rounded-lg hover:bg-brand-200 cursor-pointer">
                  <ImageIcon className="w-3.5 h-3.5" /> Library
                </button>
                <button
                  type="button"
                  disabled={uploadingFor !== null}
                  onClick={() => { uploadTarget.current = i; fileRef.current?.click(); }}
                  className="flex items-center gap-1 text-[12px] font-semibold text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-60 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> {uploadingFor === i ? "Uploading…" : "Upload"}
                </button>
                {c.mediaUrl && (
                  <button type="button" onClick={() => update(i, { mediaUrl: "" })} className="flex items-center gap-1 text-[12px] text-gray-400 hover:text-red-500 px-1.5 cursor-pointer">
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>

            <div>
              <textarea
                rows={2}
                value={c.body}
                maxLength={CAROUSEL_LIMITS.cardBody}
                onChange={(e) => update(i, { body: e.target.value })}
                placeholder="Laser hair removal — 30% off this week"
                className={`${inputCls} resize-none`}
              />
              <p className={`text-[11px] text-right ${c.body.length > CAROUSEL_LIMITS.cardBody ? "text-red-500" : "text-gray-400"}`}>{c.body.length}/{CAROUSEL_LIMITS.cardBody}</p>
            </div>

            {c.buttons.map((b, j) => (
              <div key={b.id} className="flex flex-col gap-1.5 sm:flex-row">
                <span className="text-[11px] font-semibold text-gray-500 sm:w-24 shrink-0 sm:pt-2">{b.type === "URL" ? "🔗 Link" : "↩ Quick reply"}</span>
                <input value={b.title} maxLength={CAROUSEL_LIMITS.button} onChange={(e) => updateButton(i, j, { title: e.target.value.replace(/[{}]/g, "") })} placeholder="Button text" className={inputCls} />
                {b.type === "URL" && (
                  <input value={b.url || ""} onChange={(e) => updateButton(i, j, { url: e.target.value })} placeholder="https://everlastwellness.store/…" className={`${inputCls} font-mono`} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {cards.length < CAROUSEL_LIMITS.maxCards && (
        <button
          type="button"
          onClick={() => onChange([...cards, newCard(layout, mediaType)])}
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-brand/30 bg-brand-100 text-brand-fg hover:bg-brand-200 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add card ({cards.length}/{CAROUSEL_LIMITS.maxCards})
        </button>
      )}

      {uploadError && <p className="text-[12px] text-red-600">{uploadError}</p>}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Images must be JPEG or PNG. Every card shares the same layout — Meta rejects carousels whose cards differ. Card text and images are fixed once approved; changing them means a new template.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_BY_TYPE[mediaType]}
        className="hidden"
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
      />
      {pickerFor !== null && (
        <MediaPicker
          mediaType={mediaType}
          onCancel={() => setPickerFor(null)}
          onSelect={(asset: MediaAsset) => { update(pickerFor, { mediaUrl: asset.url }); setPickerFor(null); }}
        />
      )}
    </div>
  );
}
