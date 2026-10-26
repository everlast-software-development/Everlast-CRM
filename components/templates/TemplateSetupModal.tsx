"use client";

import { useState } from "react";
import { X, Wand2, Image as ImageIcon, Video, FileText, AlertCircle } from "lucide-react";
import { apiMapTemplateVariables, apiSetTemplateMedia } from "@/lib/api";
import MediaPicker from "@/components/MediaPicker";
import { WaText } from "./shared";
import type { MediaAsset, Template } from "@/types";

// Set-up for a template imported from Meta, which the CRM can't send yet:
//  - Variables: Meta's {{1}}, {{2}} say nothing about what they hold. For each
//    the admin picks what the CRM fills in. Only the CRM's copy changes; the
//    template approved at Meta stays as it is (no resubmission).
//  - Media: Meta's sample header/card file expires, so a file of our own is
//    chosen from the Media Library (or uploaded there on the spot).
// The rules mirror the API (utils/templateImport.js applyVariableMapping).

const VAR_OPTIONS: { key: string; label: string; sample: string }[] = [
  { key: "first_name", label: "First name", sample: "Sarah" },
  { key: "customer_name", label: "Full name", sample: "Sarah Ahmed" },
  { key: "agent_name", label: "Agent name", sample: "Alex" },
];
const SAMPLE = Object.fromEntries(VAR_OPTIONS.map((o) => [o.key, o.sample]));

