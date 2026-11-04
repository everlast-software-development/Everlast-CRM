"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, Pencil, Plus, RefreshCw, Send, ShieldAlert, Trash2, XCircle } from "lucide-react";
import {
  apiCreateUtilityTemplate,
  apiDeleteUtilityTemplate,
  apiGetUtilityTemplates,
  apiSubmitUtilityTemplate,
  apiUpdateUtilityTemplate,
} from "@/lib/api";
import { findMarketingWords } from "@/lib/marketingWords";
import type { Template, TemplateStatus } from "@/types";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { DialogButtons, DialogShell } from "@/components/DialogShell";
import { LoadError, SectionCard, errorMessage, inputCls, labelCls, primaryBtnCls, secondaryBtnCls } from "@/components/settings/shared";

// Patient-care WhatsApp templates ("Your appointment is on {{date}}…") for
// supervisors. The API (modules/templates/utilityTemplate.controller.js) keeps
// them strictly non-marketing; this page warns while typing so a refusal is
// never a surprise. Once WhatsApp approves one, agents send it from any chat —
// even after the 24-hour window — and fill in its blanks there.

const BODY_MAX = 800;

// The blanks, as the Insert buttons offer them. Keys match the API's
// utils/templateVars.js (first_name is filled automatically, the rest by the
// agent when sending).
const BLANKS = [
  { key: "first_name", label: "Patient's first name", sample: "Sara", auto: true },
  { key: "date", label: "Date", sample: "Monday 10 November" },
  { key: "time", label: "Time", sample: "4:30 PM" },
  { key: "doctor", label: "Doctor", sample: "Dr. Mona" },
  { key: "branch", label: "Branch", sample: "Jumeirah" },
  { key: "details", label: "Details", sample: "please arrive 10 minutes early" },
] as const;
const BLANK_BY_KEY: Record<string, (typeof BLANKS)[number]> = Object.fromEntries(BLANKS.map((b) => [b.key, b]));

// Starting points, so nobody has to write one from nothing.
const EXAMPLES: { name: string; body: string }[] = [
  { name: "Appointment reminder", body: "Hi {{first_name}}, this is a reminder of your appointment on {{date}} at {{time}} with {{doctor}}. Reply to this message if you need to change it." },
  { name: "Appointment confirmed", body: "Hi {{first_name}}, your appointment is confirmed for {{date}} at {{time}} at our {{branch}} branch. See you soon." },
  { name: "Appointment rescheduled", body: "Hi {{first_name}}, your appointment has been moved to {{date}} at {{time}}. Reply to this message if the new time doesn't suit you." },
  { name: "Missed appointment", body: "Hi {{first_name}}, we missed you at your appointment on {{date}}. Reply to this message and we'll find you a new time." },
  { name: "Results ready", body: "Hi {{first_name}}, your results are ready. {{details}}. Reply to this message if you have any questions." },
  { name: "Visit follow-up", body: "Hi {{first_name}}, thank you for visiting us on {{date}}. How are you feeling? Reply to this message if you need anything." },
  { name: "تذكير بالموعد", body: "مرحباً {{first_name}}، نذكّرك بموعدك يوم {{date}} الساعة {{time}} مع {{doctor}}. يمكنك الرد على هذه الرسالة إذا أردت تغيير الموعد." },
];

const STATUS: Record<TemplateStatus, { label: string; tone: string; icon: typeof Clock; hint: string }> = {
  DRAFT: { label: "Draft", tone: "bg-gray-100 text-gray-600", icon: FileText, hint: "Not sent to WhatsApp yet." },
  SUBMITTED: { label: "Waiting for WhatsApp", tone: "bg-amber-50 text-amber-700", icon: Clock, hint: "WhatsApp usually answers within minutes, at most 24 hours." },
  APPROVED: { label: "Ready to use", tone: "bg-emerald-50 text-emerald-700", icon: CheckCircle2, hint: "Agents can send it from any chat, even after the 24-hour window." },
  REJECTED: { label: "Rejected", tone: "bg-red-50 text-red-700", icon: XCircle, hint: "Change the wording and send it again." },
  PAUSED: { label: "Paused by WhatsApp", tone: "bg-orange-50 text-orange-700", icon: AlertTriangle, hint: "Patients reported or blocked it. WhatsApp paused it for now." },
  DISABLED: { label: "Disabled by WhatsApp", tone: "bg-red-50 text-red-700", icon: XCircle, hint: "WhatsApp stopped this message. Make a new one." },
};

