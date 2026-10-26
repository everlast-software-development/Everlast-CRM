"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  AlertCircle, Check, Clock, Flag, GalleryHorizontal, HelpCircle, Images, List, MessageCircle,
  MessageSquare, Play, Tag, UserRound, X, type LucideIcon,
} from "lucide-react";
import type { FlowGraph, FlowNode, FlowNodeType, FlowRun } from "@/types";
import { RUN_STATUS_META, STEP_META, outputsOf, previewOf } from "@/lib/flows";

// One response, drawn as the path the patient took through the flow: what the
// bot sent at each step, every option it offered (the one they picked, and
// the ones they didn't), what they typed, and where it ended. Built from the
// run's recorded path (taps, answers, tags, hand-off) walked over the flow's
// graph, so the steps the bot sent on its own are shown too.

const ICONS: Record<FlowNodeType, LucideIcon> = {
  trigger: Play, message: MessageSquare, list: List, carousel: GalleryHorizontal, cards: Images,
  question: HelpCircle, slot_picker: AlertCircle, tag: Tag, assign: UserRound, end: Flag,
};

type PathEntry = NonNullable<FlowRun["data"]["path"]>[number];

type Step =
  | { kind: "step"; node: FlowNode | null; nodeId: string; entry?: PathEntry; options: [string, string][]; chosen: string | null; auto?: boolean }
  | { kind: "stopped"; node: FlowNode | null; nodeId: string | null };

