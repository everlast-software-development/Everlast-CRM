"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, FileText, Pencil, Plus, RefreshCw, Send, ShoppingCart, Smartphone, Trash2, XCircle } from "lucide-react";
import {
  apiCreateStarterWebsiteTemplates, apiDeleteWebsiteTemplate, apiGetSettings, apiGetStoreMessages, apiGetStoreOverview, apiGetStoreSettings,
  apiSetWebsiteTemplateActive, apiSubmitWebsiteTemplate, apiTestSendWebsiteTemplate,
} from "@/lib/api";
import type {
  StoreConnection, StoreKind, StoreKindDef, StoreLanguage, StoreMessageRow, StoreMessageStatus, StoreOverviewCell, StoreVarDef, TemplateStatus, WebsiteTemplate,
} from "@/types";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { DialogButtons, DialogShell } from "@/components/DialogShell";
import { LoadError, SectionCard, Toggle, errorMessage, inputCls, labelCls, secondaryBtnCls } from "@/components/settings/shared";
import { StoreConnectionCard } from "./StoreConnectionCard";
import { WebsiteTemplateEditor } from "./WebsiteTemplateEditor";

// Templates → Website (admins): the connection with the online store, the
// WhatsApp template for each kind × language of message the store sends first,
// and everything the store sent — tests included.