const BLANK_RE = /(\{\{\s*[a-z_]+\s*\}\})/gi;
const keyOf = (token: string) => token.replace(/[{}\s]/g, "").toLowerCase();

// The message with each blank as a highlighted chip ([Date]) or its sample.
function MessageText({ text, samples = false }: { text: string; samples?: boolean }) {
  return (
    <>
      {text.split(BLANK_RE).map((part, i) => {
        if (i % 2 === 0) return part;
        const blank = BLANK_BY_KEY[keyOf(part)];
        if (!blank) return part;
        return samples ? (
          <span key={i} className="bg-sky-100/80 text-sky-800 rounded px-0.5">{blank.sample}</span>
        ) : (
          <span key={i} className="inline-block bg-sky-50 text-sky-700 border border-sky-100 rounded-md px-1 text-[0.92em] font-medium">{blank.label}</span>
        );
      })}
    </>
  );
}

// Problems that would stop saving, worded for the person writing.
function problemsOf(body: string): { words: string[]; edgeBlank: boolean; unknown: string[] } {
  const t = body.trim();
  const unknown = [...t.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]).filter((k) => !BLANK_BY_KEY[k.toLowerCase()]);
  return {
    words: findMarketingWords(t),
    edgeBlank: /^\{\{[^{}]+\}\}/.test(t) || /\{\{[^{}]+\}\}[.!?]?$/.test(t),
    unknown,
  };
}

