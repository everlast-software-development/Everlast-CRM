"use client";

import { useMemo, useRef, useState } from "react";
import { Link2, MessageSquareText, Phone, Plus, RotateCcw, Send, ShieldAlert, Upload, X } from "lucide-react";
import { apiCreateWebsiteTemplate, apiSubmitWebsiteTemplate, apiUpdateWebsiteTemplate, apiUploadMedia } from "@/lib/api";
import { findMarketingWords } from "@/lib/marketingWords";
import type { StoreKind, StoreKindDef, StoreLanguage, StoreVarDef, TemplateButton, TemplateHeaderType, WebsiteTemplate, WebsiteTemplateInput } from "@/types";
import { DialogShell } from "@/components/DialogShell";
import { WaTemplateMessage } from "@/components/whatsapp/WaPreview";
import { BUTTON_LIMITS, HEADER_TYPE_OPTIONS, headerCharError } from "@/components/templates/shared";
import { errorMessage, inputCls, labelCls, primaryBtnCls, secondaryBtnCls } from "@/components/settings/shared";

// The WhatsApp template for one kind × language of store message. A new one can
// start from the store's own wording ({first_name} becomes {{first_name}}). A
// store message is sent with the approved template for its kind and language
// (utils/storeEvents.js → matchTemplate); the server checks everything again.

const BODY_MAX = 800;
const BLANK_RE = /(\{\{\s*[a-z_]+\s*\}\})/gi;
const keyOf = (t: string) => t.replace(/[{}\s]/g, "").toLowerCase();
const LANG_NAME: Record<StoreLanguage, string> = { en: "English", ar: "Arabic" };
const SIGN_OFF: Record<StoreLanguage, string> = { en: "Everlast Wellness", ar: "إيفرلاست ويلنس" };

// The staff's text as a template body. WhatsApp refuses one that starts or ends
// with a blank, so a closing line is added when it does.
export function bodyFromStoreText(text: string, language: StoreLanguage): { body: string; addedSignOff: boolean } {
  let body = text.replace(/(?<!\{)\{\s*([a-z_]+)\s*\}(?!\})/gi, (_m, k: string) => `{{${k.toLowerCase()}}}`).trim();
  const endsBlank = /\{\{[^{}]+\}\}[.!?]?$/.test(body);
  if (endsBlank) body = `${body}\n\n${SIGN_OFF[language]}`;
  return { body: body.slice(0, BODY_MAX), addedSignOff: endsBlank };
}