const time = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function duration(from: string, to: string | null): string | null {
  if (!to) return null;
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Steps that wait for the patient (a tap or a typed answer) — the bot doesn't move on by itself. */
function waitsForPatient(node: FlowNode): boolean {
  if (node.type === "question") return true;
  const outs = outputsOf(node.type, node.data);
  return outs.length > 0 && !(outs.length === 1 && outs[0][0] === "next");
}

/** Which output a recorded tap left by. */
function handleFor(node: FlowNode, entry: PathEntry): string | null {
  const outs = outputsOf(node.type, node.data);
  if (entry.answer !== undefined && node.type === "question") return "next";
  if (entry.choice) {
    const c = entry.choice.trim().toLowerCase();
    const hit =
      outs.find(([, label]) => label.trim().toLowerCase() === c) ||
      outs.find(([, label]) => label.toLowerCase().endsWith(` · ${c}`));
    if (hit) return hit[0];
    if (node.type === "trigger") return "any";
  }
  return outs.length === 1 ? outs[0][0] : null;
}

function buildSteps(run: FlowRun, graph: FlowGraph): Step[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nextOf = (id: string, handle: string) =>
    graph.edges.find((e) => e.source === id && (e.sourceHandle || "next") === handle)?.target ?? null;
  const path = run.data.path || [];
  const steps: Step[] = [];

  for (let i = 0; i < path.length; i++) {
    const entry = path[i];
    const node = byId.get(entry.node) ?? null;
    const handle = node ? handleFor(node, entry) : null;
    steps.push({
      kind: "step",
      node,
      nodeId: entry.node,
      entry,
      options: node && waitsForPatient(node) ? outputsOf(node.type, node.data) : [],
      chosen: handle,
    });

    // The steps the bot ran on its own after this one, up to the next recorded
    // step (or the step the patient never answered).
    if (!node || !handle) continue;
    const nextRecorded = path[i + 1]?.node ?? null;
    let cursor = nextOf(node.id, handle);
    let guard = 0;
    while (cursor && cursor !== nextRecorded && guard++ < 25) {
      const n = byId.get(cursor);
      if (!n) break;
      if (waitsForPatient(n)) {
        if (i === path.length - 1) {
          // The last thing the patient was asked — they never answered it.
          steps.push({ kind: "step", node: n, nodeId: n.id, options: outputsOf(n.type, n.data), chosen: null, auto: true });
        }
        break;
      }
      steps.push({ kind: "step", node: n, nodeId: n.id, options: [], chosen: null, auto: true });
      if (n.type === "assign" || n.type === "end") break;
      cursor = nextOf(n.id, "next");
    }
  }

  if (run.status === "ACTIVE" || run.status === "EXPIRED" || run.status === "STOPPED") {
    const last = steps[steps.length - 1];
    const waiting = run.currentNodeId ?? (last?.kind === "step" && !last.entry ? last.nodeId : null);
    steps.push({ kind: "stopped", node: waiting ? byId.get(waiting) ?? null : null, nodeId: waiting });
  }
  return steps;
}

function StepIcon({ type, muted }: { type: FlowNodeType; muted?: boolean }) {
  const Icon = ICONS[type] ?? MessageSquare;
  const meta = STEP_META[type];
  return (
    <span
      className={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm ${muted ? "opacity-60" : ""}`}
      style={{ background: meta?.color ?? "#6B7280" }}
    >
      <Icon className="w-[18px] h-[18px]" />
    </span>
  );
}

export function FlowRunJourney({
  run, graph, canOpenChat, onClose,
}: { run: FlowRun; graph: FlowGraph; canOpenChat: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = buildSteps(run, graph);
  const status = RUN_STATUS_META[run.status];
  const answers = Object.entries(run.data.answers || {});
  const took = duration(run.startedAt, run.completedAt);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label="Response details">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/25 cursor-default" />
      <aside className="relative w-full max-w-[520px] h-full bg-white border-l border-gray-100 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold text-gray-900 truncate">{run.customer.name || "Unknown patient"}</p>
              <p className="text-[13px] text-gray-400">{run.customer.phone}</p>
            </div>
            {canOpenChat && (
              <Link
                href={`/chats/${run.conversationId}`}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-fg bg-brand-100 hover:bg-brand-100/70 rounded-lg px-3 py-1.5"
              >
                <MessageCircle className="w-4 h-4" /> Open chat
              </Link>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-[12px] text-gray-500">
            <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${status.cls}`}>{status.label}</span>
            {run.campaign && <span>From <b className="font-semibold text-gray-700">{run.campaign.name}</b></span>}
            <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {dateTime(run.startedAt)}{took ? ` · took ${took}` : ""}</span>
          </div>
          {answers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {answers.map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[12px]">
                  <span className="font-mono text-gray-400">{k}</span>
                  <span className="font-semibold text-gray-800">{v}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* The path */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {steps.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-10">No steps recorded for this response.</p>
          ) : (
            <ol className="relative">
              {steps.map((s, i) => {
                const last = i === steps.length - 1;
                if (s.kind === "stopped") {
                  const why =
                    run.status === "ACTIVE" ? "Waiting for the patient" :
                    run.status === "EXPIRED" ? "No answer within 24 hours — stopped here" :
                    "Stopped here";
                  return (
                    <li key={`stop-${i}`} className="relative flex gap-3 pb-1">
                      <span className="relative z-10 w-9 h-9 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-300 text-gray-400 shrink-0 bg-white">
                        <Clock className="w-4 h-4" />
                      </span>
                      <div className="pt-1.5">
                        <p className="text-[13.5px] font-semibold text-gray-700">{why}</p>
                        {s.node && <p className="text-[12px] text-gray-400">at “{STEP_META[s.node.type]?.label}” — {previewOf(s.node).slice(0, 80)}</p>}
                      </div>
                    </li>
                  );
                }

                const type = s.node?.type ?? "message";
                const meta = STEP_META[type];
                const e = s.entry;
                return (
                  <li key={`${s.nodeId}-${i}`} className="relative flex gap-3 pb-6">
                    {!last && <span className="absolute left-[17px] top-9 bottom-0 w-0.5 bg-gray-200" aria-hidden />}
                    <StepIcon type={type} muted={!s.node} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-[13.5px] font-bold text-gray-900">{s.node ? meta.label : "Step removed since"}</p>
                        {s.auto && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">sent automatically</span>}
                        {e?.at && <span className="ml-auto text-[11.5px] text-gray-400 tabular-nums">{time(e.at)}</span>}
                      </div>

                      {s.node && type !== "trigger" && (
                        <p className="mt-1 text-[13px] text-gray-600 leading-snug whitespace-pre-wrap break-words line-clamp-4">
                          {previewOf(s.node)}
                        </p>
                      )}

                      {/* Every option offered: the one they picked, and the rest */}
                      {s.options.length > 0 && type !== "question" && (
                        <div className="mt-2.5 space-y-1">
                          {s.options.map(([handle, label]) => {
                            const picked = handle === s.chosen;
                            return (
                              <div
                                key={handle}
                                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] border ${
                                  picked
                                    ? "border-brand bg-brand-100 text-brand-fg font-semibold"
                                    : "border-dashed border-gray-200 text-gray-400"
                                }`}
                              >
                                {picked ? <Check className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-gray-300" />}
                                <span className="truncate">{label}</span>
                                {picked && <span className="ml-auto text-[11px] font-medium">tapped</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* What the patient did */}
                      {e?.answer !== undefined && (
                        <div className="mt-2.5 inline-block max-w-full rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-[13px] text-gray-800 whitespace-pre-wrap break-words">
                          <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Typed</span>
                          {e.answer}
                        </div>
                      )}
                      {e?.choice && s.options.length === 0 && (
                        <p className="mt-2 text-[12.5px] text-gray-600">Tapped <b className="text-gray-900">{e.choice}</b></p>
                      )}
                      {e?.tag && <p className="mt-1.5 text-[12.5px] text-gray-600">Tagged <b className="text-gray-900">#{e.tag}</b></p>}
                      {e?.handedOffTo && (
                        <p className="mt-1.5 text-[12.5px] text-gray-600">Handed to <b className="text-gray-900">{e.handedOffTo === "team" ? "the team" : e.handedOffTo}</b></p>
                      )}
                      {s.auto && !e && s.options.length > 0 && (
                        <p className="mt-2 text-[12px] text-amber-700">Shown to the patient — no tap yet</p>
                      )}
                      {e?.from && (
                        <p className="mt-1 text-[11.5px] text-gray-400">Tapped on an earlier message</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {run.status === "FAILED" && run.lastError && (
            <div className="mt-2 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {run.lastError}
            </div>
          )}
          {(run.status === "COMPLETED" || run.status === "HANDED_OFF") && (
            <div className="mt-1 flex items-center gap-2 text-[12.5px] text-gray-500">
              <Flag className="w-4 h-4" /> {run.status === "COMPLETED" ? "The flow finished" : "Handed to the team"} · {dateTime(run.completedAt)}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
