"use client";

import { createContext, useContext, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCheck,
  CornerUpLeft,
  EllipsisVertical,
  ExternalLink,
  Image as ImageIcon,
  List,
  Phone,
  Play,
  Video,
  X,
} from "lucide-react";
import type { TemplateButton, TemplateCard, TemplateHeaderType } from "@/types";
import { WaText, WA_CHARS_PER_LINE, WA_FOLD_LINES, estimateWaLines } from "@/components/templates/shared";

// One set of WhatsApp look-alike pieces for every message preview — template
// maker, campaign wizard, template cards and the flow simulator — drawn as the
// CUSTOMER's phone shows it: the business message arrives on the left.
//
// Colours are explicit hex (WhatsApp's own palette) rather than gray/white
// tokens, because the app's dark theme remaps those tokens and would tint the
// preview away from what WhatsApp actually looks like.

const BUBBLE = "bg-[#fff] dark:bg-[#202c33]";
const OUT_BUBBLE = "bg-[#d9fdd3] dark:bg-[#005c4b]";
const INK = "text-[#111b21] dark:text-[#e9edef]";
const MUTED = "text-[#667781] dark:text-[#8696a0]";
const LINK = "text-[#027eb5] dark:text-[#53bdeb]";
const DIVIDER = "border-[#e9edef] dark:border-[#2a3942]";
const SHADOW = "shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]";
const PRESS = "enabled:hover:bg-[#f5f6f6] dark:enabled:hover:bg-[#26353d] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
const TEXT = "text-[14.2px] leading-[19px]";
// A faint dot grid stands in for WhatsApp's doodle wallpaper; grey at low
// alpha reads on both the light and the dark canvas.
const WALLPAPER = "bg-[#efeae2] dark:bg-[#0b141a]";
const WALLPAPER_STYLE = {
  backgroundImage: "radial-gradient(rgba(128,128,128,0.09) 1px, transparent 1.5px)",
  backgroundSize: "14px 14px",
};

export const WA_TIME = "12:45";

// ── Text ──────────────────────────────────────────────────────────────────────

// WhatsApp picks a line's direction from its first strong character, which is
// what dir="auto" does — this mirrors it so the timestamp can dodge RTL text.
const STRONG_RE = /[A-Za-zÀ-ʯͰ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]/;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
function isRtl(line: string): boolean {
  const m = STRONG_RE.exec(line);
  return !!m && RTL_RE.test(m[0]);
}
const lastLine = (s: string) => s.split("\n").pop() ?? "";

// WhatsApp turns "* item" / "- item" at the start of a line into a bullet.
const BULLET_RE = /^\s*[*-]\s+(.*)$/;

/** Message text, line by line: formatting, bullets, and per-line direction. */
export function WaBody({ text, trailing }: { text: string; trailing?: ReactNode }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const end = i === lines.length - 1 ? trailing : null;
        const m = BULLET_RE.exec(line);
        if (m) {
          return (
            <div key={i} dir="auto" className="flex gap-2">
              <span aria-hidden>•</span>
              <span className="min-w-0"><WaText text={m[1]} />{end}</span>
            </div>
          );
        }
        // An empty line still takes a line's height, like a blank line on the phone.
        return <div key={i} dir="auto" className="min-h-[19px]"><WaText text={line} />{end}</div>;
      })}
    </>
  );
}

