"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Plug } from "lucide-react";
import { apiRotateStoreSecret, apiSaveStoreSettings } from "@/lib/api";
import type { StoreConnection } from "@/types";
import { useToast } from "@/components/ui/toast";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { DialogButtons, DialogShell } from "@/components/DialogShell";
import { SectionCard, Toggle, errorMessage, inputCls, labelCls, secondaryBtnCls } from "@/components/settings/shared";

// Both halves of the connection with the online store:
//   - what the store's staff enter on their side (Admin → Marketing → WhatsApp
//     messages): this webhook address and the signing secret;
//   - what the store gives us: its API address and an access key (Level 4), for
//     the delivery reports.

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 rounded-lg px-2.5 py-1.5 cursor-pointer shrink-0"
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
    <div className="flex-1 min-w-0 space-y-2">
      <p className="text-[13px] font-semibold text-gray-800">{title}</p>
      {children}
    </div>
  </div>
);

export function StoreConnectionCard({ conn, onChange }: { conn: StoreConnection; onChange: (c: StoreConnection) => void }) {
  const toast = useToast();
  const { numbers } = useActiveNumber();
  const [showSecret, setShowSecret] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [apiBase, setApiBase] = useState(conn.apiBase ?? "");
  const [apiKey, setApiKey] = useState("");
  const [linkBase, setLinkBase] = useState(conn.linkBase);
  const [saving, setSaving] = useState(false);

  async function save(value: Parameters<typeof apiSaveStoreSettings>[0], ok: string) {
    setSaving(true);
    try {
      const res = await apiSaveStoreSettings(value);
      onChange(res.data);
      setApiBase(res.data.apiBase ?? "");
      setLinkBase(res.data.linkBase);
      setApiKey("");
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save."));
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      const res = await apiRotateStoreSecret();
      onChange(res.data);
      setShowSecret(true);
      setConfirmRotate(false);
      toast.success(conn.secret ? "New secret made. Put it on the store's page: the old one no longer works." : "Secret made.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't make a secret."));
    } finally {
      setRotating(false);
    }
  }

  const masked = conn.secret ? `${conn.secret.slice(0, 6)}${"•".repeat(20)}${conn.secret.slice(-4)}` : "";
  const reportsReady = Boolean(conn.apiBase && conn.apiKeyHint);

  return (
    <SectionCard
      title="Store connection"
      description="The store decides who gets which message and when (consent, budget, limits, quiet hours). The CRM sends each one on WhatsApp and reports back how it went."
    >
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-semibold text-gray-700 flex items-center gap-2"><Plug className="w-4 h-4 text-gray-400" /> Take messages from the store</p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {conn.enabled ? "On: the store's messages are sent." : conn.secret ? "Off: the store's messages are refused, and the store tries again later." : "Make the signing secret first (step 1)."}
            </p>
          </div>
          <Toggle checked={conn.enabled} onChange={(v) => save({ enabled: v }, v ? "Switched on" : "Switched off")} disabled={saving || !conn.secret} label="Take messages from the store" />
        </div>

        <Step n={1} title="Give the store's staff these two (Admin → Marketing → WhatsApp messages)">
          <div>
            <p className={labelCls}>Webhook address</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-[12.5px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-700" dir="ltr">{conn.endpoint}</code>
              <CopyButton text={conn.endpoint} />
            </div>
          </div>
          <div>
            <p className={labelCls}>Signing secret</p>
            {conn.secret ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-[200px] truncate text-[12.5px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-700" dir="ltr">{showSecret ? conn.secret : masked}</code>
                <button type="button" onClick={() => setShowSecret((v) => !v)} className={secondaryBtnCls} aria-label={showSecret ? "Hide secret" : "Show secret"}>
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <CopyButton text={conn.secret} />
                <button type="button" onClick={() => setConfirmRotate(true)} className={secondaryBtnCls}><KeyRound className="w-3.5 h-3.5" /> Replace</button>
              </div>
            ) : (
              <button type="button" onClick={rotate} disabled={rotating} className={secondaryBtnCls}><KeyRound className="w-3.5 h-3.5" /> {rotating ? "Making…" : "Make the signing secret"}</button>
            )}
            <p className="text-[11.5px] text-gray-400 mt-1">The store signs every message with it; anything not signed with it is refused.</p>
          </div>
        </Step>

        <Step n={2} title="Enter what the store gives you, for the delivery reports">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="store-api" className={labelCls}>Store API address</label>
              <input id="store-api" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://everlastwellness.com" dir="ltr" className={inputCls} />
            </div>
            <div>
              <label htmlFor="store-key" className={labelCls}>Access key (Level 4)</label>
              <input id="store-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={conn.apiKeyHint ? `Saved: ${conn.apiKeyHint}` : "ak_…"} dir="ltr" autoComplete="off" className={inputCls} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(apiBase !== (conn.apiBase ?? "") || apiKey) && (
              <button type="button" onClick={() => save({ apiBase: apiBase || null, ...(apiKey ? { apiKey } : {}) }, "Saved")} disabled={saving} className={secondaryBtnCls}>Save</button>
            )}
            <span className={`text-[12px] ${reportsReady ? "text-emerald-700" : "text-amber-700"}`}>
              {reportsReady ? "Delivery reports go back to the store." : "Until both are in, the store isn't told what was delivered or what it cost."}
            </span>
          </div>
        </Step>

        <Step n={3} title="Where the messages go out">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="store-line" className={labelCls}>WhatsApp line</label>
              <select id="store-line" value={conn.numberId ?? ""} onChange={(e) => save({ numberId: e.target.value ? Number(e.target.value) : null }, "Line saved")} disabled={saving} className={`${inputCls} cursor-pointer`}>
                <option value="">Default line{conn.line && !conn.numberId ? ` (${conn.line.label})` : ""}</option>
                {numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <p className="text-[11.5px] text-gray-400 mt-1">Website templates are approved on this line&apos;s WhatsApp account.</p>
            </div>
            <div>
              <label htmlFor="store-base" className={labelCls}>Store links start with</label>
              <div className="flex gap-2">
                <input id="store-base" value={linkBase} onChange={(e) => setLinkBase(e.target.value)} dir="ltr" className={inputCls} />
                {linkBase !== conn.linkBase && <button type="button" onClick={() => save({ linkBase }, "Saved")} disabled={saving} className={secondaryBtnCls}>Save</button>}
              </div>
              <p className="text-[11.5px] text-gray-400 mt-1">For link buttons that open the store&apos;s {"{link}"}.</p>
            </div>
          </div>
        </Step>
      </div>

      {confirmRotate && (
        <DialogShell
          title="Replace the signing secret?"
          intro="The store's messages are refused until staff put the new secret on the store's page. The store tries each message again for 30 minutes."
          onCancel={() => setConfirmRotate(false)}
          saving={rotating}
        >
          <form onSubmit={(e) => { e.preventDefault(); rotate(); }} className="px-6 pb-6">
            <DialogButtons saving={rotating} onCancel={() => setConfirmRotate(false)} label="Replace secret" danger />
          </form>
        </DialogShell>
      )}
    </SectionCard>
  );
}