const APPROVAL: Record<TemplateStatus, { label: string; tone: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", tone: "bg-gray-100 text-gray-600", icon: FileText },
  SUBMITTED: { label: "Waiting for WhatsApp", tone: "bg-amber-50 text-amber-700", icon: Clock },
  APPROVED: { label: "Approved", tone: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", tone: "bg-red-50 text-red-700", icon: XCircle },
  PAUSED: { label: "Paused by WhatsApp", tone: "bg-orange-50 text-orange-700", icon: Clock },
  DISABLED: { label: "Disabled by WhatsApp", tone: "bg-red-50 text-red-700", icon: XCircle },
};
const SENT: Record<StoreMessageStatus, { label: string; tone: string }> = {
  CAPTURED: { label: "Test · captured", tone: "bg-violet-50 text-violet-700" },
  SENDING: { label: "Sending", tone: "bg-amber-50 text-amber-700" },
  SENT: { label: "Sent", tone: "bg-emerald-50 text-emerald-700" },
  FAILED: { label: "Not sent", tone: "bg-red-50 text-red-700" },
  UNCONFIRMED: { label: "Unconfirmed", tone: "bg-orange-50 text-orange-700" },
};
const LANG: Record<StoreLanguage, string> = { en: "English", ar: "Arabic" };
const fmtTime = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Editing = { cell: StoreOverviewCell; template: WebsiteTemplate | null };

export function WebsiteTab() {
  const toast = useToast();
  const [conn, setConn] = useState<StoreConnection | null>(null);
  const [kinds, setKinds] = useState<Record<StoreKind, StoreKindDef> | null>(null);
  const [variables, setVariables] = useState<Record<string, StoreVarDef>>({});
  const [cells, setCells] = useState<StoreOverviewCell[]>([]);
  const [log, setLog] = useState<StoreMessageRow[]>([]);
  const [logFilter, setLogFilter] = useState<"" | "1" | "0">("");
  const [testPhones, setTestPhones] = useState<string[]>([]);
  const [refused, setRefused] = useState<{ at: string; status: number; error: string; messageId: string | null }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<WebsiteTemplate | null>(null);
  const [testing, setTesting] = useState<WebsiteTemplate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadLog = useCallback((filter: "" | "1" | "0") => apiGetStoreMessages({ test: filter || undefined }).then((r) => setLog(r.data)), []);
  const loadCells = useCallback(() => apiGetStoreOverview().then((r) => setCells(r.data)), []);
  const load = useCallback(() => {
    return Promise.all([
      apiGetStoreSettings().then((r) => { setConn(r.data); setKinds(r.kinds); setVariables(r.variables); setRefused(r.refused ?? []); }),
      loadCells(),
      loadLog(""),
      apiGetSettings().then((r) => setTestPhones(r.data.testPhones?.phones ?? [])).catch(() => {}),
    ])
      .then(() => setLoadError(null))
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load the website settings.")));
  }, [loadCells, loadLog]);
  useEffect(() => { load(); }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (!conn || !kinds) return <PageSpinner label="Loading" />;

  const readyCount = cells.filter((c) => c.ready).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <StoreConnectionCard conn={conn} onChange={setConn} />

      <SectionCard
        title="Messages the store sends"
        description={<>Each needs a WhatsApp template, in English and in Arabic, filled with the values the store sends. {readyCount} of {cells.length} can be sent now.</>}
      >
        <div className="flex flex-wrap justify-end gap-2 -mt-2 mb-3">
          {cells.some((c) => c.templates.length === 0) && (
            <button
              type="button"
              disabled={busy === "starter"}
              title="A draft for every message and language that has none yet, from the store's texts, with the link as a button. Read each one, then send it for approval."
              onClick={async () => {
                setBusy("starter");
                try {
                  const r = await apiCreateStarterWebsiteTemplates();
                  await loadCells();
                  const { created, failed } = r.data;
                  if (failed.length) toast.error(`${created.length} drafts made; ${failed.length} couldn't be: ${failed[0].template} — ${failed[0].error}`);
                  else toast.success(created.length ? `${created.length} drafts made. Read each one, then send it for approval.` : "Every message already has a template");
                } catch (err) {
                  toast.error(errorMessage(err, "Couldn't make the drafts."));
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-60 rounded-xl px-4 py-2 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> {busy === "starter" ? "Making drafts…" : "Create the drafts"}
            </button>
          )}
          <button type="button" onClick={() => act("refresh-cells", loadCells, "Up to date")} className={secondaryBtnCls}><RefreshCw className="w-3.5 h-3.5" /> Check again</button>
        </div>
        <div className="space-y-4">
          {(Object.keys(kinds) as StoreKind[]).map((k) => {
            const def = kinds[k];
            return (
              <div key={k} className="border border-gray-100 rounded-xl">
                <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 bg-gray-50/60 rounded-t-xl">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-gray-900">
                      {def.label} <span className="font-mono text-[11.5px] font-normal text-gray-400 ml-1">{k}</span>
                      <span className={`ml-2 text-[11px] font-semibold rounded-full px-2 py-0.5 ${def.category === "marketing" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-sky-50 text-sky-700"}`}>{def.category === "marketing" ? "Marketing" : "Service"}</span>
                    </p>
                    <p className="text-[12px] text-gray-500">{def.hint}</p>
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {(["en", "ar"] as const).map((lang) => {
                    const cell = cells.find((c) => c.kind === k && c.language === lang);
                    if (!cell) return null;
                    return (
                      <div key={lang} className="px-4 py-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold text-gray-800 flex items-center gap-2">
                            {LANG[lang]}
                            {cell.ready ? (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5"><AlertTriangle className="w-3.5 h-3.5" /> {cell.why ? cell.why.charAt(0).toUpperCase() + cell.why.slice(1) : "Not ready"}</span>
                            )}
                            {(cell.last30Days.SENT || cell.last30Days.FAILED) ? (
                              <span className="text-[11.5px] font-normal text-gray-400">last 30 days: {cell.last30Days.SENT ?? 0} sent{cell.last30Days.FAILED ? `, ${cell.last30Days.FAILED} not sent` : ""}</span>
                            ) : null}
                          </p>
                          <button type="button" onClick={() => setEditing({ cell, template: null })} className={secondaryBtnCls}>
                            <Plus className="w-3.5 h-3.5" /> New template
                          </button>
                        </div>
                        {cell.storeText ? (
                          <p className="text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 whitespace-pre-wrap break-words" dir="auto">
                            <span className="text-gray-400">The store&apos;s text{cell.lastSeenAt ? ` (${fmtTime(cell.lastSeenAt)})` : ""}: </span>{cell.storeText}
                          </p>
                        ) : (
                          <p className="text-[12px] text-gray-400">The store hasn&apos;t sent this one yet. A test from the store&apos;s page fills this in.</p>
                        )}
                        {cell.templates.map((t) => (
                          <TemplateRow
                            key={t.id}
                            t={t}
                            busy={busy}
                            onToggle={(v) => act(`on-${t.id}`, () => apiSetWebsiteTemplateActive(t.id, v).then(loadCells), v ? "Switched on" : "Switched off")}
                            onSubmit={() => act(`sub-${t.id}`, () => apiSubmitWebsiteTemplate(t.id).then(loadCells), "Sent to WhatsApp for approval")}
                            onEdit={() => setEditing({ cell, template: t })}
                            onTest={() => setTesting(t)}
                            onDelete={() => setDeleting(t)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="What the store sent" description="Every message, as received, and what came of it. Tests from the store's page are kept here and sent only to staff test phones.">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {([["", "All"], ["0", "Real"], ["1", "Tests"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => { setLogFilter(v); loadLog(v); }}
              className={`px-3 py-1 rounded-full text-[12.5px] border font-medium cursor-pointer ${logFilter === v ? "bg-brand-200 border-brand text-brand-fg" : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50"}`}>
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => act("refresh", () => Promise.all([loadLog(logFilter), loadCells(), apiGetStoreSettings().then((r) => setRefused(r.refused ?? []))]), "Up to date")}
            className={`${secondaryBtnCls} ml-auto`}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {refused.length > 0 && (
          <div className="mb-3 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
            <p className="text-[12.5px] font-semibold text-red-700 mb-1">Turned away recently (not kept)</p>
            <ul className="space-y-0.5">
              {refused.slice(0, 5).map((r, i) => (
                <li key={i} className="text-[12px] text-red-700">
                  <span className="tabular-nums text-red-500">{fmtTime(r.at)}</span> · {r.status} · {r.error}
                  {r.messageId ? ` (message ${r.messageId})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {log.length === 0 ? (
          <div className="py-8 text-center">
            <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-[13px] text-gray-500">Nothing yet. Ask staff to send a test from the store&apos;s WhatsApp messages page.</p>
          </div>
        ) : (
          <ul className="space-y-2">{log.map((m) => <MessageRow key={m.id} m={m} kinds={kinds} />)}</ul>
        )}
      </SectionCard>

      {editing && (
        <WebsiteTemplateEditor
          kind={editing.cell.kind}
          language={editing.cell.language}
          def={kinds[editing.cell.kind]}
          variables={variables}
          linkBase={conn.linkBase}
          template={editing.template}
          storeText={editing.cell.storeText}
          storeCategory={editing.cell.storeCategory}
          lastValues={editing.cell.lastValues}
          onCancel={() => setEditing(null)}
          onSaved={(_t, msg) => { setEditing(null); toast.success(msg); loadCells(); }}
        />
      )}
      {deleting && <ConfirmDelete t={deleting} onCancel={() => setDeleting(null)} onDone={() => { setDeleting(null); loadCells(); toast.success("Deleted"); }} />}
      {testing && <TestSendDialog t={testing} phones={testPhones} onClose={() => setTesting(null)} />}
    </div>
  );
}

function TemplateRow({ t, busy, onToggle, onSubmit, onEdit, onTest, onDelete }: {
  t: WebsiteTemplate; busy: string | null; onToggle: (v: boolean) => void; onSubmit: () => void; onEdit: () => void; onTest: () => void; onDelete: () => void;
}) {
  const st = APPROVAL[t.approvalStatus] ?? APPROVAL.DRAFT;
  const Icon = st.icon;
  const editable = t.approvalStatus === "DRAFT" || t.approvalStatus === "REJECTED";
  return (
    <div className="border border-gray-100 rounded-lg px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold text-gray-900 truncate" dir="auto">{t.name}</span>
          <span className={`inline-flex items-center gap-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 ${st.tone}`}><Icon className="w-3.5 h-3.5" /> {st.label}</span>

        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Toggle checked={t.websiteConfig.active} onChange={onToggle} disabled={busy === `on-${t.id}`} label={`${t.name} on`} />
          {editable && (
            <>
              <button type="button" onClick={onSubmit} disabled={busy === `sub-${t.id}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-60 rounded-lg px-3 py-1.5 cursor-pointer ml-1">
                <Send className="w-3.5 h-3.5" /> {t.approvalStatus === "REJECTED" ? "Send again" : "Send for approval"}
              </button>
              <button type="button" onClick={onEdit} aria-label={`Edit ${t.name}`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 cursor-pointer"><Pencil className="w-4 h-4" /></button>
            </>
          )}
          {t.approvalStatus === "APPROVED" && <button type="button" onClick={onTest} className={secondaryBtnCls}><Smartphone className="w-3.5 h-3.5" /> Test to my phone</button>}
          <button type="button" onClick={onDelete} aria-label={`Delete ${t.name}`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <p className="mt-1.5 text-[12.5px] text-gray-600 whitespace-pre-wrap break-words line-clamp-3" dir="auto">{t.body}</p>
      {t.approvalStatus === "REJECTED" && t.rejectionReason && <p className="mt-1 text-[12px] text-red-700">WhatsApp&apos;s reason: {t.rejectionReason}</p>}
    </div>
  );
}

function MessageRow({ m, kinds }: { m: StoreMessageRow; kinds: Record<StoreKind, StoreKindDef> }) {
  const [open, setOpen] = useState(false);
  const delivered = m.delivery === "delivered" ? "Delivered" : m.delivery === "failed" ? "Delivery failed" : null;
  return (
    <li className="border border-gray-100 rounded-xl">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left cursor-pointer">
        <span className="text-[12px] text-gray-400 tabular-nums w-[110px] shrink-0">{fmtTime(m.receivedAt)}</span>
        <span className="text-[13px] font-semibold text-gray-800">{kinds[m.kind]?.label ?? m.kind}</span>
        <span className="text-[12px] text-gray-400">{LANG[m.language]}</span>
        <span className="text-[12px] text-gray-500" dir="ltr">+{m.phone}</span>
        {m.storeId && <span className="text-[12px] text-gray-400">#{m.storeId}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${m.test && m.status === "SENT" ? "bg-violet-50 text-violet-700" : SENT[m.status].tone}`}>{m.test && m.status === "SENT" ? "Test · sent" : SENT[m.status].label}</span>
          {delivered && <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${m.delivery === "delivered" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{delivered}</span>}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 border-t border-gray-100 space-y-2.5 pt-3 text-[12.5px]">
          {m.reason && <p className="text-gray-700">{m.reason}</p>}
          <p className="text-gray-500">
            {m.template ? <>Template: <span className="font-medium text-gray-700" dir="auto">{m.template.name}</span>. </> : null}
            {m.attempts > 1 ? `Tried ${m.attempts} times. ` : ""}
            {m.delivery ? `${delivered}${m.costAed && Number(m.costAed) > 0 ? `, cost ${Number(m.costAed).toFixed(2)} AED` : ""}. ` : ""}
            {m.delivery && !m.test ? (m.reportedAt ? `Reported to the store ${fmtTime(m.reportedAt)}.` : m.reportError ? `Not reported to the store yet: ${m.reportError}` : "Reporting to the store…") : ""}
            {m.conversationId && <> <Link href={`/chats/${m.conversationId}`} className="text-brand-fg underline">Open chat</Link></>}
          </p>
          <p className="bg-[#EFEAE2] rounded-lg px-3 py-2 text-gray-800 whitespace-pre-wrap break-words" dir="auto">{m.text}</p>
          <details>
            <summary className="text-[12px] text-gray-500 cursor-pointer">What the store sent</summary>
            <pre className="mt-2 text-[11.5px] bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto max-h-[300px]" dir="ltr">{JSON.stringify(m.payload, null, 2)}</pre>
          </details>
        </div>
      )}
    </li>
  );
}

function ConfirmDelete({ t, onCancel, onDone }: { t: WebsiteTemplate; onCancel: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogShell
      title="Delete this website template?"
      intro={<>The store&apos;s messages stop going out with <b dir="auto">{t.name}</b>.{t.metaTemplateName ? " It's removed from WhatsApp too, and its name can't be reused for 30 days." : ""}</>}
      onCancel={onCancel}
      saving={saving}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await apiDeleteWebsiteTemplate(t.id);
            onDone();
          } catch (err) {
            setError(errorMessage(err, "Couldn't delete it."));
            setSaving(false);
          }
        }}
        className="px-6 pb-6 space-y-3"
      >
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onCancel} label="Delete" danger />
      </form>
    </DialogShell>
  );
}

function TestSendDialog({ t, phones, onClose }: { t: WebsiteTemplate; phones: string[]; onClose: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(phones[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogShell title={`Test “${t.name}” on a phone`} intro="Sends the real message to a staff phone, with the values from the store's latest message (or examples)." onCancel={onClose} saving={saving}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!phone) return;
          setSaving(true);
          setError(null);
          try {
            const r = await apiTestSendWebsiteTemplate(t.id, phone);
            toast.success(
              r.data.swappedLink
                ? "Sent. The store's link wasn't a store address (a test copy?), so an example link was used."
                : r.data.usedStoreValues ? "Sent, with the store's latest values" : "Sent, with example values",
            );
            onClose();
          } catch (err) {
            setError(errorMessage(err, "Couldn't send it."));
            setSaving(false);
          }
        }}
        className="px-6 pb-6 space-y-3"
      >
        {phones.length === 0 ? (
          <p className="text-[13px] text-gray-600">Add a staff test number first, in <Link href="/settings?tab=campaign-safety" className="text-brand-fg underline">Settings → Campaign safety</Link>.</p>
        ) : (
          <div>
            <label htmlFor="ws-phone" className={labelCls}>Staff phone</label>
            <select id="ws-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputCls} cursor-pointer`}>
              {phones.map((p) => <option key={p} value={p}>+{p}</option>)}
            </select>
          </div>
        )}
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onClose} label="Send test" />
      </form>
    </DialogShell>
  );
}
