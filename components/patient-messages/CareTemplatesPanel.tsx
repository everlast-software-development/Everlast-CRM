"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Link2, MessageSquareText, Pencil, Phone, Plus, RefreshCw, Send, ShieldAlert, Trash2, Upload, X, XCircle,
} from "lucide-react";
import {
  apiCreateUtilityTemplate,
  apiDeleteUtilityTemplate,
  apiGetUtilityTemplates,
  apiSubmitUtilityTemplate,
  apiUpdateUtilityTemplate,
  apiUploadMedia,
  type UtilityTemplateInput,
} from "@/lib/api";
import { findMarketingWords } from "@/lib/marketingWords";
import { BUTTON_LIMITS, HEADER_TYPE_OPTIONS, headerCharError } from "@/components/templates/shared";
import { WaTemplateMessage } from "@/components/whatsapp/WaPreview";
import type { Template, TemplateButton, TemplateHeaderType, TemplateStatus } from "@/types";
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

const HEADER_MAX = 60;
const FOOTER_MAX = 60;
const BUTTON_TITLE_MAX = 25;

// The buttons a patient-care message can have. No Copy code: it carries an
// offer code. Limits are Meta's (components/templates/shared.tsx).
type CareButtonType = "URL" | "PHONE_NUMBER" | "QUICK_REPLY";
const CARE_BUTTONS: { type: CareButtonType; label: string; icon: typeof Link2; hint: string }[] = [
  { type: "URL", label: "Link", icon: Link2, hint: "Opens a web page, e.g. the results portal or directions" },
  { type: "PHONE_NUMBER", label: "Call", icon: Phone, hint: "Calls the clinic" },
  { type: "QUICK_REPLY", label: "Quick reply", icon: MessageSquareText, hint: "A ready answer the patient taps, e.g. Confirm" },
];
const CARE_BUTTON_BY_TYPE = Object.fromEntries(CARE_BUTTONS.map((b) => [b.type, b])) as Record<CareButtonType, (typeof CARE_BUTTONS)[number]>;

// Meta takes JPEG/PNG images, MP4 video and PDF documents in a template header.
const HEADER_MEDIA: Record<"IMAGE" | "VIDEO" | "DOCUMENT", { accept: string; mimes: string[]; what: string }> = {
  IMAGE: { accept: "image/jpeg,image/png", mimes: ["image/jpeg", "image/png"], what: "a JPG or PNG image" },
  VIDEO: { accept: "video/mp4", mimes: ["video/mp4"], what: "an MP4 video" },
  DOCUMENT: { accept: "application/pdf", mimes: ["application/pdf"], what: "a PDF" },
};
const isMediaHeader = (t: TemplateHeaderType): t is "IMAGE" | "VIDEO" | "DOCUMENT" => t === "IMAGE" || t === "VIDEO" || t === "DOCUMENT";

// The text with each blank replaced by its example value, for the preview.
const withSamples = (text: string) =>
  text.replace(BLANK_RE, (token) => BLANK_BY_KEY[keyOf(token)]?.sample ?? token);

