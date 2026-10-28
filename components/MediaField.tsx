"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, Images, Link2, RotateCcw, Upload, Video, X } from "lucide-react";
import MediaPicker, { fileFitsType, fileFrom } from "@/components/MediaPicker";
import { apiImportMediaFromUrl, apiUploadToMediaLibrary } from "@/lib/api";
import type { MediaAssetType } from "@/types";

/**
 * One media slot (a flow message's image, a campaign's header image…): shows
 * what's chosen and opens the picker, where the file can come from the Media
 * Library, an upload, a paste or a link on any website. A file can also be
 * dropped or pasted (click the slot, Ctrl+V) straight onto it. Whatever is
 * added lands in the Media Library.
 *
 * `fallbackUrl` is what's used when nothing is chosen (a campaign falls back to
 * its template's image); `onChange(null)` goes back to it.
 */
export default function MediaField({
  mediaType,
  value,
  onChange,
  fallbackUrl,
  fallbackLabel = "The template's",
}: {
  mediaType: Exclude<MediaAssetType, "AUDIO">;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  fallbackUrl?: string | null;
  fallbackLabel?: string;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // "Import from link": a link to a file on any website, copied into the library.
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const shown = value || fallbackUrl || "";
  const kind = mediaType.toLowerCase();
  const usingFallback = !value && !!fallbackUrl;

  async function upload(file: File | null) {
    if (!file) return;
    if (!fileFitsType(file, mediaType)) {
      setError(`That's not ${mediaType === "IMAGE" ? "an image" : `a ${kind}`}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiUploadToMediaLibrary(file, file.name && file.name !== "image.png" ? file.name : `Pasted ${kind} ${new Date().toLocaleString()}`);
      onChange(res.data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function importLink() {
    const url = link.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiImportMediaFromUrl(url);
      if (res.data.mediaType !== mediaType) {
        setError(`That link is ${res.data.mediaType === "IMAGE" ? "an image" : "a " + res.data.mediaType.toLowerCase()}, not ${mediaType === "IMAGE" ? "an image" : "a " + kind}.`);
        return;
      }
      onChange(res.data.url);
      setLink("");
      setLinkOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that link");
    } finally {
      setBusy(false);
    }
  }

  const fileName = shown ? decodeURIComponent(shown.split("?")[0].split("/").pop() || "") : "";
  const btn = "flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-60";

  return (
    <div>
      <div
        tabIndex={0}
        onPaste={(e) => {
          const file = fileFrom(e.clipboardData);
          if (!file) return;
          e.preventDefault();
          e.stopPropagation();
          void upload(file);
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(fileFrom(e.dataTransfer));
        }}
        className={`flex items-center gap-3 rounded-xl border p-2 outline-none focus:border-brand transition-colors ${
          dragging ? "border-brand bg-brand-100" : "border-gray-200"
        }`}
        title={`Drop or paste ${mediaType === "IMAGE" ? "an image" : `a ${kind}`} here`}
      >
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center cursor-pointer"
          aria-label={`Choose ${kind}`}
        >
          {shown && mediaType === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="w-full h-full object-cover" />
          ) : mediaType === "VIDEO" ? (
            <Video className={`w-5 h-5 ${shown ? "text-gray-500" : "text-gray-300"}`} />
          ) : mediaType === "DOCUMENT" ? (
            <FileText className={`w-5 h-5 ${shown ? "text-gray-500" : "text-gray-300"}`} />
          ) : (
            <ImageIcon className="w-5 h-5 text-gray-300" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-gray-600 truncate">
            {busy ? "Adding…" : shown ? (usingFallback ? `${fallbackLabel} ${kind}` : fileName || `Chosen ${kind}`) : `No ${kind} yet`}
          </p>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <button type="button" onClick={() => setPicking(true)} disabled={busy} className={`${btn} text-brand-fg border border-brand/30 bg-brand-100 hover:bg-brand-200`}>
              <Images className="w-3.5 h-3.5" /> {shown ? "Change" : `Add ${kind}`}
            </button>
            <button type="button" onClick={() => setLinkOpen((v) => !v)} disabled={busy} className={`${btn} text-gray-600 border border-gray-200 hover:bg-gray-50`}>
              <Link2 className="w-3.5 h-3.5" /> Import from link
            </button>
            {value && fallbackUrl && (
              <button type="button" onClick={() => onChange(null)} className={`${btn} text-gray-500 hover:bg-gray-50`}>
                <RotateCcw className="w-3.5 h-3.5" /> Use {fallbackLabel.toLowerCase()}
              </button>
            )}
            {value && !fallbackUrl && (
              <button type="button" onClick={() => onChange(null)} className={`${btn} text-gray-400 hover:text-red-500`}>
                <X className="w-3.5 h-3.5" /> Remove
              </button>
            )}
            {!shown && <span className="text-[11px] text-gray-400 flex items-center gap-1"><Upload className="w-3 h-3" /> or drop / paste here</span>}
          </div>
        </div>
      </div>
      {linkOpen && (
        <div className="flex gap-1.5 mt-1.5">
          <input
            type="url"
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void importLink(); }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder={`Link to ${mediaType === "IMAGE" ? "an image" : "a " + kind} on any website`}
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] text-gray-800 outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void importLink()}
            disabled={busy || !link.trim()}
            className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-[#2f5540] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {picking && (
        <MediaPicker
          mediaType={mediaType}
          onCancel={() => setPicking(false)}
          onSelect={(asset) => {
            onChange(asset.url);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
