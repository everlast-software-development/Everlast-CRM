"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, X } from "lucide-react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { FlowGraph, FlowNode, FlowOption, Template } from "@/types";
import { flowCardLabel } from "@/lib/flows";
import { WaBubble, WaCarousel, WaChat, WaHeader, WaListMessage, WaOutgoing, WaSystemNote, type WaAction } from "@/components/whatsapp/WaPreview";

// A dry run of the flow being edited — unsaved changes included. It walks the
// graph with the same rules as the server's engine (utils/flowEngine.js) but
// sends nothing to WhatsApp and saves nothing: a safe way to click through
// every branch before a real campaign goes out.

type Item =
  | { kind: "bot"; nodeId?: string; text?: string; mediaType?: string; mediaUrl?: string; footer?: string; header?: string; buttons?: FlowOption[]; link?: { title: string; url: string }; list?: { label: string; rows: FlowOption[] }; cards?: SimCard[] }
  | { kind: "user"; text: string }
  | { kind: "event"; text: string; tone?: "info" | "warn" | "end" };

type SimCard = {
  label: string;
  body?: string;
  mediaType?: string;
  mediaUrl?: string;
  // id is "<cardIndex>.<buttonId>" for quick replies; links just show.
  taps: FlowOption[];
  links: { title: string; url?: string }[];
};

type Waiting =
  | { kind: "start" }
  | { kind: "carousel"; nodeId: string }
  | { kind: "buttons"; nodeId: string; options: FlowOption[] }
  | { kind: "list"; nodeId: string; options: FlowOption[]; label: string }
  | { kind: "question"; nodeId: string }
  | null;

const MAX_STEPS = 25;

function interpolate(text: string | undefined, name: string, answers: Record<string, string>): string {
  if (!text) return "";
  const vars: Record<string, string> = {
    first_name: name.split(" ")[0] || "there",
    customer_name: name || "there",
    name: name || "there",
    phone: "+971500000000",
    ...answers,
  };
  return text.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (full, k: string) => {
    const v = vars[k.toLowerCase()];
    if (v === undefined) return full;
    // Same as the server: a collected date reads as "15 Oct 2026".
    return /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      : v;
  });
}

