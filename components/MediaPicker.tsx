"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, FileText, Music, Video as VideoIcon, Upload, Link2 } from "lucide-react";
import { apiGetMediaLibrary, apiImportMediaFromUrl, apiUploadToMediaLibrary } from "@/lib/api";
import type { MediaAsset, MediaAssetType } from "@/types";

export const ACCEPT_BY_TYPE: Record<MediaAssetType, string> = {
  IMAGE: "image/jpeg,image/png,image/gif,image/webp",
  VIDEO: "video/mp4,video/3gpp",
  AUDIO: "audio/aac,audio/mpeg,audio/ogg,audio/opus,audio/amr",
  DOCUMENT: "application/pdf,.doc,.docx,.xls,.xlsx",
};

// Does a dropped/pasted file fit the kind being picked? (The server checks
// the real list; this only stops an obvious mismatch early.)
export function fileFitsType(file: File, mediaType: MediaAssetType): boolean {
  if (mediaType === "IMAGE") return file.type.startsWith("image/");
  if (mediaType === "VIDEO") return file.type.startsWith("video/");
  if (mediaType === "AUDIO") return file.type.startsWith("audio/");
  return !file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/");
}

// The first file in a paste or drop, if any.
export function fileFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  if (data.files?.length) return data.files[0];
  for (const item of Array.from(data.items || [])) {
    if (item.kind === "file") return item.getAsFile();
  }
  return null;
}

function AssetThumb({ asset }: { asset: MediaAsset }) {
  if (asset.mediaType === "IMAGE") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={asset.url} alt={asset.filename ?? ""} className="w-full h-full object-cover" />
    );
  }
  const Icon = asset.mediaType === "VIDEO" ? VideoIcon : asset.mediaType === "AUDIO" ? Music : FileText;
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-50">
      <Icon className="w-6 h-6 text-gray-300" />
      <span className="text-[9px] font-semibold text-gray-400 uppercase">{asset.format}</span>
    </div>
  );
}

// Reusable "pick from Media Library" modal, scoped to one media type — used by
// template headers, flow messages and cards, and campaigns. A file can come
// from anywhere: uploaded, dropped or pasted (Ctrl+V a copied image), or
// imported from a link on another site. Every one of them is saved to the
// Media Library, so it shows up there and can be reused.
export default function MediaPicker({
  mediaType,
  onCancel,
  onSelect,
}: {
  mediaType: MediaAssetType;
  onCancel: () => void;
  onSelect: (asset: MediaAsset) => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "upload" | "link">(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = mediaType.toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetMediaLibrary(mediaType);
      setAssets(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media library");
    } finally {
      setLoading(false);
    }
  }, [mediaType]);

  useEffect(() => { load(); }, [load]);

  const handleFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!fileFitsType(file, mediaType)) {
      setError(`That's not ${mediaType === "IMAGE" ? "an image" : `a ${kind}`} — choose a ${kind} file.`);
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const res = await apiUploadToMediaLibrary(file, file.name && file.name !== "image.png" ? file.name : `Pasted ${kind} ${new Date().toLocaleString()}`);
      onSelect(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }, [mediaType, kind, onSelect]);

  const importLink = useCallback(async (url: string) => {
    const clean = url.trim();
    if (!clean) return;
    setBusy("link");
    setError(null);
    try {
      const res = await apiImportMediaFromUrl(clean);
      if (res.data.mediaType !== mediaType) {
        setError(`That link is ${res.data.mediaType === "IMAGE" ? "an image" : `a ${res.data.mediaType.toLowerCase()}`}, not ${mediaType === "IMAGE" ? "an image" : `a ${kind}`}. It was saved to the library anyway.`);
        return;
      }
      onSelect(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that link");
    } finally {
      setBusy(null);
    }
  }, [mediaType, kind, onSelect]);

  // Ctrl+V anywhere while the picker is open: a copied image uploads, a copied
  // link imports. Caught first (capture) and kept from the page behind — the
  // flow builder would otherwise read the paste as steps.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) { e.stopPropagation(); return; }
      const file = fileFrom(e.clipboardData);
      if (file) {
        e.preventDefault();
        e.stopPropagation();
        handleFile(file);
        return;
      }
      const text = e.clipboardData?.getData("text")?.trim() || "";
      const target = e.target as HTMLElement | null;
      if (/^https?:\/\/\S+$/i.test(text) && target?.tagName !== "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        setLink(text);
        importLink(text);
      }
    }
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [busy, handleFile, importLink]);

  const spinner = (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
      <div
        className={`bg-white rounded-2xl shadow-2xl w-[560px] max-w-full max-h-[80vh] flex flex-col ${dragging ? "ring-4 ring-brand/40" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = fileFrom(e.dataTransfer);
          if (file) { handleFile(file); return; }
          // An image dragged from another browser tab arrives as its link.
          const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
          if (/^https?:\/\//i.test(url.trim())) { setLink(url.trim()); importLink(url.trim()); }
        }}
      >
        <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-gray-900">Choose {kind}</h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="shrink-0 px-5 pt-4 space-y-2.5">
          <input ref={fileRef} type="file" accept={ACCEPT_BY_TYPE[mediaType]} className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="w-full flex flex-col items-center justify-center gap-0.5 py-3 rounded-xl border-2 border-dashed border-gray-200 hover:border-brand hover:bg-brand-100 disabled:opacity-60 disabled:cursor-wait transition-colors cursor-pointer text-gray-600 hover:text-brand-fg"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              {busy === "upload" ? spinner : <Upload className="w-4 h-4" />}
              {busy === "upload" ? "Uploading…" : "Upload from your computer"}
            </span>
            <span className="text-[11px] text-gray-400 font-normal">or drag a file here, or paste a copied {kind} (Ctrl+V)</span>
          </button>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => { e.preventDefault(); importLink(link); }}
          >
            <div className="relative flex-1 min-w-0">
              <Link2 className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={`Paste a link to ${mediaType === "IMAGE" ? "an image" : `a ${kind}`} on any website`}
                className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-2 text-[13px] text-gray-800 outline-none focus:border-brand"
              />
            </div>
            <button
              type="submit"
              disabled={!!busy || !link.trim()}
              className="shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg bg-brand text-white hover:bg-[#2f5540] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {busy === "link" && spinner}
              {busy === "link" ? "Importing…" : "Import"}
            </button>
          </form>
          <p className="text-[11px] text-gray-400">
            Everything you add is saved to the Media Library. Imported links are copied, so they keep working if the other site changes.
          </p>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-2.5">Media Library</p>
          {loading ? (
            <div className="flex justify-center py-10 text-brand-fg">{spinner}</div>
          ) : assets.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-10">
              No {kind}s in your library yet — add one above.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a)}
                  className="text-left border border-gray-200 rounded-xl overflow-hidden hover:border-brand transition-colors cursor-pointer"
                >
                  <div className="aspect-square bg-gray-50">
                    <AssetThumb asset={a} />
                  </div>
                  <p className="text-[11px] text-gray-600 truncate px-2 py-1.5">
                    {a.filename || a.publicId.split("/").pop()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