export function CareTemplatesPanel() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // null = closed; { template: null } = new (optionally from an example).
  const [editing, setEditing] = useState<{ template: Template | null; example?: { name: string; body: string } } | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const load = useCallback(() => {
    return apiGetUtilityTemplates()
      .then((res) => { setTemplates(res.data); setLoadError(null); })
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load the messages.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  const upsert = (t: Template) =>
    setTemplates((list) => [t, ...(list ?? []).filter((x) => x.id !== t.id)]);

  async function submit(t: Template) {
    setSubmittingId(t.id);
    try {
      const res = await apiSubmitUtilityTemplate(t.id);
      upsert(res.data);
      toast.success("Sent to WhatsApp for approval");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't send it for approval."));
    } finally {
      setSubmittingId(null);
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (!templates) return <PageSpinner />;

  return (
    <SectionCard
      title="WhatsApp templates"
      description={<>Patient-care messages, like appointment reminders. Once WhatsApp approves one, agents can send it from any chat, even when the 24-hour window is closed. <b>Offers are not allowed here</b>; they go through Campaigns.</>}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" onClick={() => setEditing({ template: null })} className={primaryBtnCls}>
          <Plus className="w-4 h-4" /> New message
        </button>
        <button
          type="button"
          onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          className={secondaryBtnCls}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Check for WhatsApp&apos;s answer
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="py-6">
          <p className="text-[13px] font-medium text-gray-700 mb-1">No messages yet. Start from an example:</p>
          <p className="text-[12px] text-gray-400 mb-3">Pick one, adjust the wording, and send it to WhatsApp for approval.</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                type="button"
                onClick={() => setEditing({ template: null, example: ex })}
                dir="auto"
                className="text-[12.5px] font-medium text-brand-fg bg-brand-50 border border-brand/20 hover:bg-brand-100 rounded-full px-3 py-1.5 cursor-pointer"
              >
                {ex.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => {
            const st = STATUS[t.approvalStatus] ?? STATUS.DRAFT;
            const Icon = st.icon;
            const editable = t.approvalStatus === "DRAFT" || t.approvalStatus === "REJECTED";
            return (
              <li key={t.id} className="border border-gray-100 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900 truncate" dir="auto">{t.name}</p>
                    <span className={`inline-flex items-center gap-1 mt-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 ${st.tone}`}>
                      <Icon className="w-3.5 h-3.5" /> {st.label}
                    </span>
                    <span className="ml-2 text-[11.5px] text-gray-400">{st.hint}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {editable && (
                      <>
                        <button
                          type="button"
                          onClick={() => submit(t)}
                          disabled={submittingId === t.id}
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-60 rounded-lg px-3 py-1.5 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" /> {submittingId === t.id ? "Sending…" : t.approvalStatus === "REJECTED" ? "Send again" : "Send for approval"}
                        </button>
                        <button type="button" onClick={() => setEditing({ template: t })} aria-label={`Edit ${t.name}`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 cursor-pointer">
                          <Pencil className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-2.5 text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words" dir="auto">
                  <MessageText text={t.body} />
                </p>
                {t.approvalStatus === "REJECTED" && t.rejectionReason && (
                  <p className="mt-2 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                    WhatsApp&apos;s reason: {t.rejectionReason}
                  </p>
                )}
                {t.classedMarketing && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    WhatsApp decided this is marketing, so agents can&apos;t use it as a patient-care message and opted-out patients will never get it. Delete it and write it again without any offer wording.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditorDialog
          template={editing.template}
          example={editing.example}
          onCancel={() => setEditing(null)}
          onSaved={(saved, message) => {
            upsert(saved);
            setEditing(null);
            toast.success(message);
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          template={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setTemplates((list) => (list ?? []).filter((t) => t.id !== deleting.id));
            setDeleting(null);
            toast.success("Message deleted");
          }}
        />
      )}
    </SectionCard>
  );
}

function EditorDialog({ template, example, onCancel, onSaved }: {
  template: Template | null;
  example?: { name: string; body: string };
  onCancel: () => void;
  onSaved: (t: Template, message: string) => void;
}) {
  const [name, setName] = useState(template?.name ?? example?.name ?? "");
  const [body, setBody] = useState(template?.body ?? example?.body ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const problems = useMemo(() => problemsOf(`${name}\n${body}`), [name, body]);
  const bodyProblems = useMemo(() => problemsOf(body), [body]);
  const blocked = problems.words.length > 0 || bodyProblems.edgeBlank || bodyProblems.unknown.length > 0;
  const ready = name.trim() && body.trim() && confirmed && !blocked;

  // Puts {{key}} where the cursor is, with spaces around it as needed.
  function insert(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const pre = before && !/\s$/.test(before) ? " " : "";
    const post = after && !/^[\s.,!?،]/.test(after) ? " " : "";
    const next = `${before}${pre}${token}${post}${after}`.slice(0, BODY_MAX);
    setBody(next);
    requestAnimationFrame(() => {
      const pos = (before + pre + token + post).length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  async function save(andSubmit: boolean) {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = { name: name.trim(), body: body.trim() };
      let saved = template ? (await apiUpdateUtilityTemplate(template.id, data)).data : (await apiCreateUtilityTemplate(data)).data;
      if (andSubmit) saved = (await apiSubmitUtilityTemplate(saved.id)).data;
      onSaved(saved, andSubmit ? "Sent to WhatsApp for approval" : "Saved as a draft");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the message."));
      setSaving(false);
    }
  }

  return (
    <DialogShell title={template ? "Edit message" : "New patient-care message"} onCancel={onCancel} saving={saving} width="w-[880px] max-w-[calc(100vw-2rem)]">
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4 min-w-0">
            {!template && (
              <div>
                <p className={labelCls}>Start from an example</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.name}
                      type="button"
                      onClick={() => { setName(ex.name); setBody(ex.body); }}
                      dir="auto"
                      className="text-[12px] font-medium text-gray-600 border border-gray-200 hover:border-brand hover:text-brand-fg rounded-full px-2.5 py-1 cursor-pointer"
                    >
                      {ex.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="ct-name" className={labelCls}>Name</label>
              <input id="ct-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Appointment reminder" dir="auto" className={inputCls} />
              <p className="text-[11.5px] text-gray-400 mt-1">Only the team sees this. Agents pick the message by its name.</p>
            </div>

            <div>
              <label htmlFor="ct-body" className={labelCls}>Message</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {BLANKS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => insert(b.key)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-100 hover:bg-sky-100 rounded-full px-2.5 py-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> {b.label}
                  </button>
                ))}
              </div>
              <textarea
                id="ct-body"
                ref={bodyRef}
                value={body}
                maxLength={BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                dir="auto"
                placeholder="Hi {{first_name}}, this is a reminder of your appointment on {{date}} at {{time}}."
                className={`${inputCls} resize-y`}
              />
              <div className="flex justify-between text-[11.5px] text-gray-400 mt-1">
                <span>The patient&apos;s first name is filled in automatically. The agent types the other blanks when sending.</span>
                <span className="tabular-nums shrink-0 ml-2">{body.length}/{BODY_MAX}</span>
              </div>
            </div>

            {problems.words.length > 0 && (
              <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  This reads like an offer ({problems.words.map((w) => `"${w}"`).join(", ")}). Patient-care messages can&apos;t mention offers,
                  discounts or prices. Remove those words; offers go through Campaigns.
                </span>
              </p>
            )}
            {bodyProblems.edgeBlank && (
              <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                WhatsApp doesn&apos;t accept a message that starts or ends with a blank. Add a word before or after it.
              </p>
            )}
            {bodyProblems.unknown.length > 0 && (
              <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {`{{${bodyProblems.unknown[0]}}}`} isn&apos;t a blank the app knows. Use the buttons above the message.
              </p>
            )}

            <label className="flex items-start gap-2.5 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-brand" />
              <span className="text-[12.5px] text-gray-700">
                This message is about the patient&apos;s <b>own appointment, visit, results or account</b>. It is <b>not</b> an offer, a promotion
                or an invitation to buy something.
              </span>
            </label>
          </div>

          {/* What the patient sees, with example values in the blanks. */}
          <div>
            <p className={labelCls}>Preview</p>
            <div className="bg-[#EFEAE2] rounded-xl p-3 min-h-[160px]">
              {body.trim() ? (
                <div className="bg-white rounded-xl rounded-tl-sm px-3 py-2 shadow-sm max-w-[260px]">
                  <p className="text-[13.5px] text-gray-800 leading-relaxed whitespace-pre-wrap break-words" dir="auto">
                    <MessageText text={body} samples />
                  </p>
                </div>
              ) : (
                <p className="text-[12px] text-gray-500 text-center pt-12">Your message appears here</p>
              )}
            </div>
            <p className="text-[11.5px] text-gray-400 mt-2">
              Highlighted parts are examples. Each patient gets their own name and the details the agent types.
            </p>
          </div>
        </div>

        {error && <p role="alert" className="text-[13px] text-red-500 font-medium mt-4">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryBtnCls}>Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={!ready || saving} className={secondaryBtnCls}>Save as draft</button>
          <button type="submit" disabled={!ready || saving} className={primaryBtnCls}>
            <Send className="w-4 h-4" /> {saving ? "Saving…" : "Send for approval"}
          </button>
        </div>
        {!confirmed && name.trim() && body.trim() && !blocked && (
          <p className="text-[11.5px] text-gray-400 text-right mt-1.5">Tick the box above to confirm it isn&apos;t marketing.</p>
        )}
      </form>
    </DialogShell>
  );
}

function DeleteDialog({ template, onCancel, onDeleted }: { template: Template; onCancel: () => void; onDeleted: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiDeleteUtilityTemplate(template.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the message."));
      setSaving(false);
    }
  }

  return (
    <DialogShell
      title="Delete this message?"
      intro={<>Agents will no longer find <b dir="auto">{template.name}</b>.{template.metaTemplateName ? " It is also removed from WhatsApp, and its name can't be reused for 30 days." : ""}</>}
      onCancel={onCancel}
      saving={saving}
    >
      <form onSubmit={submit} className="px-6 pb-6 space-y-3">
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onCancel} label="Delete" danger />
      </form>
    </DialogShell>
  );
}