// Same rules as the server's parseAnswer.
function parseAnswer(type: string | undefined, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (type) {
    case "number": {
      const n = v.replace(/,/g, "");
      return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    case "phone": {
      const p = parsePhoneNumberFromString(v, "AE");
      return p && p.isValid() ? p.number : null;
    }
    case "date": {
      let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
      let y: number, mo: number, d: number;
      if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
      else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
      return dt.toISOString().slice(0, 10);
    }
    default:
      return v;
  }
}

const RETRY: Record<string, string> = {
  number: "Please reply with a number.",
  email: "That doesn't look like an email address — please try again.",
  phone: "Please send a valid phone number.",
  date: "Please send the date as DD/MM/YYYY.",
  text: "Please type your answer.",
};

export function FlowSimulator({
  graph,
  templates = [],
  onClose,
  onActiveNode,
}: {
  graph: FlowGraph;
  /** For showing a carousel step's real cards (image, text, links). */
  templates?: Template[];
  onClose: () => void;
  /** The step the run is parked on, so the canvas can highlight it. */
  onActiveNode?: (id: string | null) => void;
}) {
  const [name, setName] = useState("Sara Ahmed");
  const [items, setItems] = useState<Item[]>([]);
  const [waiting, setWaiting] = useState<Waiting>({ kind: "start" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  // After a hand-off the bot stays out: old buttons go to the agent.
  const [handedOff, setHandedOff] = useState(false);
  const handedOffRef = useRef(false); // set while walking, applied in settle()
  const scrollRef = useRef<HTMLDivElement>(null);

  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const startButtons = trigger?.data.buttons || [];
  const hasAny = graph.edges.some((e) => e.source === trigger?.id && e.sourceHandle === "any");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const node = (id: string | null) => (id ? graph.nodes.find((n) => n.id === id) ?? null : null);
  const next = (id: string, handle: string) =>
    graph.edges.find((e) => e.source === id && (e.sourceHandle || "next") === handle)?.target ?? null;

  // Execute from a step until something waits for the customer, or the run ends.
  function walk(startId: string | null, ans: Record<string, string>, out: Item[]): Waiting {
    let id = startId;
    for (let i = 0; i < MAX_STEPS; i++) {
      const n: FlowNode | null = node(id);
      if (!n) {
        out.push({ kind: "event", text: "Flow ended — nothing is connected after this point.", tone: "end" });
        return null;
      }
      const d = n.data;
      const say = (t?: string) => interpolate(t, name, ans);
      switch (n.type) {
        case "message": {
          out.push({ kind: "bot", nodeId: n.id, text: say(d.text), mediaType: d.mediaType, mediaUrl: d.mediaUrl, footer: d.footer, buttons: d.buttons, link: d.link });
          if (d.buttons && d.buttons.length) return { kind: "buttons", nodeId: n.id, options: d.buttons };
          id = next(n.id, "next");
          break;
        }
        case "list":
          out.push({ kind: "bot", nodeId: n.id, text: say(d.text), header: d.header ? say(d.header) : undefined, footer: d.footer, list: { label: d.buttonLabel || "Options", rows: d.rows || [] } });
          return { kind: "list", nodeId: n.id, options: d.rows || [], label: d.buttonLabel || "Options" };
        case "carousel": {
          const tpl = templates.find((t) => t.id === d.templateId);
          const cards: SimCard[] = (d.cards || []).map((c, ci) => {
            const real = tpl?.cards?.[ci];
            return {
              label: c.label ?? `Card ${ci + 1}`,
              body: real?.body,
              mediaType: real?.mediaType,
              mediaUrl: real?.mediaUrl,
              taps: c.buttons.map((b) => ({ id: `${ci}.${b.id}`, title: b.title })),
              links: (real?.buttons || []).filter((b) => b.type === "URL").map((b) => ({ title: b.title, url: b.url })),
            };
          });
          if (!cards.length) {
            out.push({ kind: "event", text: "This Carousel step has no template chosen.", tone: "warn" });
            return null;
          }
          out.push({ kind: "bot", nodeId: n.id, text: tpl ? interpolate(tpl.body, name, ans) : undefined, cards });
          if (tpl && tpl.approvalStatus !== "APPROVED") {
            out.push({ kind: "event", text: `“${tpl.name}” isn't approved by Meta yet — for real customers this step would fail until it is.`, tone: "warn" });
          }
          if (cards.some((c) => c.taps.length)) return { kind: "carousel", nodeId: n.id };
          id = next(n.id, "next");
          break;
        }
        case "cards": {
          const cards: SimCard[] = (d.cards || []).map((c, ci) => ({
            label: flowCardLabel(c, ci),
            body: c.body ? say(c.body) : undefined,
            mediaType: c.mediaType,
            mediaUrl: c.mediaUrl,
            taps: c.buttons.filter((b) => b.type !== "URL").map((b) => ({ id: `${c.id}.${b.id}`, title: b.title })),
            links: c.buttons.filter((b) => b.type === "URL").map((b) => ({ title: b.title, url: b.url })),
          }));
          out.push({ kind: "bot", nodeId: n.id, text: say(d.text), cards });
          if (cards.some((c) => c.taps.length)) return { kind: "carousel", nodeId: n.id };
          id = next(n.id, "next");
          break;
        }
        case "question":
          out.push({ kind: "bot", text: say(d.text) });
          return { kind: "question", nodeId: n.id };
        case "slot_picker":
          // Retired Pick appointment step in an older flow: the server hands the
          // patient to the team when a run reaches one, so it stops like a hand-off.
          out.push({ kind: "event", text: "Reached a Pick appointment step, which is no longer available — delete it to save this flow.", tone: "warn" });
          out.push({ kind: "event", text: "Handed to the team — the chat would now appear in the Unassigned queue. Automation stops.", tone: "end" });
          handedOffRef.current = true;
          return null;
        case "tag":
          out.push({ kind: "event", text: `Tag added to the customer: “${d.tag || "—"}”` });
          id = next(n.id, "next");
          break;
        case "assign":
          if (d.text) out.push({ kind: "bot", text: say(d.text) });
          out.push({ kind: "event", text: "Handed to an agent — the chat would now appear in their inbox. Automation stops; older buttons now go to the agent too.", tone: "end" });
          handedOffRef.current = true;
          return null;
        case "end":
          if (d.text) out.push({ kind: "bot", text: say(d.text) });
          out.push({ kind: "event", text: "Flow completed.", tone: "end" });
          return null;
        default:
          return null;
      }
    }
    out.push({ kind: "event", text: `Stopped after ${MAX_STEPS} steps without waiting for the customer — the flow probably loops.`, tone: "warn" });
    return null;
  }

  function settle(out: Item[], w: Waiting, ans: Record<string, string>) {
    if (handedOffRef.current) {
      handedOffRef.current = false;
      setHandedOff(true);
    }
    setItems((prev) => [...prev, ...out]);
    setWaiting(w);
    setAnswers(ans);
    onActiveNode?.(w && w.kind !== "start" ? w.nodeId : null);
  }

  function tapStart(option: FlowOption | null, typed?: string) {
    const out: Item[] = [{ kind: "user", text: option ? option.title : typed || "" }];
    const target = option ? next(trigger!.id, `btn:${option.id}`) : next(trigger!.id, "any");
    if (!target) {
      out.push({ kind: "event", text: option ? `Nothing is connected to “${option.title}” — this tap would just land in the inbox.` : "“Any other reply” isn't connected — a typed reply would just land in the inbox.", tone: "warn" });
      return settle(out, null, answers);
    }
    out.push({ kind: "event", text: option ? `Flow started from “${option.title}”` : "Flow started from a typed reply" });
    setHandedOff(false);
    const ans = {};
    settle(out, walk(target, ans, out), ans);
  }

  // A tap on an EARLIER message: jump there (same visit), or start a fresh
  // visit from it if this one ended. Never after a hand-off.
  function jumpNote(nodeId: string, out: Item[]) {
    if (waiting && waiting.kind !== "start" && waiting.nodeId === nodeId) return;
    out.push({
      kind: "event",
      text: waiting ? "Tapped an earlier message — jumping there." : "Tapped an earlier message after the visit ended — starting a fresh visit from it.",
    });
  }

  function chooseCard(option: FlowOption, cardLabel: string, nodeId: string) {
    if (handedOff) return;
    const n = node(nodeId);
    if (!n) return;
    const dot = option.id.lastIndexOf(".");
    const ci = option.id.slice(0, dot);
    const bid = option.id.slice(dot + 1);
    const label = `${cardLabel} · ${option.title}`;
    // Product cards save the product; a carousel template saves card · button.
    const saved = n.type === "cards" ? cardLabel : label;
    const ans = { ...answers };
    if (n.data.variable) ans[n.data.variable] = saved;
    const out: Item[] = [{ kind: "user", text: label }];
    jumpNote(n.id, out);
    if (n.data.variable) out.push({ kind: "event", text: `Saved ${n.data.variable} = “${saved}”` });
    settle(out, walk(next(n.id, `card:${ci}:${bid}`), ans, out), ans);
  }

  function choose(option: FlowOption, nodeId: string) {
    if (handedOff) return;
    const n = node(nodeId);
    if (!n) return;
    const ans = { ...answers };
    if (n.data.variable) ans[n.data.variable] = option.title;
    const out: Item[] = [{ kind: "user", text: option.title }];
    jumpNote(n.id, out);
    if (n.data.variable) out.push({ kind: "event", text: `Saved ${n.data.variable} = “${option.title}”` });
    const handle = `${n.type === "list" ? "row" : "btn"}:${option.id}`;
    settle(out, walk(next(n.id, handle), ans, out), ans);
  }

  function sendText() {
    const text = input.trim();
    if (!text || !waiting) return;
    setInput("");
    if (waiting.kind === "start") {
      if (!hasAny) {
        setItems((p) => [...p, { kind: "user", text }, { kind: "event", text: "A typed reply doesn't start this flow (“Any other reply” isn't connected). An agent would see it in the inbox.", tone: "warn" }]);
        return;
      }
      return tapStart(null, text);
    }
    if (waiting.kind !== "question") {
      setItems((p) => [...p, { kind: "user", text }, { kind: "event", text: "The flow is waiting for a button tap — typed text goes to the agents in the inbox and the flow keeps waiting.", tone: "warn" }]);
      return;
    }
    const n = node(waiting.nodeId);
    if (!n) return;
    const value = parseAnswer(n.data.inputType, text);
    if (value === null) {
      setItems((p) => [...p, { kind: "user", text }, { kind: "bot", text: n.data.errorText || RETRY[n.data.inputType || "text"] || RETRY.text }]);
      return;
    }
    const ans = { ...answers, [n.data.variable || "answer"]: value };
    const out: Item[] = [{ kind: "user", text }, { kind: "event", text: `Saved ${n.data.variable} = “${value}”` }];
    settle(out, walk(next(n.id, "next"), ans, out), ans);
  }

  function restart() {
    setItems([]);
    setAnswers({});
    setInput("");
    setWaiting({ kind: "start" });
    setHandedOff(false);
    onActiveNode?.(null);
  }

  const canType = waiting?.kind === "question" || waiting?.kind === "start";
  const placeholder =
    waiting?.kind === "question" ? "Type the customer's answer…"
    : waiting?.kind === "start" ? "Or type a reply to the campaign…" : waiting ? "Waiting for a tap (typing goes to the inbox)" : "Flow finished — restart to try another path";

  const headerBtn = "w-8 h-8 rounded-full flex items-center justify-center text-[#fff]/90 dark:text-[#aebac1] hover:bg-black/10 dark:hover:bg-[#fff]/10 cursor-pointer";

  return (
    <div className="flex flex-col h-full min-h-0">
      <WaHeader
        subtitle="Test run — nothing is sent or saved"
        actions={
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={restart} title="Start over" className={headerBtn}>
              <RotateCcw className="w-4 h-4" />
            </button>
            <button type="button" onClick={onClose} title="Close test" className={headerBtn}>
              <X className="w-4 h-4" />
            </button>
          </div>
        }
      />

      <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
        <span className="text-[11px] text-gray-400 shrink-0">Test as</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 text-[12px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:border-brand" />
      </div>

      {/* Phone */}
      <WaChat scrollRef={scrollRef} className="flex-1">
        <div className="space-y-1.5">
          {/* The campaign message that starts it all */}
          <WaBubble
            title="Campaign message"
            placeholder={`Your campaign template${startButtons.length ? " with its buttons" : ""}`}
            actions={startButtons.map((b) => ({ key: b.id, kind: "reply", label: b.title, onClick: () => tapStart(b), disabled: waiting?.kind !== "start" }))}
          />
          {startButtons.length === 0 && (
            <WaSystemNote tone="warn">Add the template&apos;s buttons to the Start step to test them.</WaSystemNote>
          )}

          {items.map((it, i) => {
            // Only the first bubble in a run from the same side gets a tail.
            const prev = i === 0 ? null : items[i - 1];
            if (it.kind === "user") {
              return <div key={i} className="pt-1"><WaOutgoing text={it.text} tail={prev?.kind !== "user"} /></div>;
            }
            if (it.kind === "event") {
              return <div key={i} className="py-1"><WaSystemNote tone={it.tone}>{it.text}</WaSystemNote></div>;
            }
            const nodeId = it.nodeId || "";
            const tail = prev?.kind !== "bot";
            if (it.list) {
              return (
                <div key={i} className="pt-1">
                  <WaListMessage
                    tail={tail}
                    title={it.header}
                    text={it.text || undefined}
                    footer={it.footer}
                    label={it.list.label}
                    rows={it.list.rows.map((r) => ({ key: r.id, title: r.title, description: r.description, onSelect: () => choose(r, nodeId), disabled: handedOff }))}
                  />
                </div>
              );
            }
            const actions: WaAction[] = (it.buttons || []).map((b) => ({ key: b.id, kind: "reply", label: b.title, onClick: () => choose(b, nodeId), disabled: handedOff }));
            if (it.link) actions.push({ key: "__link", kind: "url", label: it.link.title || "Link", href: it.link.url || undefined });
            const hasMedia = !!it.mediaType && it.mediaType !== "NONE";
            return (
              <div key={i} className="pt-1 space-y-1.5">
                {(it.text || it.header || it.footer || hasMedia || actions.length > 0) && (
                  <WaBubble
                    tail={tail}
                    media={hasMedia ? { type: it.mediaType, url: it.mediaUrl } : undefined}
                    title={it.header}
                    text={it.text || undefined}
                    footer={it.footer}
                    actions={actions}
                  />
                )}
                {it.cards && (
                  <WaCarousel
                    cards={it.cards.map((c, ci) => ({
                      key: String(ci),
                      mediaType: c.mediaType,
                      mediaUrl: c.mediaUrl,
                      body: c.body || c.label,
                      actions: [
                        ...c.taps.map((b): WaAction => ({ key: b.id, kind: "reply", label: b.title, onClick: () => chooseCard(b, c.label, nodeId), disabled: handedOff })),
                        ...c.links.map((l, li): WaAction => ({ key: `link${li}`, kind: "url", label: l.title, href: l.url })),
                      ],
                    }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </WaChat>

      {Object.keys(answers).length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Saved to Responses</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(answers).map(([k, v]) => (
              <span key={k} className="text-[11px] bg-white border border-gray-200 rounded-md px-1.5 py-0.5"><span className="font-mono text-gray-400">{k}</span> {v}</span>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); sendText(); }}
        className="flex items-center gap-2 px-2.5 py-2 bg-[#eff2f5] dark:bg-[#202c33]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!waiting}
          placeholder={placeholder}
          className={`flex-1 min-w-0 text-[14px] rounded-full px-4 py-2.5 bg-[#fff] dark:bg-[#2a3942] text-[#111b21] dark:text-[#e9edef] placeholder:text-[#8696a0] focus:outline-none disabled:opacity-60 ${canType ? "" : "italic"}`}
        />
        <button type="submit" disabled={!waiting || !input.trim()} title="Send" className="w-10 h-10 shrink-0 rounded-full bg-[#00a884] text-[#fff] flex items-center justify-center disabled:opacity-40 cursor-pointer">
          <Send className="w-[18px] h-[18px]" />
        </button>
      </form>
    </div>
  );
}
