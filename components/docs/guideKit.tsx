"use client";

import Image from "next/image";

import type { DocLang as Lang } from "./primitives";

// What the quick guides (agent, supervisor) share: screenshots with numbered
// arrows drawn over them, so one image serves both languages; the numbered
// list under each one says the same thing in full. The language itself comes
// from Bilingual (primitives.tsx).

export type T = { en: string; ar: string };

/** One arrow: a numbered label at (lx, ly) pointing at (x, y), all in % of the image. */
export interface Note {
  x: number;
  y: number;
  lx: number;
  ly: number;
  label: T;
  more: T;
}

// The screenshots are 1440×900 (16:10): the SVG is 100 × 62.5 so arrows keep their shape.
const H_RATIO = 0.625;

export function AnnotatedShot({ name, alt, notes, lang }: { name: string; alt: string; notes: Note[]; lang: Lang }) {
  const src = `/docs/screenshots/${name}.png`;
  return (
    <figure className="mb-7">
      <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" dir="ltr">
        <Image src={src} alt={alt} width={1440} height={900} sizes="(min-width: 1024px) 900px, 100vw" className="w-full h-auto" />
        <svg viewBox={`0 0 100 ${100 * H_RATIO}`} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          <defs>
            <marker id={`head-${name}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#E11D48" />
            </marker>
          </defs>
          {notes.map((n, i) => (
            <g key={i}>
              <line x1={n.lx} y1={n.ly * H_RATIO} x2={n.x} y2={n.y * H_RATIO} stroke="white" strokeWidth="0.75" strokeLinecap="round" />
              <line x1={n.lx} y1={n.ly * H_RATIO} x2={n.x} y2={n.y * H_RATIO} stroke="#E11D48" strokeWidth="0.35" strokeLinecap="round" markerEnd={`url(#head-${name})`} />
            </g>
          ))}
        </svg>
        {notes.map((n, i) => (
          <span
            key={i}
            dir={lang === "ar" ? "rtl" : "ltr"}
            className="absolute -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-rose-600 text-white shadow-md ring-2 ring-white px-1 sm:pe-2.5 py-0.5 text-[11px] sm:text-[12px] font-semibold whitespace-nowrap"
            style={{ left: `${n.lx}%`, top: `${n.ly}%` }}
          >
            <span className="w-5 h-5 rounded-full bg-white text-rose-600 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="hidden sm:inline">{n.label[lang]}</span>
          </span>
        ))}
      </div>
      <ol className="mt-3 space-y-1.5">
        {notes.map((n, i) => (
          <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-gray-700">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <span className="min-w-0">
              <b className="text-gray-900">{n.label[lang]}</b> — {n.more[lang]}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
