"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api";

// Bits every Settings tab shares, so the five panels look like one page.

// ---------------------------------------------------------------------------
// Input / label styles (same as the original Team page forms)
// ---------------------------------------------------------------------------

export const inputCls =
  "w-full text-[14px] text-gray-800 border border-gray-200 rounded-xl px-4 py-3 outline-none placeholder:text-gray-400 bg-white focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors";

export const labelCls = "block text-[13px] font-medium text-gray-700 mb-1.5";

export const primaryBtnCls =
  "inline-flex items-center justify-center gap-2 bg-brand hover:bg-[#2f5840] active:bg-[#264a33] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl transition-colors cursor-pointer";

export const secondaryBtnCls =
  "inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

// The server's messages are written for people ("This is the default number.
// Make another number the default…"), so they are shown as-is.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

// ---------------------------------------------------------------------------
// Section card — one titled block of settings
// ---------------------------------------------------------------------------

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-[14px] font-bold text-gray-900">{title}</p>
        {description && <p className="text-[12px] text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On/off switch
// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-brand" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Drawer shell (slides from right) — moved here from the Team page so the
// WhatsApp numbers tab can use the same one.
// ---------------------------------------------------------------------------

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function DrawerShell({ open, onClose, title, children }: DrawerShellProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-[100] transition-opacity duration-300 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Panel — slides from right on sm+ */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
          <h2 className="text-[17px] font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Load-failed card with a retry, for a tab whose data didn't arrive
// ---------------------------------------------------------------------------

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-white border border-red-200 rounded-2xl p-6 text-center">
      <p className="text-[14px] font-semibold text-gray-800 mb-1">Couldn&apos;t load this section</p>
      <p className="text-[13px] text-gray-500">{message}</p>
      <button type="button" onClick={onRetry} className={`${secondaryBtnCls} mt-4`}>
        Try again
      </button>
    </div>
  );
}
