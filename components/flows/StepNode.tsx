"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, MessageSquare, List, HelpCircle, Tag, UserRound, Flag, Play, GalleryHorizontal, Images, Ban } from "lucide-react";
import type { FlowNodeData, FlowNodeType } from "@/types";
import { STEP_META, outputsOf, previewOf } from "@/lib/flows";

export type StepNodeData = FlowNodeData & { problems?: string[]; active?: boolean };
export type StepFlowNode = Node<StepNodeData, FlowNodeType>;

const ICONS: Record<FlowNodeType, React.ComponentType<{ className?: string }>> = {
  trigger: Play,
  message: MessageSquare,
  list: List,
  carousel: GalleryHorizontal,
  cards: Images,
  question: HelpCircle,
  slot_picker: Ban, // retired step (Pick appointment) in an older flow
  tag: Tag,
  assign: UserRound,
  end: Flag,
};

// One card per step. Inputs on the left (every step but Start), one output
// row per button/option/"then" on the right, each with its own handle so a
// branch is drawn from exactly the choice it belongs to.
function StepNodeImpl({ type, data, selected }: NodeProps<StepFlowNode>) {
  const meta = STEP_META[type];
  const Icon = ICONS[type];
  const outputs = outputsOf(type, data);
  const problems = data.problems || [];

  return (
    <div
      className={`w-[300px] rounded-2xl bg-white shadow-md border transition-shadow ${
        problems.length ? "border-red-300" : selected ? "border-brand" : "border-gray-300"
      } ${selected ? "shadow-md ring-2 ring-brand/20" : ""} ${data.active ? "ring-4 ring-amber-300 shadow-lg" : ""}`}
    >
      {type !== "trigger" && (
        <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-white !border-2 !border-gray-400" />
      )}

      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-2xl border-b" style={{ background: `${meta.color}33`, borderColor: `${meta.color}40` }}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <span className="text-[14px] font-bold text-gray-800">{meta.label}</span>
        {data.variable ? (
          <span className="ml-auto text-[11px] font-mono text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 truncate max-w-[110px]">
            {data.variable}
          </span>
        ) : null}
        {problems.length > 0 && <AlertCircle className={`w-4 h-4 text-red-500 shrink-0 ${data.variable ? "" : "ml-auto"}`} />}
      </div>

      <p className="px-4 py-3 text-[13.5px] text-gray-600 leading-snug line-clamp-4 whitespace-pre-wrap break-words">
        {previewOf({ type, data })}
      </p>

      {outputs.length > 0 && (
        <div className="border-t border-gray-100 py-1.5">
          {outputs.map(([handleId, label]) => (
            <div key={handleId} className="relative px-4 py-1.5 text-[12.5px] font-medium text-gray-600 text-right pr-6 truncate">
              {label}
              <Handle
                type="source"
                id={handleId}
                position={Position.Right}
                className="!w-4 !h-4 !border-2 !border-white"
                style={{ background: meta.color }}
              />
            </div>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="px-4 py-2.5 border-t border-red-100 bg-red-50/60 rounded-b-2xl space-y-0.5">
          {problems.slice(0, 3).map((p, i) => (
            <li key={i} className="text-[12px] text-red-600 leading-snug">{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const StepNode = memo(StepNodeImpl);