const POSITIONAL_RE = /\{\{\s*(\d+)\s*\}\}/g;
const positions = (text: string | null | undefined) => {
  const seen: number[] = [];
  for (const m of String(text ?? "").matchAll(POSITIONAL_RE)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
};
const fill = (text: string, map: Record<string, string>) =>
  text.replace(POSITIONAL_RE, (full, n) => (map[n] ? SAMPLE[map[n]] : full));

type MediaKind = "IMAGE" | "VIDEO" | "DOCUMENT";
// Meta's sample-file hosts (same rule as the API's isMetaSampleUrl).
const isMetaSample = (url: string) => /^https?:\/\/[^/?#]*(whatsapp\.net|fbcdn\.net|fbsbx\.com)(?:[/?#:]|$)/i.test(url);
const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText };

export default function TemplateSetupModal({
  template,
  onClose,
  onSaved,
}: {
  template: Template;
  onClose: () => void;
  onSaved: () => void;
}) {
  const needs = template.needsSetup ?? [];
  const headerText = template.headerType === "TEXT" ? template.header ?? "" : "";
  const bodyVars = positions(template.body);
  const headerVars = positions(headerText);
  const needsVariables = needs.includes("variables") && bodyVars.length + headerVars.length > 0;

  const headerMediaKind = (["IMAGE", "VIDEO", "DOCUMENT"] as const).find((k) => k === template.headerType) as MediaKind | undefined;
  const cards = template.cards ?? [];
  const needsMedia = needs.includes("media");

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [headerMapping, setHeaderMapping] = useState<Record<string, string>>({});
  const [headerMedia, setHeaderMedia] = useState("");
  const [cardMedia, setCardMedia] = useState<string[]>(() => cards.map(() => ""));
  // Which media slot the picker is choosing for: "header" or a card index.
  const [picking, setPicking] = useState<"header" | number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same checks the server makes, so the button only lights up when it'll work.
  const bodyNames = bodyVars.map((n) => mapping[String(n)]).filter(Boolean);
  const duplicate = bodyNames.find((n, i) => bodyNames.indexOf(n) !== i);
  const outOfOrder = bodyVars.some((n, i) => n !== i + 1);
  const variablesDone =
    !needsVariables ||
    (bodyVars.every((n) => mapping[String(n)]) && headerVars.every((n) => headerMapping[String(n)]) && !duplicate && !outOfOrder);
  // A card that already has a file of its own may stay as it is.
  const mediaDone =
    !needsMedia ||
    ((headerMediaKind ? !!headerMedia : true) &&
      cards.every((c, i) => !!cardMedia[i] || (/^https?:\/\//i.test(c.mediaUrl) && !isMetaSample(c.mediaUrl))));
  const canSave = variablesDone && mediaDone && !saving && (needsVariables || needsMedia);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (needsVariables) {
        await apiMapTemplateVariables(template.id, mapping, headerVars.length ? headerMapping : undefined);
      }
      if (needsMedia) {
        await apiSetTemplateMedia(template.id, {
          ...(headerMediaKind ? { headerMediaUrl: headerMedia } : {}),
          ...(cards.length ? { cards: cardMedia.map((mediaUrl) => ({ mediaUrl })) } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function onPicked(asset: MediaAsset) {
    if (picking === "header") setHeaderMedia(asset.url);
    else if (typeof picking === "number") setCardMedia((prev) => prev.map((u, i) => (i === picking ? asset.url : u)));
    setPicking(null);
  }

  const pickerType: MediaKind | null =
    picking === "header" ? headerMediaKind ?? null : typeof picking === "number" ? cards[picking]?.mediaType ?? null : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Wand2 className="w-5 h-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-bold text-gray-900 truncate">Set up “{template.name}”</h2>
              <p className="text-[12px] text-gray-400 mt-0.5">
                Imported from Meta — finish these before it can be sent. Meta&apos;s approved template doesn&apos;t change.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 cursor-pointer shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {needsVariables && (
            <section>
              <h3 className="text-[13px] font-semibold text-gray-800">Set up variables</h3>
              <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
                Choose what the CRM fills in for each one. Each number in the message needs a different choice.
              </p>
              {outOfOrder && (
                <p className="text-[12px] text-red-600 mb-2">
                  The message&apos;s variables don&apos;t appear in order ({"{{1}}"}, {"{{2}}"}, …), so the CRM can&apos;t send it. Recreate it in Meta or in the CRM.
                </p>
              )}
              <div className="space-y-2">
                {headerVars.map((n) => (
                  <VarRow key={`h${n}`} label={`Header {{${n}}}`} value={headerMapping[String(n)] ?? ""} onChange={(v) => setHeaderMapping((m) => ({ ...m, [String(n)]: v }))} />
                ))}
                {bodyVars.map((n) => (
                  <VarRow
                    key={`b${n}`}
                    label={`Message {{${n}}}`}
                    value={mapping[String(n)] ?? ""}
                    onChange={(v) => setMapping((m) => ({ ...m, [String(n)]: v }))}
                    invalid={!!duplicate && mapping[String(n)] === duplicate}
                  />
                ))}
              </div>
              {duplicate && (
                <p className="text-[11.5px] text-red-600 mt-1.5">
                  “{VAR_OPTIONS.find((o) => o.key === duplicate)?.label}” is chosen twice — WhatsApp expects one value per number.
                </p>
              )}

              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-1.5">Preview</p>
              <div className="bg-brand rounded-2xl rounded-br-sm px-3.5 py-3">
                {headerText && <p className="text-[13px] font-bold text-white mb-1.5">{fill(headerText, headerMapping)}</p>}
                <p className="text-[13px] text-white leading-relaxed whitespace-pre-wrap">
                  <WaText text={fill(template.body, mapping)} />
                </p>
              </div>
            </section>
          )}

          {needsMedia && (
            <section>
              <h3 className="text-[13px] font-semibold text-gray-800">Choose media</h3>
              <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
                Meta only shared its sample file, and those links expire. Pick the file to send with every message.
              </p>
              <div className="space-y-2">
                {headerMediaKind && (
                  <MediaRow kind={headerMediaKind} label="Header" url={headerMedia} onPick={() => setPicking("header")} />
                )}
                {cards.map((c, i) => (
                  <MediaRow key={i} kind={c.mediaType} label={`Card ${i + 1}`} url={cardMedia[i]} onPick={() => setPicking(i)} />
                ))}
              </div>
            </section>
          )}

          {!needsVariables && !needsMedia && (
            <p className="text-[13px] text-gray-500">This template is ready to send.</p>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-60 text-[14px] font-semibold text-white cursor-pointer transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {pickerType && (
        <MediaPicker mediaType={pickerType} onCancel={() => setPicking(null)} onSelect={onPicked} />
      )}
    </div>
  );
}

function VarRow({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-[12.5px] font-mono text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`flex-1 border rounded-xl px-3 py-2 text-[13px] text-gray-800 bg-white outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 cursor-pointer ${
          invalid ? "border-red-300" : "border-gray-200"
        }`}
      >
        <option value="">Choose…</option>
        {VAR_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label} (e.g. {o.sample})
          </option>
        ))}
      </select>
    </label>
  );
}

function MediaRow({ kind, label, url, onPick }: { kind: MediaKind; label: string; url: string; onPick: () => void }) {
  const Icon = MEDIA_ICON[kind];
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200">
      <div className="w-11 h-11 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 shrink-0 flex items-center justify-center">
        {url && kind === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-4 h-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium text-gray-700">{label}</p>
        <p className="text-[11.5px] text-gray-400 truncate">{url ? url.split("/").pop() : `No ${kind.toLowerCase()} chosen yet`}</p>
      </div>
      <button
        type="button"
        onClick={onPick}
        className="shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-brand-fg border border-brand/30 bg-brand-100 px-3 py-1.5 rounded-xl hover:bg-brand-200 transition-colors cursor-pointer"
      >
        {url ? "Change" : "Choose"}
      </button>
    </div>
  );
}
