"use client";

import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  X,
  AlertCircle,
  Image as ImageIcon,
  Video,
  FileText,
  Upload,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Smile,
} from "lucide-react";
import { ApiError, apiCreateTemplate, apiUpdateTemplate, apiUploadToMediaLibrary } from "@/lib/api";
import MediaPicker, { ACCEPT_BY_TYPE } from "@/components/MediaPicker";
import {
  LIMITS,
  PERSONALIZE_VARS,
  HEADER_TYPE_OPTIONS,
  BUTTON_TYPE_META,
  OPT_OUT_TEXT,
  PLACEHOLDER_RE,
  headerCharError,
  renderPreview,
  estimateWaLines,
  WA_FOLD_LINES,
  CharCount,
} from "./shared";
import { usePlaceholderAutocomplete } from "./usePlaceholderAutocomplete";
import { CarouselEditor, carouselError, newCard } from "./CarouselEditor";
import { WaPhone, WaTemplateMessage } from "@/components/whatsapp/WaPreview";
import type {
  Template,
  TemplateButton,
  TemplateButtonType,
  TemplateCategory,
  TemplateHeaderType,
  TemplateCard,
  MediaAsset,
} from "@/types";

const EmojiPicker = lazy(() =>
  import("@emoji-mart/react").then((m) => ({ default: m.default }))
);