const HEADER_MEDIA: Record<"IMAGE" | "VIDEO" | "DOCUMENT", { accept: string; mimes: string[]; what: string }> = {
  IMAGE: { accept: "image/jpeg,image/png", mimes: ["image/jpeg", "image/png"], what: "a JPG or PNG image" },
  VIDEO: { accept: "video/mp4", mimes: ["video/mp4"], what: "an MP4 video" },
  DOCUMENT: { accept: "application/pdf", mimes: ["application/pdf"], what: "a PDF" },
};
const isMedia = (t: TemplateHeaderType): t is "IMAGE" | "VIDEO" | "DOCUMENT" => t === "IMAGE" || t === "VIDEO" || t === "DOCUMENT";

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function WebsiteTemplateEditor({
  kind, language, def, variables, linkBase, template, storeText, storeCategory, lastValues, onCancel, onSaved,
}: {
  kind: StoreKind;
  language: StoreLanguage;
  def: StoreKindDef;
  variables: Record<string, StoreVarDef>;
  linkBase: string;
  template: WebsiteTemplate | null;
  /** The text the store last sent for this kind × language, if any. */
  storeText: string | null;
  storeCategory: "marketing" | "utility" | null;
  lastValues: Record<string, string> | null;
  onCancel: () => void;
  onSaved: (t: WebsiteTemplate, message: string) => void;
}) {
  // A new one starts from the text the store last sent (if any), as a draft to word as you like.
  const start = template ? { body: template.body, addedSignOff: false } : bodyFromStoreText(storeText ?? "", language);
  const [signOffNote, setSignOffNote] = useState(start.addedSignOff);
  const [name, setName] = useState(template?.name ?? `${def.label} (${LANG_NAME[language]})`);
  const [body, setBody] = useState(start.body);
  const [headerType, setHeaderType] = useState<TemplateHeaderType>(template?.headerType ?? "NONE");
  const [header, setHeader] = useState(template?.headerType === "TEXT" ? template.header ?? "" : "");
  const [headerMediaUrl, setHeaderMediaUrl] = useState(template && isMedia(template.headerType) ? template.headerMediaUrl ?? "" : "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [buttons, setButtons] = useState<TemplateButton[]>(template?.buttons ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const category = storeCategory ?? def.category;
  const labelOf = (k: string) => (k === "first_name" ? "First name" : variables[k]?.label ?? k);
  const sampleOf = (k: string) => lastValues?.[k] ?? (k === "first_name" ? "Sara" : variables[k]?.sample ?? k);
  const withValues = (text: string) => text.replace(BLANK_RE, (tok) => sampleOf(keyOf(tok)));

  const unknown = useMemo(
    () => [...new Set([...`${body}\n${header}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))].filter((k) => !def.vars.includes(k)),
    [body, header, def.vars],
  );
  const words = useMemo(() => (category === "utility" ? findMarketingWords([body, header, footer, ...buttons.map((b) => b.title)].join("\n")) : []), [category, body, header, footer, buttons]);
  const edgeBlank = /^\{\{[^{}]+\}\}/.test(body.trim()) || /\{\{[^{}]+\}\}[.!?]?$/.test(body.trim());
  const headerProblem = headerType === "TEXT" ? (!header.trim() ? "Write the header, or choose None." : headerCharError(header)) : isMedia(headerType) && !headerMediaUrl ? `Add ${HEADER_MEDIA[headerType].what}, or choose None.` : null;
  const buttonProblem = buttons.find((b) => !b.title.trim()) ? "Every button needs a label." : buttons.find((b) => b.type === "URL" && !/^https?:\/\/\S+/.test(b.url ?? "")) ? "Every link needs an address." : null;
  const blocked = !name.trim() || !body.trim() || unknown.length > 0 || words.length > 0 || edgeBlank || !!headerProblem || !!buttonProblem || uploading;

  function insert(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const s = el?.selectionStart ?? body.length;
    const e = el?.selectionEnd ?? body.length;
    const before = body.slice(0, s);
    const after = body.slice(e);
    const pre = before && !/\s$/.test(before) ? " " : "";
    const post = after && !/^[\s.,!?،]/.test(after) ? " " : "";
    setBody(`${before}${pre}${token}${post}${after}`.slice(0, BODY_MAX));
  }
  function applyStoreText() {
    const b = bodyFromStoreText(storeText ?? "", language);
    setBody(b.body);
    setSignOffNote(b.addedSignOff);
  }

  const count = (t: TemplateButton["type"]) => buttons.filter((b) => b.type === t).length;
  const canAdd = (t: "URL" | "PHONE_NUMBER" | "QUICK_REPLY") => buttons.length < BUTTON_LIMITS.total && count(t) < BUTTON_LIMITS[t];
  const addButton = (t: "URL" | "PHONE_NUMBER" | "QUICK_REPLY") =>
    setButtons((l) => [...l, { id: newId(), type: t, title: "", ...(t === "URL" ? { url: def.vars.includes("link") ? `${linkBase}{{link}}` : linkBase } : t === "PHONE_NUMBER" ? { phoneNumber: "" } : {}) }]);
  const change = (id: string, p: Partial<TemplateButton>) => setButtons((l) => l.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const isStoreLink = (url?: string) => url === `${linkBase}{{link}}`;

  async function upload(file: File | undefined) {
    if (!file || !isMedia(headerType)) return;
    if (!HEADER_MEDIA[headerType].mimes.includes(file.type)) return setError(`WhatsApp takes ${HEADER_MEDIA[headerType].what} here.`);
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
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const data: WebsiteTemplateInput = {
      websiteEvent: kind,
      language,
      storeCategory: category,
      name: name.trim(),
      body: body.trim(),
      headerType,
      header: headerType === "TEXT" ? header.trim() : null,
      headerMediaUrl: isMedia(headerType) ? headerMediaUrl : null,
      footer: footer.trim() || null,
      buttons: buttons.length
        ? buttons.map((b) => ({ id: b.id, type: b.type, title: b.title.trim(), ...(b.type === "URL" && { url: (b.url ?? "").trim() }), ...(b.type === "PHONE_NUMBER" && { phoneNumber: (b.phoneNumber ?? "").replace(/[\s-]/g, "") }) }))
        : null,
    };
    try {
      let saved = template ? (await apiUpdateWebsiteTemplate(template.id, data)).data : (await apiCreateWebsiteTemplate(data)).data;
      if (andSubmit) saved = (await apiSubmitWebsiteTemplate(saved.id)).data;
      onSaved(saved, andSubmit ? "Sent to WhatsApp for approval" : "Saved as a draft");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save it."));
      setSaving(false);
    }
  }

  return (
    <DialogShell title={`${template ? "Edit" : "New"} website template · ${def.label} · ${LANG_NAME[language]}`} onCancel={onCancel} saving={saving} width="w-[960px] max-w-[calc(100vw-2rem)]">
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="px-6 pb-6 overflow-y-auto min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-5 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
              <div>
                <label htmlFor="wt-name" className={labelCls}>Name</label>
                <input id="wt-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} dir="auto" className={inputCls} />
              </div>
              <span className={`text-[12px] font-semibold rounded-full px-2.5 py-1 mb-2 ${category === "marketing" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-sky-50 text-sky-700"}`}>
                {category === "marketing" ? "Marketing (as the store sends it)" : "Service (as the store sends it)"}
              </span>
            </div>

            <div>
              <p className={labelCls}>Header <span className="font-normal text-gray-400">(optional)</span></p>
              <div className="inline-flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1" role="group" aria-label="Header type">
                {HEADER_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" aria-pressed={headerType === value} onClick={() => { setHeaderType(value); setHeaderMediaUrl(""); }}
                    className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer ${headerType === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
              {headerType === "TEXT" && <input aria-label="Header text" value={header} maxLength={60} onChange={(e) => setHeader(e.target.value)} dir="auto" className={`${inputCls} mt-2`} />}
              {isMedia(headerType) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept={HEADER_MEDIA[headerType].accept} className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={secondaryBtnCls}><Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : headerMediaUrl ? "Replace file" : "Upload file"}</button>
                  {headerMediaUrl && <a href={headerMediaUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-fg underline truncate max-w-[260px]">{decodeURIComponent(headerMediaUrl.split("/").pop() || "File")}</a>}
                </div>
              )}
              {headerProblem && headerType !== "NONE" && (headerType !== "TEXT" || header.trim()) && <p className="text-[12px] text-amber-700 mt-1.5">{headerProblem}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="wt-body" className={labelCls}>Message</label>
                {storeText && (
                  <button type="button" onClick={applyStoreText} title={storeText} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-fg hover:underline cursor-pointer mb-1.5">
                    <RotateCcw className="w-3 h-3" /> Start from the store&apos;s wording
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {def.vars.map((k) => (
                  <button key={k} type="button" onClick={() => insert(k)} className="inline-flex items-center gap-1 text-[12px] font-medium text-sky-700 bg-sky-50 border border-sky-100 hover:bg-sky-100 rounded-full px-2.5 py-1 cursor-pointer">
                    <Plus className="w-3 h-3" /> {labelOf(k)}
                  </button>
                ))}
              </div>
              <textarea id="wt-body" ref={bodyRef} value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={6} dir="auto" className={`${inputCls} resize-y`} />
              <p className="flex justify-between text-[11.5px] text-gray-400 mt-1">
                <span>The store sends {def.vars.map((v) => `{${v}}`).join(", ")} with this message.</span>
                <span className="tabular-nums">{body.length}/{BODY_MAX}</span>
              </p>
              {signOffNote && <p className="text-[12px] text-gray-500 mt-1">A closing line was added: WhatsApp doesn&apos;t accept a message that ends with a blank. Change it if you like.</p>}
              {edgeBlank && <p className="text-[12px] text-amber-700 mt-1">WhatsApp doesn&apos;t accept a message that starts or ends with a blank. Add a word before or after it.</p>}
              {unknown.length > 0 && <p className="text-[12px] text-amber-700 mt-1">The store doesn&apos;t send {unknown.map((u) => `{{${u}}}`).join(", ")} with this message.</p>}
            </div>

            <div>
              <label htmlFor="wt-footer" className={labelCls}>Footer <span className="font-normal text-gray-400">(optional)</span></label>
              <input id="wt-footer" value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} placeholder={language === "ar" ? "للإيقاف أرسل: إيقاف" : "Reply STOP to stop these messages"} dir="auto" className={inputCls} />
            </div>

            <div>
              <p className={labelCls}>Buttons <span className="font-normal text-gray-400">(optional)</span></p>
              {buttons.length > 0 && (
                <ul className="space-y-2 mb-2">
                  {buttons.map((b) => (
                    <li key={b.id} className="border border-gray-100 rounded-xl p-2.5 bg-gray-50/60 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-500 w-[92px] shrink-0">
                          {b.type === "URL" ? <Link2 className="w-3.5 h-3.5" /> : b.type === "PHONE_NUMBER" ? <Phone className="w-3.5 h-3.5" /> : <MessageSquareText className="w-3.5 h-3.5" />}
                          {b.type === "URL" ? "Link" : b.type === "PHONE_NUMBER" ? "Call" : "Quick reply"}
                        </span>
                        <input aria-label="Button label" value={b.title} maxLength={25} onChange={(e) => change(b.id, { title: e.target.value })} dir="auto" className={`${inputCls} flex-1 min-w-0`} />
                        <button type="button" onClick={() => setButtons((l) => l.filter((x) => x.id !== b.id))} aria-label="Remove button" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"><X className="w-4 h-4" /></button>
                      </div>
                      {b.type === "URL" && (
                        <div className="sm:ps-[100px] me-9 flex flex-col sm:flex-row gap-2">
                          <select aria-label="Link goes to" value={isStoreLink(b.url) ? "link" : "fixed"} onChange={(e) => change(b.id, { url: e.target.value === "link" ? `${linkBase}{{link}}` : linkBase })} className={`${inputCls} sm:w-56 cursor-pointer`}>
                            {def.vars.includes("link") && <option value="link">The store&apos;s link for this customer</option>}
                            <option value="fixed">A fixed address</option>
                          </select>
                          {isStoreLink(b.url) ? (
                            <p className="text-[11.5px] text-gray-500 self-center">Opens {"{link}"}, e.g. <span className="font-mono break-all">{sampleOf("link")}</span>. It must start with {linkBase}</p>
                          ) : (
                            <input aria-label="Link" value={b.url ?? ""} onChange={(e) => change(b.id, { url: e.target.value })} dir="ltr" inputMode="url" className={inputCls} />
                          )}
                        </div>
                      )}
                      {b.type === "PHONE_NUMBER" && (
                        <div className="sm:ps-[100px] me-9">
                          <input aria-label="Phone number" value={b.phoneNumber ?? ""} onChange={(e) => change(b.id, { phoneNumber: e.target.value })} placeholder="+971 4 123 4567" dir="ltr" inputMode="tel" className={inputCls} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5">
                {([["URL", "Link", Link2], ["PHONE_NUMBER", "Call", Phone], ["QUICK_REPLY", "Quick reply", MessageSquareText]] as const).map(([t, label, Icon]) => (
                  <button key={t} type="button" onClick={() => addButton(t)} disabled={!canAdd(t)} className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 hover:border-brand hover:text-brand-fg disabled:opacity-40 disabled:cursor-not-allowed rounded-full px-2.5 py-1 cursor-pointer">
                    <Plus className="w-3 h-3" /> <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
              {buttonProblem && buttons.some((b) => b.title.trim()) && <p className="text-[12px] text-amber-700 mt-1">{buttonProblem}</p>}
            </div>

            {words.length > 0 && (
              <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
                <span>This reads like an offer ({words.map((w) => `"${w}"`).join(", ")}), but the store sends it as a service message. WhatsApp would re-file it as marketing. Ask staff to change the store&apos;s text.</span>
              </p>
            )}
          </div>

          <div className="md:sticky md:top-0 self-start">
            <p className={labelCls}>Preview</p>
            <div className="bg-[#EFEAE2] rounded-xl p-3 min-h-[160px]">
              {body.trim() ? (
                <div className="max-w-[270px]">
                  <WaTemplateMessage headerType={headerType} header={headerType === "TEXT" ? withValues(header) : null} headerMediaUrl={isMedia(headerType) ? headerMediaUrl || null : null}
                    body={withValues(body)} footer={footer} buttons={buttons.map((b) => ({ ...b, title: b.title.trim() || "Button" }))} />
                </div>
              ) : (
                <p className="text-[12px] text-gray-500 text-center pt-12">Your message appears here</p>
              )}
            </div>
            <p className="text-[11.5px] text-gray-400 mt-2">{lastValues ? "Filled with the values from the store's latest message." : "Filled with example values."}</p>
          </div>
        </div>

        {error && <p role="alert" className="text-[13px] text-red-500 font-medium mt-4">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryBtnCls}>Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={blocked || saving} className={secondaryBtnCls}>Save as draft</button>
          <button type="submit" disabled={blocked || saving} className={primaryBtnCls}><Send className="w-4 h-4" /> {saving ? "Saving…" : "Send for approval"}</button>
        </div>
      </form>
    </DialogShell>
  );
}
