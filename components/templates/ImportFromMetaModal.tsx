"use client";

import { useEffect, useState } from "react";
import { DownloadCloud, X, AlertCircle } from "lucide-react";
import { apiImportTemplates } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import type { TemplateImportResult, TemplateSetupNeed } from "@/types";

// "Import from Meta": brings templates made in WhatsApp Manager (or another
// tool) into the CRM. Always a dry run first, so the admin sees what will
// happen — new, already here, skipped and why — before anything is written.

export const SETUP_NEED_LABEL: Record<TemplateSetupNeed, string> = {
  variables: "choose what its variables mean",
  media: "choose a media file",
};

export default function ImportFromMetaModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<TemplateImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiImportTemplates(true)
      .then((res) => { if (!cancelled) setPreview(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't read templates from Meta"); });
    return () => { cancelled = true; };
  }, []);

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const res = await apiImportTemplates(false);
      const needSetup = res.imported.filter((t) => t.needsSetup.length > 0).length;
      toast.success(
        `Imported ${res.imported.length} template${res.imported.length === 1 ? "" : "s"}` +
          (res.updated ? ` · ${res.updated} refreshed` : "") +
          (res.skipped.length ? ` · ${res.skipped.length} skipped` : "") +
          (needSetup ? ` · ${needSetup} need setup before sending` : ""),
      );
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  const nothingToDo = !!preview && preview.imported.length === 0 && preview.updated === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <DownloadCloud className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-bold text-gray-900">Import from Meta</h2>
              <p className="text-[12px] text-gray-400 mt-0.5">
                Templates made in WhatsApp Manager for this line&apos;s WhatsApp account
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 cursor-pointer shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!preview && !error && (
            <div className="flex items-center justify-center py-10">
              <Spinner size="md" label="Reading templates from Meta" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-red-700">{error}</p>
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat value={preview.imported.length} label="new" tone="text-brand-fg" />
                <Stat value={preview.updated} label="already here" hint="status will refresh" tone="text-gray-700" />
                <Stat value={preview.skipped.length} label="skipped" tone="text-gray-500" />
              </div>
              {preview.truncated && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  This account has more than 1,000 templates — only the first 1,000 are read. Import again later for the rest.
                </p>
              )}

              {preview.imported.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">New</h3>
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                    {preview.imported.map((t) => (
                      <li key={`${t.metaTemplateName}:${t.language}`} className="px-3 py-2">
                        <p className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-medium text-gray-900 truncate">{t.name}</span>
                          <span className="text-[10px] text-gray-400 font-mono shrink-0">{t.language}</span>
                          <span className="ml-auto text-[10px] font-semibold text-gray-500 shrink-0">{t.status.toLowerCase()}</span>
                        </p>
                        {t.needsSetup.length > 0 && (
                          <p className="text-[11.5px] text-amber-700 mt-0.5">
                            Needs setup before sending: {t.needsSetup.map((n) => SETUP_NEED_LABEL[n]).join(" and ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {preview.skipped.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Skipped</h3>
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                    {preview.skipped.map((t, i) => (
                      <li key={`${t.name}:${t.language}:${i}`} className="px-3 py-2">
                        <p className="flex items-center gap-2 min-w-0">
                          <span className="text-[12.5px] font-mono text-gray-700 truncate">{t.name}</span>
                          <span className="text-[10px] text-gray-400 font-mono shrink-0">{t.language}</span>
                        </p>
                        <p className="text-[11.5px] text-gray-500 mt-0.5 leading-snug">Skipped: {t.reason}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {nothingToDo && (
                <p className="text-[13px] text-gray-500 text-center py-2">Nothing new to import.</p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            {nothingToDo ? "Close" : "Cancel"}
          </button>
          {!nothingToDo && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!preview || importing}
              className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-60 text-[14px] font-semibold text-white cursor-pointer transition-colors"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, hint, tone }: { value: number; label: string; hint?: string; tone: string }) {
  return (
    <div className="border border-gray-100 rounded-xl px-2 py-2.5">
      <p className={`text-[20px] font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11.5px] text-gray-500">{label}</p>
      {hint && <p className="text-[10.5px] text-gray-400">{hint}</p>}
    </div>
  );
}