export default function TemplateForm({
  template,
  fix = null,
}: {
  template?: Template | null;
  // From a rejected submit: the field to point at and Meta's reason.
  fix?: { field: string | null; reason: string } | null;
}) {
  const router = useRouter();
  const fixRing = (field: string) =>
    fix?.field === field ? "rounded-xl ring-2 ring-red-300 ring-offset-4 ring-offset-white" : "";
  const isEditing = !!template;
  const [name, setName] = useState(template?.name ?? "");
  // The server's TEMPLATE_NAME_TAKEN answer (names are unique per business
  // account), shown right under the name field.
  const [nameTaken, setNameTaken] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<TemplateCategory>(
    template?.category ?? "GENERAL",
  );
  const [language, setLanguage] = useState(template?.language ?? "en_US");
  // Arabic templates are typed and previewed right-to-left.
  const dir = language.startsWith("ar") ? "rtl" : "ltr";
  const [headerType, setHeaderType] = useState<TemplateHeaderType>(template?.headerType ?? "NONE");
  const [header, setHeader] = useState(template?.header ?? "");
  const [headerMediaUrl, setHeaderMediaUrl] = useState(template?.headerMediaUrl ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [optOutOn, setOptOutOn] = useState(template?.footer === OPT_OUT_TEXT);
  const [buttons, setButtons] = useState<TemplateButton[]>(
    template?.buttons ?? [],
  );
  // A carousel template is the body text plus 2–10 swipeable cards; the
  // header, footer and message buttons don't exist on it.
  const [format, setFormat] = useState<"STANDARD" | "CAROUSEL">(template?.cards?.length ? "CAROUSEL" : "STANDARD");
  const [cards, setCards] = useState<TemplateCard[]>(
    template?.cards?.length ? template.cards : [newCard("QR", "IMAGE"), newCard("QR", "IMAGE")],
  );
  const isCarousel = format === "CAROUSEL";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPersonalize, setShowPersonalize] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showAddButtonMenu, setShowAddButtonMenu] = useState(false);
  const [uploadingHeaderMedia, setUploadingHeaderMedia] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);
  // "{{" autocomplete. Meta allows one variable in a text header.
  const headerAc = usePlaceholderAutocomplete(headerRef, header, setHeader, { maxVars: 1 });
  const bodyAc = usePlaceholderAutocomplete(bodyRef, body, setBody);
  const personalizeRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const addButtonMenuRef = useRef<HTMLDivElement>(null);
  const headerUploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showPersonalize && !showEmoji && !showAddButtonMenu) return;
    function onPointerDown(e: PointerEvent) {
      if (personalizeRef.current?.contains(e.target as Node)) return;
      if (emojiRef.current?.contains(e.target as Node)) return;
      if (addButtonMenuRef.current?.contains(e.target as Node)) return;
      setShowPersonalize(false);
      setShowEmoji(false);
      setShowAddButtonMenu(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showPersonalize, showEmoji, showAddButtonMenu]);

  function insertIntoBody(text: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function wrapBodySelection(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    // Nothing selected: drop in a pair and put the cursor between them.
    if (start === end) {
      setBody(body.slice(0, start) + marker + marker + body.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + marker.length, start + marker.length);
      });
      return;
    }
    // WhatsApp only formats *text* when both markers sit on the same line, hug
    // the words (no space or line break just inside) — so each selected line
    // is wrapped on its own, around its words, leaving spaces and blank lines
    // outside the markers.
    const wrapped = body
      .slice(start, end)
      .split("\n")
      .map((line) => {
        const m = /^(\s*)(.*?)(\s*)$/.exec(line);
        return m && m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : line;
      })
      .join("\n");
    setBody(body.slice(0, start) + wrapped + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + wrapped.length);
    });
  }

  function handleHeaderTypeChange(type: TemplateHeaderType) {
    setHeaderType(type);
    setError(null);
  }

  // Uploads straight to the Media Library and assigns it as the header in
  // one step — a shortcut for "Choose from Library" when the file isn't in
  // the library yet.
  async function handleDirectHeaderUpload(file: File | undefined) {
    if (!file) return;
    setUploadingHeaderMedia(true);
    setError(null);
    try {
      const res = await apiUploadToMediaLibrary(file, file.name);
      setHeaderMediaUrl(res.data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingHeaderMedia(false);
    }
  }

  function toggleOptOut() {
    if (!optOutOn) {
      setFooter(OPT_OUT_TEXT);
      setOptOutOn(true);
    } else {
      setFooter((f) => (f === OPT_OUT_TEXT ? "" : f));
      setOptOutOn(false);
    }
  }

  const hasQuickReply = buttons.some((b) => b.type === "QUICK_REPLY");
  const hasCTA = buttons.some((b) => b.type === "URL" || b.type === "PHONE_NUMBER");
  const urlCount = buttons.filter((b) => b.type === "URL").length;
  const phoneCount = buttons.filter((b) => b.type === "PHONE_NUMBER").length;
  const canAddQuickReply = buttons.length < 3 && !hasCTA;
  const canAddUrl = buttons.length < 3 && !hasQuickReply && urlCount < 2;
  const canAddPhone = buttons.length < 3 && !hasQuickReply && phoneCount < 1;

  function addButton(type: TemplateButtonType) {
    setButtons((prev) => [
      ...prev,
      {
        id: `btn_${Date.now()}`,
        type,
        title: "",
        ...(type === "URL" ? { url: "" } : {}),
        ...(type === "PHONE_NUMBER" ? { phoneNumber: "" } : {}),
      },
    ]);
    setShowAddButtonMenu(false);
  }
  function updateButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      return n;
    });
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  }

  function validateButtonsClientSide(): string | null {
    for (const b of buttons) {
      if (!b.title.trim()) return "All buttons need a title.";
      if (b.title.length > LIMITS.button) return `Button title "${b.title}" exceeds ${LIMITS.button} characters.`;
      if ((b.title.match(PLACEHOLDER_RE) || []).length > 0) return "Button titles can't contain placeholders.";
      if (b.type === "URL") {
        if (!b.url?.trim()) return "Every URL button needs a URL.";
        if (!/^https?:\/\//i.test(b.url)) return "Button URLs must start with http:// or https://.";
        if ((b.url.match(PLACEHOLDER_RE) || []).length > 1) return "A URL button can have at most 1 placeholder.";
      }
      if (b.type === "PHONE_NUMBER" && !b.phoneNumber?.trim()) {
        return "Every Call Number button needs a phone number.";
      }
    }
    return null;
  }

  function validateClientSide(): string | null {
    if (!name.trim() || !body.trim()) return "Name and body are required.";
    if (body.length > LIMITS.body) return `Body must be ≤ ${LIMITS.body} characters.`;
    if (isCarousel) {
      if (category === "GENERAL") return "A carousel is a marketing template — choose Campaign or Re-engagement.";
      return carouselError(cards);
    }
    if (footer.length > LIMITS.footer) return `Footer must be ≤ ${LIMITS.footer} characters.`;
    if (headerType === "TEXT") {
      if (!header.trim()) return "Header text is required when the header type is Text.";
      if (header.length > LIMITS.header) return `Header must be ≤ ${LIMITS.header} characters.`;
      const charErr = headerCharError(header);
      if (charErr) return charErr;
      const headerVars = header.match(PLACEHOLDER_RE) || [];
      if (headerVars.length > 1) return "A text header can have at most 1 placeholder.";
      const known = PERSONALIZE_VARS.map((v) => v.key);
      const unknown = headerVars.find((v) => !known.includes(v.replace(/[{}\s]/g, "").toLowerCase()));
      if (unknown) return `Unknown placeholder ${unknown} in the header. Type {{ to pick one.`;
    }
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) && !headerMediaUrl.trim()) {
      return `A sample ${headerType.toLowerCase()} URL is required for a ${headerType.toLowerCase()} header.`;
    }
    return validateButtonsClientSide();
  }

  const buttonsError = isCarousel ? null : validateButtonsClientSide();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clientError = validateClientSide();
    if (clientError) {
      setError(clientError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = isCarousel
        ? {
            name: name.trim(),
            category,
            language,
            headerType: "NONE" as TemplateHeaderType,
            body: body.trim(),
            cards: cards.map((c) => ({ ...c, body: c.body.trim(), mediaUrl: c.mediaUrl.trim() })),
          }
        : {
            name: name.trim(),
            category,
            language,
            headerType,
            header: headerType === "TEXT" ? header.trim() : undefined,
            headerMediaUrl: ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType) ? headerMediaUrl.trim() : undefined,
            body: body.trim(),
            footer: footer.trim() || undefined,
            buttons: buttons.length > 0 ? buttons : undefined,
            // Switching an existing carousel back to a standard template.
            ...(isEditing && template?.cards?.length ? { cards: [] as TemplateCard[] } : {}),
          };
      if (isEditing && template) {
        await apiUpdateTemplate(template.id, payload);
      } else {
        await apiCreateTemplate(payload);
      }
      router.push("/templates");
    } catch (err) {
      if (err instanceof ApiError && err.code === "TEMPLATE_NAME_TAKEN") {
        setNameTaken(err.message);
        nameRef.current?.focus();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  const visibleButtons = buttons.filter((b) => b.title.trim());

  return (
    <div className="h-full flex flex-col min-h-0 bg-white">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => router.push("/templates")}
            className="flex items-center gap-1 text-[12px] font-semibold text-gray-400 hover:text-gray-600 mb-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Templates
          </button>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">
            {isEditing ? "Edit Template" : "Create Template"}
          </h1>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 min-h-0">
        {/* Left — form */}
        <div className="flex-1 overflow-y-auto px-6 py-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
          <form id="tpl-form" onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
            {fix && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="text-[13px] text-red-700">
                  <p className="font-semibold">Meta rejected this template{fix.field ? ` — fix the ${fix.field} (outlined in red)` : ""}.</p>
                  <p className="text-red-600 mt-0.5">{fix.reason}</p>
                </div>
              </div>
            )}
            <div className={fixRing("name")}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-gray-600">
                  Template Name *
                </label>
                <CharCount val={name} max={LIMITS.name} />
              </div>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTaken(null);
                }}
                maxLength={LIMITS.name}
                placeholder="e.g. Wellness Check"
                required
                aria-invalid={Boolean(nameTaken)}
                className={`w-full border rounded-xl px-3 py-2.5 text-[14px] text-gray-800 outline-none ${nameTaken ? "border-red-400 focus:border-red-400 focus:ring-1 focus:ring-red-100" : "border-gray-200 focus:border-brand focus:ring-1 focus:ring-brand/20"}`}
              />
              {nameTaken && <p className="mt-1.5 text-[12.5px] text-red-500 font-medium">{nameTaken}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as TemplateCategory)
                  }
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-800 outline-none focus:border-brand bg-white"
                >
                  {/* The CRM name, then the category Meta bills and reviews it under. */}
                  <option value="GENERAL" disabled={isCarousel}>General · Utility{isCarousel ? " (not for carousels)" : ""}</option>
                  <option value="RE_ENGAGEMENT">Re-engagement · Marketing</option>
                  <option value="CAMPAIGN">Campaign · Marketing</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-800 outline-none focus:border-brand bg-white"
                >
                  <option value="en_US">English (en_US)</option>
                  <option value="ar">Arabic (ar)</option>
                </select>
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Format</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ["STANDARD", "Standard message", "Header, text, footer and buttons"],
                  ["CAROUSEL", "Carousel", "Text plus 2–10 swipeable cards"],
                ] as const).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFormat(value);
                      setError(null);
                      if (value === "CAROUSEL" && category === "GENERAL") setCategory("CAMPAIGN");
                    }}
                    className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${format === value ? "border-brand bg-brand-100" : "border-gray-200 hover:bg-gray-50"}`}
                  >
                    <span className={`block text-[13px] font-semibold ${format === value ? "text-brand-fg" : "text-gray-700"}`}>{label}</span>
                    <span className="block text-[11px] text-gray-400">{hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Header */}
            {!isCarousel && (
            <div className={fixRing("header")}>
              <label className="text-[12px] font-semibold text-gray-600 mb-1.5 block">
                Header <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <div className="grid grid-cols-5 gap-1.5 mb-2.5">
                {HEADER_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleHeaderTypeChange(opt.value)}
                    className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                      headerType === opt.value
                        ? "border-brand bg-brand-100 text-brand-fg"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                ))}
              </div>

              {headerType === "TEXT" && (
                <div>
                  <div className="flex items-center justify-end mb-1">
                    <CharCount val={header} max={LIMITS.header} />
                  </div>
                  <div className="relative">
                    <input
                      ref={headerRef}
                      type="text"
                      value={header}
                      {...headerAc.fieldProps}
                      maxLength={LIMITS.header}
                      placeholder="e.g. Hi {{first_name}}"
                      dir={dir}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
                    />
                    {headerAc.menu}
                  </div>
                  {headerCharError(header) ? (
                    <p className="text-[11px] text-red-600 mt-1">{headerCharError(header)}</p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">Type {"{{"} to add a placeholder — one allowed in the header. No emojis or formatting.</p>
                  )}
                </div>
              )}
              {(["IMAGE", "VIDEO", "DOCUMENT"] as TemplateHeaderType[]).includes(headerType) && (
                <div>
                  {headerMediaUrl && (
                    <div className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 bg-gray-50 mb-2">
                      <div className="w-11 h-11 rounded-lg overflow-hidden bg-white border border-gray-100 shrink-0 flex items-center justify-center">
                        {headerType === "IMAGE" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={headerMediaUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : headerType === "VIDEO" ? (
                          <Video className="w-4 h-4 text-gray-400" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <p className="text-[12.5px] text-gray-600 truncate flex-1 min-w-0">
                        {headerMediaUrl.split("/").pop()}
                      </p>
                      <button
                        type="button"
                        onClick={() => setHeaderMediaUrl("")}
                        className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMediaPicker(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-brand-fg border border-brand/30 bg-brand-100 px-3 py-2 rounded-xl hover:bg-brand-200 transition-colors cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Library
                    </button>
                    <button
                      type="button"
                      onClick={() => headerUploadRef.current?.click()}
                      disabled={uploadingHeaderMedia}
                      className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-gray-600 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 disabled:opacity-60 disabled:cursor-wait transition-colors cursor-pointer"
                    >
                      {uploadingHeaderMedia ? (
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {uploadingHeaderMedia ? "Uploading…" : `Add ${headerType === "IMAGE" ? "Image" : headerType === "VIDEO" ? "Video" : "Document"}`}
                    </button>
                    <input
                      ref={headerUploadRef}
                      type="file"
                      accept={ACCEPT_BY_TYPE[headerType as "IMAGE" | "VIDEO" | "DOCUMENT"]}
                      className="hidden"
                      onChange={(e) => { handleDirectHeaderUpload(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    A sample {headerType.toLowerCase()} used for preview and Meta approval — the same file plays for every recipient unless your template is later re-approved with a different one.
                  </p>
                </div>
              )}
            </div>
            )}

            {/* Body */}
            <div className={fixRing("body")}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-gray-600">
                  {isCarousel ? "Message text * (shown above the cards)" : "Message Body *"}
                </label>
                <CharCount val={body} max={LIMITS.body} />
              </div>
              <div className="relative">
                <textarea
                  ref={bodyRef}
                  value={body}
                  {...bodyAc.fieldProps}
                  maxLength={LIMITS.body}
                  placeholder={`Hi {{customer_name}}, we'd love to reconnect. (Type {{ for placeholders)`}
                  rows={12}
                  required
                  dir={dir}
                  className="w-full min-h-[160px] border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] leading-relaxed text-gray-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 resize-y"
                />
                {bodyAc.menu}
              </div>
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <button type="button" title="Bold" onClick={() => wrapBodySelection("*")} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer">
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Italic" onClick={() => wrapBodySelection("_")} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer">
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Strikethrough" onClick={() => wrapBodySelection("~")} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer">
                  <Strikethrough className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Monospace" onClick={() => wrapBodySelection("```")} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer">
                  <Code className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1" />
                <div className="relative" ref={personalizeRef}>
                  <button
                    type="button"
                    onClick={() => { setShowPersonalize((v) => !v); setShowEmoji(false); }}
                    className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors cursor-pointer ${showPersonalize ? "border-brand text-brand-fg bg-brand-100" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                  >
                    Personalize ▾
                  </button>
                  {showPersonalize && (
                    <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1">
                      {PERSONALIZE_VARS.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => { insertIntoBody(`{{${v.key}}}`); setShowPersonalize(false); }}
                          className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer font-mono"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative" ref={emojiRef}>
                  <button
                    type="button"
                    onClick={() => { setShowEmoji((v) => !v); setShowPersonalize(false); }}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${showEmoji ? "text-brand-fg bg-brand-100" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"}`}
                  >
                    <Smile className="w-3.5 h-3.5" />
                  </button>
                  {showEmoji && (
                    <div className="absolute top-full left-0 mt-1 z-10">
                      <Suspense fallback={null}>
                        <EmojiPicker
                          theme="light"
                          onEmojiSelect={(emoji: { native: string }) => {
                            insertIntoBody(emoji.native);
                            setShowEmoji(false);
                          }}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {isCarousel && (
              <div className={fixRing("cards")}>
                <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Cards *</label>
                <CarouselEditor cards={cards} onChange={setCards} />
              </div>
            )}

            {/* Footer */}
            {!isCarousel && (
            <div className={fixRing("footer")}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-gray-600">
                  Footer{" "}
                  <span className="font-normal text-gray-400">
                    (optional)
                  </span>
                </label>
                <CharCount val={footer} max={LIMITS.footer} />
              </div>
              <input
                type="text"
                value={footer}
                onChange={(e) => { setFooter(e.target.value); setOptOutOn(e.target.value === OPT_OUT_TEXT); }}
                maxLength={LIMITS.footer}
                placeholder="e.g. Everlast Wellness Center"
                dir={dir}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
              />
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none w-fit">
                <button
                  type="button"
                  role="switch"
                  aria-checked={optOutOn}
                  onClick={toggleOptOut}
                  className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer shrink-0 ${optOutOn ? "bg-brand" : "bg-gray-200"}`}
                >
                  <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-transform ${optOutOn ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
                </button>
                <span className="text-[12px] text-gray-500">Add opt-out notice to footer</span>
              </label>
            </div>
            )}

            {/* Buttons */}
            {!isCarousel && (
            <div className={fixRing("buttons")}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-gray-600">
                  Buttons{" "}
                  <span className="font-normal text-gray-400">
                    (optional, max 3)
                  </span>
                </label>
              </div>
              <div className="relative mb-3" ref={addButtonMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAddButtonMenu((v) => !v)}
                  disabled={buttons.length >= 3}
                  title={buttons.length >= 3 ? "Maximum 3 buttons reached" : undefined}
                  className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    showAddButtonMenu
                      ? "border-brand bg-brand-200 text-brand-fg"
                      : "border-brand/30 bg-brand-100 text-brand-fg hover:bg-brand-200"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Button
                </button>

                {showAddButtonMenu && (
                  <div className="absolute top-full left-0 mt-1.5 w-60 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1.5 overflow-hidden">
                    {(["QUICK_REPLY", "URL", "PHONE_NUMBER"] as TemplateButtonType[]).map((type) => {
                      const meta = BUTTON_TYPE_META[type];
                      const Icon = meta.icon;
                      const disabled = type === "QUICK_REPLY" ? !canAddQuickReply : type === "URL" ? !canAddUrl : !canAddPhone;
                      const reason =
                        type === "QUICK_REPLY"
                          ? (hasCTA ? "Can't mix with Call Number/URL buttons" : undefined)
                          : type === "URL"
                            ? (hasQuickReply ? "Can't mix with Quick Reply buttons" : urlCount >= 2 ? "Maximum 2 URL buttons" : undefined)
                            : (hasQuickReply ? "Can't mix with Quick Reply buttons" : phoneCount >= 1 ? "Maximum 1 Call Number button" : undefined);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => addButton(type)}
                          disabled={disabled}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          {Icon && <Icon className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" />}
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-gray-800">{meta.label}</span>
                            {reason && <span className="block text-[10.5px] text-gray-400 mt-0.5">{reason}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                {buttons.map((btn, i) => (
                  <div key={btn.id} className="border border-gray-200 rounded-xl p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 shrink-0 w-28">
                        {(() => { const M = BUTTON_TYPE_META[btn.type]?.icon; return M ? <M className="w-3 h-3" /> : null; })()}
                        {BUTTON_TYPE_META[btn.type]?.label ?? "Quick Reply"}
                      </span>
                      <input
                        type="text"
                        value={btn.title}
                        onChange={(e) => updateButton(i, { title: e.target.value.replace(/[{}]/g, "") })}
                        placeholder="Button name"
                        maxLength={LIMITS.button}
                        className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-800 outline-none focus:border-brand"
                      />
                      <CharCount val={btn.title} max={LIMITS.button} />
                      <button
                        type="button"
                        onClick={() => removeButton(i)}
                        className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {btn.type === "URL" && (
                      <input
                        type="url"
                        value={btn.url ?? ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          // Hard-block a 2nd placeholder rather than just
                          // flagging it after the fact — the keystroke that
                          // would exceed the limit is simply rejected.
                          if ((next.match(PLACEHOLDER_RE) || []).length > 1) return;
                          updateButton(i, { url: next });
                        }}
                        placeholder="https://example.com or https://example.com/{{1}}"
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-800 outline-none focus:border-brand font-mono"
                      />
                    )}
                    {btn.type === "PHONE_NUMBER" && (
                      <input
                        type="tel"
                        value={btn.phoneNumber ?? ""}
                        onChange={(e) => updateButton(i, { phoneNumber: e.target.value })}
                        placeholder="+971501234567"
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-800 outline-none focus:border-brand font-mono"
                      />
                    )}
                  </div>
                ))}
              </div>

              {(buttons.length > 0 || hasCTA || hasQuickReply) && (
                <div className={`mt-2.5 border rounded-xl px-3 py-2.5 space-y-1 ${buttonsError ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100"}`}>
                  <p className={`text-[11px] font-semibold ${buttonsError ? "text-red-600" : "text-gray-500"}`}>
                    {buttonsError ? buttonsError : "Points to remember"}
                  </p>
                  <ul className={`text-[11px] space-y-0.5 list-disc list-inside ${buttonsError ? "text-red-400" : "text-gray-400"}`}>
                    <li>3 Quick Reply buttons, OR up to 2 URL + 1 Call Number button — not both.</li>
                    <li>Maximum 25 characters per button name, no placeholders.</li>
                    <li>URL must start with http:// or https:// — at most 1 placeholder.</li>
                  </ul>
                </div>
              )}
            </div>
            )}

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}
          </form>
        </div>

        {/* Right — live preview */}
        <div className="w-[420px] shrink-0 border-l border-gray-100 bg-gray-50/60 px-6 py-6 flex flex-col overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-4">
            Live Preview
          </p>

          {/* As the customer's phone shows it — the template arrives on the left. */}
          <WaPhone chatClassName="min-h-[380px]">
            <WaTemplateMessage
              headerType={isCarousel ? "NONE" : headerType}
              header={renderPreview(header)}
              headerMediaUrl={headerMediaUrl}
              body={renderPreview(body)}
              placeholder="Your message will appear here…"
              footer={isCarousel ? null : renderPreview(footer)}
              buttons={isCarousel ? [] : visibleButtons}
              cards={isCarousel ? cards : null}
            />
          </WaPhone>

          {/* "Read more" warning — an estimate, see estimateWaLines */}
          {!isCarousel && body.trim() && estimateWaLines(body) > WA_FOLD_LINES && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700 leading-snug">
              <p className="font-semibold">Likely to show “Read more” on phones</p>
              <p className="mt-0.5">
                About {estimateWaLines(body)} lines on a phone — aim for {WA_FOLD_LINES} or fewer so the whole message shows. Remove blank
                lines, cut repeated words, and keep one idea per sentence.
              </p>
            </div>
          )}

          {/* Footer info */}
          <div className="flex justify-between items-center mt-3 px-0.5">
            <span className="text-[11px] text-gray-400">
              Renders for: Customer
            </span>
            <span
              className={`text-[11px] font-medium tabular-nums ${body.length > LIMITS.body ? "text-red-500" : "text-gray-400"}`}
            >
              {body.length}/{LIMITS.body}
            </span>
          </div>
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
        <button
          type="button"
          onClick={() => router.push("/templates")}
          className="py-2.5 px-5 rounded-xl border border-gray-200 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="tpl-form"
          disabled={saving || !!buttonsError}
          title={buttonsError ?? undefined}
          className="py-2.5 px-5 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-60 disabled:cursor-not-allowed text-[14px] font-semibold text-white cursor-pointer transition-colors"
        >
          {saving
            ? "Saving…"
            : isEditing
              ? "Save Changes"
              : "Create Template"}
        </button>
      </div>

      {showMediaPicker && (["IMAGE", "VIDEO", "DOCUMENT"] as TemplateHeaderType[]).includes(headerType) && (
        <MediaPicker
          mediaType={headerType as "IMAGE" | "VIDEO" | "DOCUMENT"}
          onCancel={() => setShowMediaPicker(false)}
          onSelect={(asset: MediaAsset) => {
            setHeaderMediaUrl(asset.url);
            setShowMediaPicker(false);
          }}
        />
      )}
    </div>
  );
}