// Cuts text to roughly WA_FOLD_LINES phone lines, using the same per-line
// estimate as estimateWaLines so "Read more" appears exactly when the editor's
// warning does.
function foldText(text: string): string {
  const out: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const cost = Math.max(1, Math.ceil([...line.replace(/[*_~`]/g, "").trim()].length / WA_CHARS_PER_LINE));
    if (used + cost > WA_FOLD_LINES) {
      const room = WA_FOLD_LINES - used;
      // Leave space on the last line for "… Read more".
      if (room > 0) out.push([...line].slice(0, room * WA_CHARS_PER_LINE - 12).join("").replace(/\s+\S*$/, ""));
      break;
    }
    used += cost;
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

// ── Phone chrome ──────────────────────────────────────────────────────────────

// Sheets (list options, "See all options") cover the chat viewport, not the
// page, so the chat publishes its outer box for them to portal into.
const SheetHost = createContext<HTMLElement | null>(null);

/** WhatsApp chat canvas. Scrolls its content; sheets open over it. */
export function WaChat({
  children,
  className = "",
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  /** The scrolling element, e.g. for auto-scrolling to the newest message. */
  scrollRef?: Ref<HTMLDivElement>;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <SheetHost.Provider value={host}>
      <div ref={setHost} className={`relative flex flex-col min-h-0 overflow-hidden ${WALLPAPER} ${className}`} style={WALLPAPER_STYLE}>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-black/15 [&::-webkit-scrollbar-thumb]:rounded-full">
          {children}
        </div>
      </div>
    </SheetHost.Provider>
  );
}

/** The chat's title bar: the business as the customer sees it. */
export function WaHeader({
  name = "Everlast Wellness",
  subtitle = "Business account",
  actions,
}: {
  name?: string;
  subtitle?: ReactNode;
  /** Replaces the decorative call / menu icons (e.g. the simulator's controls). */
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 h-14 px-3 shrink-0 bg-[#008069] dark:bg-[#202c33] text-[#fff] dark:text-[#e9edef]">
      <ArrowLeft className="w-5 h-5 shrink-0 opacity-90" aria-hidden />
      <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center bg-[#fff] text-[#008069] dark:bg-[#00a884] dark:text-[#fff] text-[15px] font-bold">
        {name.trim().charAt(0).toUpperCase() || "E"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[15px] font-semibold leading-tight">
          <span className="truncate">{name}</span>
          <BadgeCheck className="w-4 h-4 shrink-0 fill-[#fff] text-[#008069] dark:fill-[#25d366] dark:text-[#202c33]" aria-label="Verified business" />
        </p>
        <p className="text-[12px] leading-tight opacity-80 truncate">{subtitle}</p>
      </div>
      {actions ?? (
        <div className="flex items-center gap-4 opacity-90 shrink-0" aria-hidden>
          <Video className="w-5 h-5" />
          <Phone className="w-[18px] h-[18px]" />
          <EllipsisVertical className="w-5 h-5" />
        </div>
      )}
    </div>
  );
}

/** Header bar + chat canvas, framed like a phone screen. */
export function WaPhone({
  children,
  className = "",
  chatClassName = "min-h-[340px]",
  subtitle,
}: {
  children: ReactNode;
  className?: string;
  chatClassName?: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className={`flex flex-col shrink-0 overflow-hidden rounded-2xl border border-[#d1d7db] dark:border-[#222d34] shadow-sm ${className}`}>
      <WaHeader subtitle={subtitle} />
      <WaChat className={`flex-1 ${chatClassName}`}>{children}</WaChat>
    </div>
  );
}

// ── Bottom sheet ──────────────────────────────────────────────────────────────

function WaSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const host = useContext(SheetHost);
  const sheet = (
    <div className={`${host ? "absolute" : "fixed"} inset-0 z-30 flex flex-col justify-end bg-[#0b141a]/40`} onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`${BUBBLE} rounded-t-2xl max-h-[80%] flex flex-col shadow-[0_-2px_8px_rgba(0,0,0,0.15)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[#d1d7db] dark:bg-[#3b4a54]" />
        <div className="flex items-center px-3 py-2.5">
          <button type="button" onClick={onClose} title="Close" className={`w-8 h-8 rounded-full flex items-center justify-center ${MUTED} hover:bg-black/5 cursor-pointer`}>
            <X className="w-5 h-5" />
          </button>
          <p dir="auto" className={`flex-1 text-center text-[16px] font-medium truncate ${INK}`}>{title}</p>
          <span className="w-8" />
        </div>
        <div className="overflow-y-auto pb-2">{children}</div>
      </div>
    </div>
  );
  return host ? createPortal(sheet, host) : sheet;
}

// ── Buttons under a message ───────────────────────────────────────────────────

export type WaAction = {
  key: string;
  kind: "reply" | "url" | "phone" | "list";
  label: string;
  /** Opens in a new tab. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

const ACTION_ICON = { reply: CornerUpLeft, url: ExternalLink, phone: Phone, list: List };

function WaStrip({ action }: { action: WaAction }) {
  const Icon = ACTION_ICON[action.kind];
  const cls = `flex w-full min-w-0 items-center justify-center gap-1.5 h-10 px-3 border-t ${DIVIDER} ${LINK} text-[14px] font-medium`;
  const inner = (
    <>
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span dir="auto" className="whitespace-nowrap truncate">{action.label || "Button"}</span>
    </>
  );
  if (action.href && !action.disabled) {
    return <a href={action.href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-[#f5f6f6] dark:hover:bg-[#26353d]`}>{inner}</a>;
  }
  if (action.onClick) {
    return <button type="button" disabled={action.disabled} onClick={action.onClick} className={`${cls} ${PRESS}`}>{inner}</button>;
  }
  return <div className={cls}>{inner}</div>;
}

/**
 * The full-width strips WhatsApp attaches under a message. Past three, it shows
 * the first two and a "See all options" strip that opens the whole set.
 */
export function WaActions({ actions, collapse = true }: { actions: WaAction[]; collapse?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  const folded = collapse && actions.length > 3;
  const shown = folded ? actions.slice(0, 2) : actions;
  return (
    <>
      {shown.map((a) => <WaStrip key={a.key} action={a} />)}
      {folded && <WaStrip action={{ key: "__all", kind: "list", label: "See all options", onClick: () => setOpen(true) }} />}
      {open && (
        <WaSheet title="All options" onClose={() => setOpen(false)}>
          {actions.map((a) => {
            const Icon = ACTION_ICON[a.kind];
            const cls = `flex w-full items-center gap-4 px-5 py-3 text-left ${LINK} text-[15px]`;
            const inner = <><Icon className="w-5 h-5 shrink-0" aria-hidden /><span dir="auto" className="truncate">{a.label || "Button"}</span></>;
            if (a.href && !a.disabled) {
              return <a key={a.key} href={a.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={`${cls} hover:bg-[#f5f6f6] dark:hover:bg-[#26353d]`}>{inner}</a>;
            }
            return (
              <button key={a.key} type="button" disabled={a.disabled || !a.onClick} onClick={() => { a.onClick?.(); setOpen(false); }} className={`${cls} ${PRESS}`}>
                {inner}
              </button>
            );
          })}
        </WaSheet>
      )}
    </>
  );
}

// ── Media ─────────────────────────────────────────────────────────────────────

/** A message's media header — image, video (play overlay) or document row. */
export function WaMedia({ type, url, className = "" }: { type?: string | null; url?: string | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const box = `rounded-[6px] overflow-hidden ${className}`;
  if (type === "IMAGE") {
    return url && broken !== url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" onError={() => setBroken(url)} className={`${box} block w-full aspect-[1.91/1] object-cover bg-[#dfe5e7] dark:bg-[#2a3942]`} />
    ) : (
      <div className={`${box} w-full aspect-[1.91/1] flex items-center justify-center bg-[#dfe5e7] dark:bg-[#2a3942] text-[#8696a0]`}>
        <ImageIcon className="w-8 h-8" aria-hidden />
      </div>
    );
  }
  if (type === "VIDEO") {
    return (
      <div className={`${box} relative w-full aspect-[1.91/1] bg-[#1f2c34]`}>
        {/* The first frame stands in for WhatsApp's thumbnail. */}
        {url && <video src={url} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-12 h-12 rounded-full bg-[#0b141a]/55 flex items-center justify-center">
            <Play className="w-6 h-6 ml-0.5 fill-[#fff] text-[#fff]" aria-hidden />
          </span>
        </span>
      </div>
    );
  }
  if (type === "DOCUMENT") {
    const file = url ? decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "") : "";
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(file)?.[1] || "pdf").toUpperCase();
    return (
      <div className={`${box} flex items-center gap-2.5 px-2.5 py-2.5 bg-[#f5f6f6] dark:bg-[#1d282f]`}>
        <span className="relative w-[26px] h-[32px] shrink-0 rounded-[3px] bg-[#fff] dark:bg-[#e9edef] border border-[#d1d7db] dark:border-transparent" aria-hidden>
          <span className="absolute left-0 right-0 bottom-[5px] bg-[#e5463d] text-[#fff] text-[7px] font-bold leading-[10px] text-center">{ext.slice(0, 4)}</span>
        </span>
        <div className="min-w-0">
          <p className={`text-[14px] leading-tight truncate ${INK}`}>{file || "Document"}</p>
          <p className={`text-[12px] leading-tight mt-0.5 ${MUTED}`}>{ext}</p>
        </div>
      </div>
    );
  }
  return null;
}

// ── Bubbles ───────────────────────────────────────────────────────────────────

// WhatsApp's bubble tail, from its web client. Drawn outside the box at the
// top corner of the first message in a run.
function Tail({ side, className }: { side: "in" | "out"; className: string }) {
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden className={`absolute top-0 ${side === "in" ? "-left-2" : "-right-2 -scale-x-100"} ${className}`}>
      <path d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
    </svg>
  );
}

/** An incoming (business) message as the customer's phone shows it. */
export function WaBubble({
  tail = true,
  media,
  title,
  text,
  placeholder,
  footer,
  actions = [],
  collapseActions = true,
  time = WA_TIME,
}: {
  /** First message in a run — gets the corner tail. */
  tail?: boolean;
  media?: { type?: string | null; url?: string | null };
  /** Bold text header. */
  title?: string;
  text?: string;
  /** Shown greyed when there's no text yet. */
  placeholder?: string;
  footer?: string;
  actions?: WaAction[];
  collapseActions?: boolean;
  time?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMedia = !!media?.type && media.type !== "NONE";
  const folds = !!text && !expanded && estimateWaLines(text) > WA_FOLD_LINES;
  const shown = folds ? foldText(text) : text;

  // The time sits in the bottom-right corner, with an invisible spacer at the
  // end of the last line so text wraps around it, as on the phone. When that
  // line is right-to-left its end is on the left, so the time takes its own row.
  const last = footer ? "footer" : shown || placeholder ? "body" : title ? "title" : null;
  const lastText = last === "footer" ? footer! : last === "body" ? (folds ? "Read more" : shown || placeholder!) : last === "title" ? title! : "";
  const inlineTime = last !== null && !isRtl(lastLine(lastText));
  const spacer = inlineTime ? <span aria-hidden className="inline-block w-[38px]" /> : null;
  const readMore = folds ? (
    <>
      {"… "}
      <button type="button" onClick={() => setExpanded(true)} className={`${LINK} font-medium cursor-pointer hover:underline`}>Read more</button>
    </>
  ) : null;

  return (
    <div className={`relative ${hasMedia ? "w-[85%] max-w-[330px]" : "w-fit max-w-[85%] min-w-[90px]"}`}>
      {tail && <Tail side="in" className="fill-[#fff] dark:fill-[#202c33]" />}
      <div className={`${BUBBLE} ${SHADOW} rounded-lg ${tail ? "rounded-tl-none" : ""} overflow-hidden`}>
        <div className={`relative ${hasMedia ? "p-[3px]" : "px-2 pt-1.5"} ${inlineTime ? "pb-2" : "pb-1"}`}>
          {hasMedia && <WaMedia type={media!.type} url={media!.url} />}
          <div className={`${hasMedia ? "px-[5px] pt-1.5" : ""} ${TEXT} ${INK} whitespace-pre-wrap break-words`}>
            {title && (
              <div dir="auto" className="text-[15px] font-bold leading-[20px] mb-0.5">
                {title}{last === "title" && spacer}
              </div>
            )}
            {shown ? (
              <WaBody text={shown} trailing={last === "body" ? <>{readMore}{spacer}</> : readMore} />
            ) : placeholder ? (
              <div dir="auto" className={`italic ${MUTED}`}>{placeholder}{last === "body" && spacer}</div>
            ) : null}
            {footer && (
              <div dir="auto" className={`mt-1 text-[13px] leading-[17px] ${MUTED}`}>{footer}{spacer}</div>
            )}
          </div>
          {inlineTime ? (
            <span className={`absolute bottom-[5px] right-[7px] text-[11px] leading-none ${MUTED}`}>{time}</span>
          ) : (
            <div className={`flex justify-end ${hasMedia ? "px-[5px] pb-[3px]" : ""} mt-0.5 text-[11px] leading-none ${MUTED}`}>{time}</div>
          )}
        </div>
        <WaActions actions={actions} collapse={collapseActions} />
      </div>
    </div>
  );
}

/** The customer's own message — right side, green, read ticks. */
export function WaOutgoing({ text, tail = true, time = WA_TIME }: { text: string; tail?: boolean; time?: string }) {
  const inlineTime = !isRtl(lastLine(text));
  return (
    <div className="flex justify-end">
      <div className="relative w-fit max-w-[85%] min-w-[90px]">
        {tail && <Tail side="out" className="fill-[#d9fdd3] dark:fill-[#005c4b]" />}
        <div className={`relative ${OUT_BUBBLE} ${SHADOW} rounded-lg ${tail ? "rounded-tr-none" : ""} px-2 pt-1.5 ${inlineTime ? "pb-2" : "pb-1"} ${TEXT} ${INK} whitespace-pre-wrap break-words`}>
          <WaBody text={text} trailing={inlineTime ? <span aria-hidden className="inline-block w-[56px]" /> : null} />
          <span className={`${inlineTime ? "absolute bottom-[5px] right-[7px] inline-flex" : "flex justify-end mt-0.5"} items-center gap-1 text-[11px] leading-none ${MUTED}`}>
            {time}
            <CheckCheck className="w-4 h-4 text-[#53bdeb]" aria-label="Read" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Centred system note (WhatsApp's date / security chips). */
export function WaSystemNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "end" }) {
  const cls =
    tone === "warn" ? "bg-[#ffeecd] text-[#6b5200] dark:bg-[#3b3220] dark:text-[#f5d58b]"
    : tone === "end" ? "bg-[#54656f] text-[#fff] dark:bg-[#2a3942] dark:text-[#e9edef]"
    : "bg-[#fff] text-[#54656f] dark:bg-[#182229] dark:text-[#8696a0]";
  return (
    <div className="flex justify-center">
      <span className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-center text-[12px] leading-snug ${SHADOW} ${cls}`}>{children}</span>
    </div>
  );
}

// ── List message ──────────────────────────────────────────────────────────────

export type WaListRow = { key: string; title: string; description?: string; onSelect?: () => void; disabled?: boolean };

/** A list message: the text, a "View options"-style strip, and its sheet of rows. */
export function WaListMessage({
  tail,
  title,
  text,
  footer,
  label,
  rows,
}: {
  tail?: boolean;
  title?: string;
  text?: string;
  footer?: string;
  label: string;
  rows: WaListRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <WaBubble
        tail={tail}
        title={title}
        text={text}
        footer={footer}
        actions={[{ key: "list", kind: "list", label: label || "View options", onClick: () => setOpen(true) }]}
      />
      {open && (
        <WaSheet title={label || "Options"} onClose={() => setOpen(false)}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              disabled={r.disabled || !r.onSelect}
              onClick={() => { setOpen(false); r.onSelect?.(); }}
              className={`flex w-full items-center gap-3 px-5 py-3 text-left border-b last:border-b-0 ${DIVIDER} ${PRESS}`}
            >
              <span className="min-w-0 flex-1" dir="auto">
                <span className={`block text-[15px] leading-snug ${INK}`}><WaText text={r.title || "Option"} /></span>
                {r.description && <span className={`block text-[13px] leading-snug mt-0.5 ${MUTED}`}><WaText text={r.description} /></span>}
              </span>
              <span className="w-5 h-5 shrink-0 rounded-full border-2 border-[#8696a0]" aria-hidden />
            </button>
          ))}
          {rows.length === 0 && <p className={`px-5 py-4 text-[13px] ${MUTED}`}>No options yet.</p>}
        </WaSheet>
      )}
    </>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────────

export type WaCardSpec = {
  key: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  body?: string;
  placeholder?: string;
  actions: WaAction[];
};

/** Horizontally scrolling cards (carousel template / product cards). */
export function WaCarousel({ cards }: { cards: WaCardSpec[] }) {
  return (
    <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 snap-x snap-mandatory scroll-px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {cards.map((c) => (
        <div key={c.key} className={`snap-start shrink-0 w-[240px] flex flex-col rounded-lg overflow-hidden ${BUBBLE} ${SHADOW}`}>
          <div className="p-[3px] pb-0">
            <WaMedia type={c.mediaType || "IMAGE"} url={c.mediaUrl} />
          </div>
          <div className={`flex-1 px-2 pt-1.5 pb-2 ${TEXT} ${INK} whitespace-pre-wrap break-words`}>
            {c.body ? <WaBody text={c.body} /> : <div dir="auto" className={`italic ${MUTED}`}>{c.placeholder || "Card text"}</div>}
          </div>
          <WaActions actions={c.actions} collapse={false} />
        </div>
      ))}
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATE_KIND: Record<string, WaAction["kind"]> = { QUICK_REPLY: "reply", URL: "url", PHONE_NUMBER: "phone" };

export function templateActions(buttons: Pick<TemplateButton, "id" | "type" | "title">[]): WaAction[] {
  return buttons.map((b, i) => ({ key: b.id || String(i), kind: TEMPLATE_KIND[b.type] ?? "reply", label: b.title }));
}

/**
 * A message template as received: header, body, footer and buttons — or, for a
 * carousel template, the body bubble with its cards underneath. Text should
 * already have its placeholders filled the way the caller wants them shown.
 */
export function WaTemplateMessage({
  headerType = "NONE",
  header,
  headerMediaUrl,
  body,
  placeholder,
  footer,
  buttons = [],
  cards,
}: {
  headerType?: TemplateHeaderType | null;
  header?: string | null;
  headerMediaUrl?: string | null;
  body: string;
  placeholder?: string;
  footer?: string | null;
  buttons?: TemplateButton[];
  cards?: TemplateCard[] | null;
}) {
  if (cards?.length) {
    return (
      <div className="space-y-1.5">
        {(body.trim() || placeholder) && <WaBubble text={body.trim() ? body : undefined} placeholder={placeholder} />}
        <WaCarousel
          cards={cards.map((c, i) => ({
            key: String(i),
            mediaType: c.mediaType,
            mediaUrl: c.mediaUrl,
            body: c.body.trim() ? c.body : undefined,
            actions: templateActions(c.buttons),
          }))}
        />
      </div>
    );
  }
  const mediaHeader = headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT";
  return (
    <WaBubble
      media={mediaHeader ? { type: headerType, url: headerMediaUrl } : undefined}
      title={headerType === "TEXT" && header?.trim() ? header : undefined}
      text={body.trim() ? body : undefined}
      placeholder={placeholder}
      footer={footer?.trim() ? footer : undefined}
      actions={templateActions(buttons)}
    />
  );
}
