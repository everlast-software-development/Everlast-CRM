"use client";

import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Info, Lightbulb, Maximize2, ShieldAlert, X } from "lucide-react";

// The building blocks every documentation page is written with, so forty
// pages read as one guide. Text sizes and colours follow the app's own.

/** The language a bilingual page is showing. Every other page is English. */
export type DocLang = "en" | "ar";
/** Picks the English or the Arabic version of a piece of text. */
export type Tr = <X>(en: X, ar: X) => X;

const DocLangContext = createContext<DocLang>("en");
// Named after the first bilingual page (the agent guide), kept so readers who
// already chose Arabic there keep it on every bilingual page.
const LANG_KEY = "docs-agent-guide-lang";

/**
 * A page written in English and Arabic: an English / العربية switch on top,
 * remembered per browser and shared by every bilingual page. Arabic reads
 * right-to-left. Button and tab names stay in English, as they are in the app.
 */
export function Bilingual({ children }: { children: (t: Tr, lang: DocLang) => ReactNode }) {
  const [lang, setLang] = useState<DocLang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      // The reader's last choice, after hydration (the server renders English).
      if (saved === "ar" || saved === "en") startTransition(() => setLang(saved));
    } catch {}
  }, []);
  const choose = (l: DocLang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {}
  };
  const t: Tr = (en, ar) => (lang === "ar" ? ar : en);

  return (
    <DocLangContext.Provider value={lang}>
      <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
        <div className="inline-flex items-center bg-gray-100 rounded-xl p-1 mb-5" dir="ltr" role="group" aria-label="Language">
          {(["en", "ar"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => choose(l)}
              aria-pressed={lang === l}
              className={`text-[13px] font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer ${lang === l ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {l === "en" ? "English" : "العربية"}
            </button>
          ))}
        </div>
        {children(t, lang)}
      </div>
    </DocLangContext.Provider>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-gray-600 mb-6">{children}</p>;
}

export function H({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-[16px] font-bold text-gray-900 mt-9 mb-3 scroll-mt-4 first:mt-0">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-gray-700 mb-3">{children}</p>;
}

/** A button, tab or field name exactly as it appears in the app. */
export function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block font-semibold text-[12.5px] text-gray-800 bg-white border border-gray-200 rounded-md px-1.5 py-px mx-px whitespace-nowrap">
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block font-mono text-[11.5px] text-gray-700 bg-gray-50 border border-gray-200 border-b-2 rounded px-1.5 py-px mx-px">
      {children}
    </kbd>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12.5px] text-gray-800 bg-gray-100 rounded px-1 py-px">{children}</code>;
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="font-mono text-[12.5px] leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4 overflow-x-auto">
      {children}
    </pre>
  );
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mb-4 space-y-2.5">
      {items.map((step, i) => (
        <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-gray-700">
          <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center shrink-0 mt-px">
            {i + 1}
          </span>
          <div className="min-w-0 pt-0.5">{step}</div>
        </li>
      ))}
    </ol>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-4 space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-gray-700">
          <span className="w-1.5 h-1.5 rounded-full bg-brand/60 shrink-0 mt-[9px]" />
          <div className="min-w-0">{item}</div>
        </li>
      ))}
    </ul>
  );
}

const CALLOUT = {
  tip: { icon: Lightbulb, box: "bg-brand-50 border-brand-200", title: "text-brand-fg", label: { en: "Tip", ar: "نصيحة" } },
  note: { icon: Info, box: "bg-sky-50 border-sky-200", title: "text-sky-700", label: { en: "Good to know", ar: "معلومة مفيدة" } },
  warn: { icon: AlertTriangle, box: "bg-amber-50 border-amber-200", title: "text-amber-700", label: { en: "Watch out", ar: "انتبه" } },
  danger: { icon: ShieldAlert, box: "bg-red-50 border-red-200", title: "text-red-700", label: { en: "Important", ar: "مهم" } },
} as const;

export function Callout({ tone = "note", title, children }: { tone?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const lang = useContext(DocLangContext);
  const c = CALLOUT[tone];
  const Icon = c.icon;
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 mb-4 ${c.box}`}>
      <Icon className={`w-[18px] h-[18px] shrink-0 mt-0.5 ${c.title}`} />
      <div className="min-w-0 text-[13.5px] leading-relaxed text-gray-700">
        <p className={`font-semibold mb-0.5 ${c.title}`}>{title ?? c.label[lang]}</p>
        {children}
      </div>
    </div>
  );
}

export function Table({ head, rows, highlightCol }: { head: ReactNode[]; rows: ReactNode[][]; highlightCol?: number }) {
  return (
    <div className="mb-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {head.map((h, i) => (
              <th
                key={i}
                className={`text-start font-semibold text-gray-600 px-3.5 py-2.5 whitespace-nowrap ${i === highlightCol ? "bg-brand-100 text-brand-fg" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-gray-100 last:border-0 align-top">
              {row.map((cell, i) => (
                <td key={i} className={`px-3.5 py-2.5 text-gray-700 leading-relaxed ${i === highlightCol ? "bg-brand-50" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * How doc pages link to each other. The docs page provides `href` (which keeps
 * an admin's "view as" role) and `has` (whether the reader can see a page), so
 * a link to a page hidden from this role reads as plain text instead.
 */
export const DocLinksContext = createContext<{ href: (page: string) => string; has: (page: string) => boolean }>({
  href: (page) => `/docs?page=${page}`,
  has: () => true,
});

/** A link to another documentation page — plain text if the reader can't open it. */
export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  const { href, has } = useContext(DocLinksContext);
  if (!has(to)) return <span className="font-semibold text-gray-800">{children}</span>;
  return (
    <Link href={href(to)} scroll={false} className="font-semibold text-brand-fg hover:underline">
      {children}
    </Link>
  );
}

/** A small grid of linked cards — for overview pages. */
export function Tiles({ items }: { items: { to: string; title: string; text: string }[] }) {
  const { href } = useContext(DocLinksContext);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      {items.map((t) => (
        <Link
          key={t.to}
          href={href(t.to)}
          scroll={false}
          className="group rounded-xl border border-gray-200 bg-white px-4 py-3.5 hover:border-brand/40 hover:shadow-sm transition-all"
        >
          <p className="text-[14px] font-semibold text-gray-900 flex items-center gap-1.5">
            {t.title}
            <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-fg transition-colors" />
          </p>
          <p className="text-[12.5px] text-gray-500 mt-0.5 leading-relaxed">{t.text}</p>
        </Link>
      ))}
    </div>
  );
}

/**
 * A screenshot from public/docs/screenshots (captured by
 * `npm run docs:screenshots` against the demo data). Click to see it full size.
 */
export function Shot({ name, alt, caption }: { name: string; alt: string; caption?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const src = `/docs/screenshots/${name}.png`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <figure className="mb-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm cursor-zoom-in"
        aria-label={`Enlarge: ${alt}`}
      >
        <Image src={src} alt={alt} width={1440} height={900} sizes="(min-width: 1024px) 768px, 100vw" className="w-full h-auto" />
        <span className="absolute top-2.5 right-2.5 w-8 h-8 rounded-lg bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-4 h-4" />
        </span>
      </button>
      {caption && <figcaption className="text-[12.5px] text-gray-500 mt-2 text-center leading-relaxed">{caption}</figcaption>}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 sm:p-8 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <Image src={src} alt={alt} width={1440} height={900} sizes="100vw" className="max-h-full w-auto h-auto rounded-lg shadow-2xl" />
        </div>
      )}
    </figure>
  );
}

// Role names (model.ts ROLE_LABEL) as an Arabic page shows them.
const ROLE_LABEL_AR: Record<string, string> = {
  Admin: "مدير النظام",
  Director: "المدير",
  Supervisor: "مشرف",
  Agent: "موظف",
  Marketing: "التسويق",
};

/** Small role pills, e.g. "Who: Admin · Supervisor". */
export function Who({ roles }: { roles: string[] }) {
  const lang = useContext(DocLangContext);
  if (roles.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-5 -mt-2">
      <span className="text-[12px] text-gray-400">{lang === "ar" ? "من يستخدم هذه الصفحة:" : "Who can use this:"}</span>
      {roles.map((r) => (
        <span key={r} className="text-[11.5px] font-semibold text-brand-fg bg-brand-100 rounded-full px-2 py-0.5">
          {lang === "ar" ? ROLE_LABEL_AR[r] ?? r : r}
        </span>
      ))}
    </div>
  );
}
