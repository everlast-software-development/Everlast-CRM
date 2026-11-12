"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

export const inputCls = "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-brand bg-white";
export const inputErrCls = "w-full border border-red-300 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-red-400 bg-white";
export const labelCls = "block text-[12px] font-semibold text-gray-500 mb-1";

/** The app's modal: same look as the chat follow-up and campaign dialogs. */
export function DialogShell({ title, intro, onCancel, saving, width = "w-[420px]", children }: {
  title: string;
  intro?: ReactNode;
  onCancel: () => void;
  saving: boolean;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-2xl shadow-2xl ${width} max-w-full max-h-full flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 shrink-0">
          <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">{title}</h3>
          {intro && <p className="text-[13px] text-gray-500 mb-4">{intro}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogButtons({ saving, onCancel, label, danger = false, disabled = false }: {
  saving: boolean; onCancel: () => void; label: string; danger?: boolean; disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50">
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving || disabled}
        className={`px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 ${danger ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:bg-[#2f5840]"}`}
      >
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {label}
      </button>
    </div>
  );
}