let buttonSeq = 0;
const newButtonId = () => `b${Date.now().toString(36)}${(buttonSeq++).toString(36)}`;

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
                {t.headerType === "TEXT" && t.header && (
                  <p className="mt-2.5 text-[13px] font-semibold text-gray-900 break-words" dir="auto"><MessageText text={t.header} /></p>
                )}
                {isMediaHeader(t.headerType) && (
                  <p className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-gray-500 bg-gray-50 border border-gray-100 rounded-md px-1.5 py-0.5">
                    {HEADER_TYPE_OPTIONS.find((o) => o.value === t.headerType)?.label} at the top
                  </p>
                )}
                <p className="mt-2.5 text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words" dir="auto">
                  <MessageText text={t.body} />
                </p>
                {t.footer && <p className="mt-1 text-[12px] text-gray-400 break-words" dir="auto">{t.footer}</p>}
                {!!t.buttons?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.buttons.map((b) => {
                      const Icon = CARE_BUTTON_BY_TYPE[b.type as CareButtonType]?.icon ?? MessageSquareText;
                      return (
                        <span key={b.id} dir="auto" title={b.url || b.phoneNumber || undefined} className="inline-flex items-center gap-1 text-[12px] font-medium text-sky-700 bg-white border border-gray-200 rounded-full px-2.5 py-0.5">
                          <Icon className="w-3 h-3" /> {b.title}
                        </span>
                      );
                    })}
                  </div>
                )}
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
  const [headerType, setHeaderType] = useState<TemplateHeaderType>(template?.headerType ?? "NONE");
  const [header, setHeader] = useState(template?.headerType === "TEXT" ? template.header ?? "" : "");
  const [headerMediaUrl, setHeaderMediaUrl] = useState(template && isMediaHeader(template.headerType) ? template.headerMediaUrl ?? "" : "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [buttons, setButtons] = useState<TemplateButton[]>(template?.buttons ?? []);
  const [uploading, setUploading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Offer wording anywhere the patient reads it: header, message, footer, buttons and links.
  const everything = [name, headerType === "TEXT" ? header : "", body, footer, ...buttons.flatMap((b) => [b.title, b.url ?? ""])].join("\n");
  const problems = useMemo(() => problemsOf(everything), [everything]);
  const bodyProblems = useMemo(() => problemsOf(body), [body]);
  const headerProblem = useMemo(() => {
    if (headerType === "TEXT") {
      if (!header.trim()) return "Write the header, or choose None.";
      const blanks = [...header.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]);
      if (blanks.length > 1) return "A header can have at most one blank.";
      if (blanks.some((k) => !BLANK_BY_KEY[k.toLowerCase()])) return `{{${blanks[0]}}} isn't a blank the app knows.`;
      return headerCharError(header);
    }
    if (isMediaHeader(headerType) && !headerMediaUrl) return `Add ${HEADER_MEDIA[headerType].what} for the header, or choose None.`;
    return null;
  }, [headerType, header, headerMediaUrl]);
  const footerProblem = /\{\{/.test(footer) ? "The footer can't have blanks." : null;
  const buttonProblem = useMemo(() => {
    for (const b of buttons) {
      const what = b.title.trim() ? `"${b.title.trim()}"` : "A button";
      if (!b.title.trim()) return "Every button needs a label.";
      if (/\{\{/.test(b.title)) return `${what}: a button label can't have blanks.`;
      if (b.type === "URL") {
        const url = (b.url ?? "").trim();
        if (!/^https?:\/\/\S+\.\S+/i.test(url)) return `${what}: the link must start with https://`;
        const blanks = [...url.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1].toLowerCase());
        if (blanks.some((k) => k !== "first_name") || blanks.length > 1) return `${what}: only the patient's first name can go into a link.`;
        if (blanks.length && !/\{\{[^{}]*\}\}$/.test(url)) return `${what}: the patient's name must be at the very end of the link.`;
      }
      if (b.type === "PHONE_NUMBER" && !/^\+?[0-9]{7,15}$/.test((b.phoneNumber ?? "").replace(/[\s-]/g, ""))) {
        return `${what}: enter the number with its country code, e.g. +971 4 123 4567.`;
      }
    }
    return null;
  }, [buttons]);
  const blocked =
    problems.words.length > 0 || bodyProblems.edgeBlank || bodyProblems.unknown.length > 0 || !!headerProblem || !!footerProblem || !!buttonProblem || uploading;
  const ready = name.trim() && body.trim() && confirmed && !blocked;

  const countOf = (type: CareButtonType) => buttons.filter((b) => b.type === type).length;
  const canAdd = (type: CareButtonType) => buttons.length < BUTTON_LIMITS.total && countOf(type) < BUTTON_LIMITS[type];
  const addButton = (type: CareButtonType) =>
    setButtons((list) => [...list, { id: newButtonId(), type, title: "", ...(type === "URL" ? { url: "https://" } : type === "PHONE_NUMBER" ? { phoneNumber: "" } : {}) }]);
  const changeButton = (id: string, patch: Partial<TemplateButton>) => setButtons((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeButton = (id: string) => setButtons((list) => list.filter((b) => b.id !== id));

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

  async function uploadHeaderFile(file: File | undefined) {
    if (!file || !isMediaHeader(headerType)) return;
    const media = HEADER_MEDIA[headerType];
    if (!media.mimes.includes(file.type)) {
      setError(`WhatsApp takes ${media.what} here.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      setHeaderMediaUrl((await apiUploadMedia(file)).url);
    } catch (err) {
      setError(errorMessage(err, "Couldn't upload the file."));
    } finally {
      setUploading(false);
    }
  }

  async function save(andSubmit: boolean) {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data: UtilityTemplateInput = {
        name: name.trim(),
        body: body.trim(),
        footer: footer.trim() || null,
        headerType,
        header: headerType === "TEXT" ? header.trim() : null,
        headerMediaUrl: isMediaHeader(headerType) ? headerMediaUrl : null,
        buttons: buttons.length
          ? buttons.map((b) => ({
              id: b.id,
              type: b.type,
              title: b.title.trim(),
              ...(b.type === "URL" && { url: (b.url ?? "").trim() }),
              ...(b.type === "PHONE_NUMBER" && { phoneNumber: (b.phoneNumber ?? "").replace(/[\s-]/g, "") }),
            }))
          : null,
      };
      let saved = template ? (await apiUpdateUtilityTemplate(template.id, data)).data : (await apiCreateUtilityTemplate(data)).data;
      if (andSubmit) saved = (await apiSubmitUtilityTemplate(saved.id)).data;
      onSaved(saved, andSubmit ? "Sent to WhatsApp for approval" : "Saved as a draft");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the message."));
      setSaving(false);
    }
  }

  const optional = <span className="font-normal text-gray-400"> (optional)</span>;

  return (
    <DialogShell title={template ? "Edit message" : "New patient-care message"} onCancel={onCancel} saving={saving} width="w-[920px] max-w-[calc(100vw-2rem)]">
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="px-6 pb-6 overflow-y-auto min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-5 min-w-0">
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

            {/* Header: nothing, a bold line, or a picture / video / PDF above the message. */}
            <div>
              <p className={labelCls}>Header{optional}</p>
              <div className="inline-flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1" role="group" aria-label="Header type">
                {HEADER_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={headerType === value}
                    onClick={() => { setHeaderType(value); setHeaderMediaUrl(""); }}
                    className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer ${headerType === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
              {headerType === "TEXT" && (
                <div className="mt-2">
                  <input
                    aria-label="Header text"
                    value={header}
                    maxLength={HEADER_MAX}
                    onChange={(e) => setHeader(e.target.value)}
                    placeholder="Your appointment details"
                    dir="auto"
                    className={inputCls}
                  />
                  <p className="flex justify-between text-[11.5px] text-gray-400 mt-1">
                    <span>Shown in bold above the message. No emojis or formatting.</span>
                    <span className="tabular-nums shrink-0 ml-2">{header.length}/{HEADER_MAX}</span>
                  </p>
                </div>
              )}
              {isMediaHeader(headerType) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept={HEADER_MEDIA[headerType].accept} className="hidden" onChange={(e) => { uploadHeaderFile(e.target.files?.[0]); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={secondaryBtnCls}>
                    <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : headerMediaUrl ? "Replace file" : "Upload file"}
                  </button>
                  {headerMediaUrl ? (
                    <a href={headerMediaUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-fg underline truncate max-w-[260px]">
                      {decodeURIComponent(headerMediaUrl.split("/").pop() || "File")}
                    </a>
                  ) : (
                    <span className="text-[11.5px] text-gray-400">{HEADER_MEDIA[headerType].what[0].toUpperCase() + HEADER_MEDIA[headerType].what.slice(1)}, sent with every message.</span>
                  )}
                </div>
              )}
              {headerProblem && headerType !== "NONE" && (headerType === "TEXT" ? header.trim() : true) && (
                <p className="text-[12px] text-amber-700 mt-1.5">{headerProblem}</p>
              )}
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

            <div>
              <label htmlFor="ct-footer" className={labelCls}>Footer{optional}</label>
              <input id="ct-footer" value={footer} maxLength={FOOTER_MAX} onChange={(e) => setFooter(e.target.value)} placeholder="Everlast Wellness" dir="auto" className={inputCls} />
              <p className="flex justify-between text-[11.5px] text-gray-400 mt-1">
                <span>Small grey line under the message, e.g. the clinic&apos;s name.</span>
                <span className="tabular-nums shrink-0 ml-2">{footer.length}/{FOOTER_MAX}</span>
              </p>
              {footerProblem && <p className="text-[12px] text-amber-700 mt-1">{footerProblem}</p>}
            </div>

            {/* Buttons: link, call, quick reply — Meta's limits. */}
            <div>
              <p className={labelCls}>Buttons{optional}</p>
              {buttons.length > 0 && (
                <ul className="space-y-2 mb-2">
                  {buttons.map((b) => {
                    const meta = CARE_BUTTON_BY_TYPE[b.type as CareButtonType] ?? CARE_BUTTON_BY_TYPE.QUICK_REPLY;
                    const Icon = meta.icon;
                    return (
                      <li key={b.id} className="border border-gray-100 rounded-xl p-2.5 bg-gray-50/60">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-500 w-[92px] shrink-0">
                            <Icon className="w-3.5 h-3.5" /> {meta.label}
                          </span>
                          <input
                            aria-label={`${meta.label} button label`}
                            value={b.title}
                            maxLength={BUTTON_TITLE_MAX}
                            onChange={(e) => changeButton(b.id, { title: e.target.value })}
                            placeholder={b.type === "URL" ? "View results" : b.type === "PHONE_NUMBER" ? "Call the clinic" : "Confirm"}
                            dir="auto"
                            className={`${inputCls} flex-1 min-w-0`}
                          />
                          <button type="button" onClick={() => removeButton(b.id)} aria-label={`Remove ${b.title || meta.label} button`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {b.type === "URL" && (
                          <div className="mt-2 sm:ps-[100px] me-9">
                            <input
                              aria-label="Link"
                              value={b.url ?? ""}
                              onChange={(e) => changeButton(b.id, { url: e.target.value })}
                              placeholder="https://everlastwellness.com/results"
                              dir="ltr"
                              inputMode="url"
                              className={inputCls}
                            />
                            {!/\{\{[^{}]*\}\}$/.test(b.url ?? "") && (
                              <button
                                type="button"
                                onClick={() => changeButton(b.id, { url: `${(b.url ?? "").trim()}{{first_name}}` })}
                                className="mt-1 text-[11.5px] text-sky-700 hover:underline cursor-pointer"
                              >
                                + End the link with the patient&apos;s first name
                              </button>
                            )}
                          </div>
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <div className="mt-2 sm:ps-[100px] me-9">
                            <input
                              aria-label="Phone number"
                              value={b.phoneNumber ?? ""}
                              onChange={(e) => changeButton(b.id, { phoneNumber: e.target.value })}
                              placeholder="+971 4 123 4567"
                              dir="ltr"
                              inputMode="tel"
                              className={inputCls}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5">
                {CARE_BUTTONS.map(({ type, label, icon: Icon, hint }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addButton(type)}
                    disabled={!canAdd(type)}
                    title={canAdd(type) ? hint : `WhatsApp allows at most ${BUTTON_LIMITS[type]} ${label.toLowerCase()} button${BUTTON_LIMITS[type] > 1 ? "s" : ""}`}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 hover:border-brand hover:text-brand-fg disabled:opacity-40 disabled:cursor-not-allowed rounded-full px-2.5 py-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
              <p className="text-[11.5px] text-gray-400 mt-1.5">
                Up to 2 links and 1 call button. With more than 3 buttons, WhatsApp shows 2 and puts the rest under &quot;See all options&quot;.
              </p>
              {buttonProblem && buttons.some((b) => b.title.trim()) && <p className="text-[12px] text-amber-700 mt-1">{buttonProblem}</p>}
            </div>

            {problems.words.length > 0 && (
              <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  This reads like an offer ({problems.words.map((w) => `"${w}"`).join(", ")}). Patient-care messages can&apos;t mention offers,
                  discounts or prices, in the text, the buttons or the links. Remove those words; offers go through Campaigns.
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
                or an invitation to buy something, and its links don&apos;t lead to one.
              </span>
            </label>
          </div>

          {/* What the patient sees, with example values in the blanks. */}
          <div className="md:sticky md:top-0 self-start">
            <p className={labelCls}>Preview</p>
            <div className="bg-[#EFEAE2] rounded-xl p-3 min-h-[160px]">
              {body.trim() ? (
                <div className="max-w-[270px]">
                  <WaTemplateMessage
                    headerType={headerType}
                    header={headerType === "TEXT" ? withSamples(header) : null}
                    headerMediaUrl={isMediaHeader(headerType) ? headerMediaUrl || null : null}
                    body={withSamples(body)}
                    footer={footer}
                    buttons={buttons.map((b) => ({ ...b, title: b.title.trim() || CARE_BUTTON_BY_TYPE[b.type as CareButtonType]?.label || "Button" }))}
                  />
                </div>
              ) : (
                <p className="text-[12px] text-gray-500 text-center pt-12">Your message appears here</p>
              )}
            </div>
            <p className="text-[11.5px] text-gray-400 mt-2">
              Example values fill the blanks. Each patient gets their own name and the details the agent types.
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
