"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type IsValidConnection,
  type ReactFlowInstance,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ClipboardPaste, Copy, CopyPlus, GripVertical, MessageSquare, List, HelpCircle, Tag, UserRound, Flag, FlaskConical, GalleryHorizontal, Images } from "lucide-react";
import type { AssignableUser, FlowGraph, FlowNodeData, FlowNodeType, FlowValidationError, Template } from "@/types";
import { ADDABLE_STEPS, STEP_META, defaultData, outputsOf, uid } from "@/lib/flows";
import { StepNode, type StepFlowNode } from "./StepNode";
import { StepEditor } from "./StepEditor";
import { FlowSimulator } from "./FlowSimulator";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/components/ui/toast";

const nodeTypes = {
  trigger: StepNode,
  message: StepNode,
  list: StepNode,
  carousel: StepNode,
  cards: StepNode,
  question: StepNode,
  slot_picker: StepNode, // retired: still drawn so older flows open and it can be deleted
  tag: StepNode,
  assign: StepNode,
  end: StepNode,
};

const PALETTE_ICONS: Partial<Record<FlowNodeType, React.ComponentType<{ className?: string }>>> = {
  message: MessageSquare,
  list: List,
  carousel: GalleryHorizontal,
  cards: Images,
  question: HelpCircle,
  tag: Tag,
  assign: UserRound,
  end: Flag,
};

const EDGE_DEFAULTS = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#9CA3AF" },
  // Line colour follows the theme (--flow-edge in globals.css).
  style: { stroke: "var(--flow-edge)", strokeWidth: 1.5 },
};

// A step card's width (StepNode.tsx): dropped and clicked steps are centred
// on the point they're placed at.
const NODE_W = 300;
const NODE_H = 150;
// What a palette item carries while it's dragged onto the canvas.
const DRAG_MIME = "application/x-everlast-flow-step";

// Copied steps travel through the system clipboard as JSON, so they paste
// into another flow or another tab. The in-memory copy covers browsers that
// won't let a page read the clipboard.
const CLIP_KIND = "everlast-flow-steps";
type StepClip = { kind: typeof CLIP_KIND; v: 1; nodes: { id: string; type: FlowNodeType; position: { x: number; y: number }; data: FlowNodeData }[]; edges: { source: string; sourceHandle: string; target: string }[] };
let memoryClip: StepClip | null = null;
const parseClip = (text: string | null | undefined): StepClip | null => {
  try {
    const c = JSON.parse(String(text || ""));
    return c && c.kind === CLIP_KIND && Array.isArray(c.nodes) && Array.isArray(c.edges) ? (c as StepClip) : null;
  } catch {
    return null;
  }
};
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

function toRfNodes(graph: FlowGraph): StepFlowNode[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
    deletable: n.type !== "trigger",
  }));
}

function toRfEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((e) => ({ ...EDGE_DEFAULTS, id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target }));
}

/** What the page can ask of the builder: save from the header / Ctrl+S, read the current graph. */
export interface FlowBuilderControl {
  save: () => Promise<boolean>;
  snapshot: () => FlowGraph;
}

export interface FlowBuilderProps {
  initialGraph: FlowGraph;
  templates: Template[];
  agents: AssignableUser[];
  readOnly: boolean;
  saving: boolean;
  serverErrors: FlowValidationError[];
  /** Resolves true when the flow was saved (the "unsaved changes" marker clears). */
  onSave: (graph: FlowGraph) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  /** Filled in by the builder so the page can save and read the graph. */
  controlRef?: React.RefObject<FlowBuilderControl | null>;
  /** Every edit, with the current graph — the page keeps a local backup of unsaved work. */
  onGraphChange?: (graph: FlowGraph) => void;
}

// Saving happens from the page header (Save button, Ctrl+S) through controlRef.
export function FlowBuilder({ initialGraph, templates, agents, readOnly, serverErrors, onSave, onDirtyChange, controlRef, onGraphChange }: FlowBuilderProps) {
  const [nodes, setNodes] = useState<StepFlowNode[]>(() => toRfNodes(initialGraph));
  const [edges, setEdges] = useState<Edge[]>(() => toRfEdges(initialGraph));
  const [selectedId, setSelectedId] = useState<string | null>(initialGraph.nodes[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const { resolvedTheme } = useTheme();
  const toast = useToast();
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // The canvas, to turn a screen point (drop, middle of the view) into a flow position.
  const [rf, setRf] = useState<ReactFlowInstance<StepFlowNode, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dropHover, setDropHover] = useState(false);

  const markDirty = useCallback(() => setDirty(true), []);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Server problems by step, shown on the cards and in the editor.
  const problemsByNode = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of serverErrors) if (e.nodeId) (m[e.nodeId] ||= []).push(e.message);
    return m;
  }, [serverErrors]);
  const generalProblems = serverErrors.filter((e) => !e.nodeId).map((e) => e.message);

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, problems: problemsByNode[n.id], active: testing && n.id === activeNodeId } })),
    [nodes, problemsByNode, testing, activeNodeId],
  );

  const variables = useMemo(() => {
    const out: string[] = [];
    for (const n of nodes) {
      const v = typeof n.data.variable === "string" ? n.data.variable : "";
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  }, [nodes]);

  const onNodesChange = useCallback((changes: NodeChange<StepFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) markDirty();
    for (const c of changes) {
      if (c.type === "select" && c.selected) setSelectedId(c.id);
      if (c.type === "remove") setSelectedId((s) => (s === c.id ? null : s));
    }
  }, [markDirty]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== "select")) markDirty();
  }, [markDirty]);

  // One output leads to one step: connecting an output that's already wired
  // replaces its old edge instead of forking.
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    const handle = c.sourceHandle || "next";
    setEdges((es) => [
      ...es.filter((e) => !(e.source === c.source && (e.sourceHandle || "next") === handle)),
      { ...EDGE_DEFAULTS, id: uid("e"), source: c.source, sourceHandle: handle, target: c.target },
    ]);
    markDirty();
  }, [markDirty]);

  const isValidConnection: IsValidConnection = useCallback(
    (c) => c.source !== c.target && nodes.find((n) => n.id === c.target)?.type !== "trigger",
    [nodes],
  );

  const updateData = useCallback((id: string, data: FlowNodeData) => {
    let type: FlowNodeType | undefined;
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id) return n;
      type = n.type;
      return { ...n, data };
    }));
    // A removed button/option takes its branch with it.
    setEdges((es) => {
      if (!type) return es;
      const valid = new Set(outputsOf(type, data).map(([h]) => h));
      return es.filter((e) => e.source !== id || valid.has(e.sourceHandle || "next"));
    });
    markDirty();
  }, [markDirty]);

  const deleteNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id || n.type === "trigger"));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
    markDirty();
  }, [markDirty]);

  // Like n8n: drag a step from the palette and drop it where it should go, or
  // click it to drop it in the middle of what you're looking at.
  //   - click: also wired to the selected step's first free output, so
  //     building a branch is select, click, select, click.
  //   - drop:  placed exactly under the cursor, not wired — you connect it.
  const addStep = useCallback((type: FlowNodeType, at?: { x: number; y: number }) => {
    const id = uid(type);
    let position: { x: number; y: number };
    if (at) {
      position = at;
    } else {
      const box = canvasRef.current?.getBoundingClientRect();
      const centre = rf && box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
      position = { x: centre.x - NODE_W / 2, y: centre.y - NODE_H / 2 };
      // Don't stack a new card exactly on top of one already there.
      while (nodes.some((n) => Math.abs(n.position.x - position.x) < 40 && Math.abs(n.position.y - position.y) < 40)) {
        position = { x: position.x + 48, y: position.y + 48 };
      }
    }

    const from = at ? null : nodes.find((n) => n.id === selectedId) || null;
    let freeHandle: string | null = null;
    if (from) {
      const used = new Set(edges.filter((e) => e.source === from.id).map((e) => e.sourceHandle || "next"));
      freeHandle = outputsOf(from.type, from.data).map(([h]) => h).find((h) => !used.has(h)) ?? null;
    }
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { id, type, position, data: defaultData(type), deletable: true, selected: true },
    ]);
    if (from && freeHandle) {
      setEdges((es) => [...es, { ...EDGE_DEFAULTS, id: uid("e"), source: from.id, sourceHandle: freeHandle, target: id }]);
    }
    setSelectedId(id);
    markDirty();
  }, [nodes, edges, selectedId, markDirty, rf]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropHover(true);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    setDropHover(false);
    const type = e.dataTransfer.getData(DRAG_MIME) as FlowNodeType;
    if (!type || !ADDABLE_STEPS.includes(type) || !rf) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addStep(type, { x: p.x - NODE_W / 2, y: p.y - 28 });
  }, [rf, addStep]);

  // ── Copy, paste, duplicate (Ctrl+C / Ctrl+V / Ctrl+D, or the toolbar) ──
  // The Start step can't be copied: a flow has exactly one.
  const selectedSteps = nodes.filter((n) => n.selected && n.type !== "trigger");
  const [canPaste, setCanPaste] = useState(() => memoryClip !== null);

  const clipOf = useCallback((list: StepFlowNode[]): StepClip => {
    const ids = new Set(list.map((n) => n.id));
    return {
      kind: CLIP_KIND,
      v: 1,
      nodes: list.map((n) => {
        const data: FlowNodeData = JSON.parse(JSON.stringify(n.data));
        delete data.problems;
        delete data.active;
        return { id: n.id, type: n.type, position: { ...n.position }, data };
      }),
      edges: edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle || "next", target: e.target })),
    };
  }, [edges]);

  // Places a copy: fresh ids, the connections between the copied steps kept,
  // nothing connected to the rest of the flow. at = where its top-left goes.
  const placeClip = useCallback((clip: StepClip, at: { x: number; y: number }) => {
    const steps = clip.nodes.filter((n) => n.type !== "trigger" && ADDABLE_STEPS.includes(n.type));
    if (!steps.length) return 0;
    const minX = Math.min(...steps.map((n) => n.position.x));
    const minY = Math.min(...steps.map((n) => n.position.y));
    const idMap = new Map(steps.map((n) => [n.id, uid(n.type)]));
    const added: StepFlowNode[] = steps.map((n) => ({
      id: idMap.get(n.id)!,
      type: n.type,
      position: { x: at.x + (n.position.x - minX), y: at.y + (n.position.y - minY) },
      data: JSON.parse(JSON.stringify(n.data)),
      deletable: true,
      selected: true,
    }));
    const addedEdges = clip.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({ ...EDGE_DEFAULTS, id: uid("e"), source: idMap.get(e.source)!, sourceHandle: e.sourceHandle, target: idMap.get(e.target)! }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...added]);
    setEdges((es) => [...es, ...addedEdges]);
    setSelectedId(added.length === 1 ? added[0].id : null);
    markDirty();
    return added.length;
  }, [markDirty]);

  const copySelected = useCallback(async () => {
    if (!selectedSteps.length) {
      toast.error("Select one or more steps to copy");
      return;
    }
    const clip = clipOf(selectedSteps);
    memoryClip = clip;
    setCanPaste(true);
    try {
      await navigator.clipboard.writeText(JSON.stringify(clip));
    } catch {
      // Clipboard blocked: the in-memory copy still pastes in this tab.
    }
    toast.success(`Copied ${clip.nodes.length} step${clip.nodes.length > 1 ? "s" : ""} — paste with Ctrl+V, here or in another flow`);
  }, [selectedSteps, clipOf, toast]);

  const pasteSteps = useCallback(async () => {
    let clip: StepClip | null = null;
    try {
      clip = parseClip(await navigator.clipboard.readText());
    } catch {
      /* not allowed to read: fall back to this tab's copy */
    }
    clip = clip ?? memoryClip;
    if (!clip) {
      toast.error("Nothing to paste — copy some steps first (Ctrl+C)");
      return;
    }
    // Into the middle of the view, nudged if something is already right there.
    const box = canvasRef.current?.getBoundingClientRect();
    const centre = rf && box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
    let at = { x: centre.x - NODE_W / 2, y: centre.y - NODE_H / 2 };
    while (nodes.some((n) => Math.abs(n.position.x - at.x) < 40 && Math.abs(n.position.y - at.y) < 40)) {
      at = { x: at.x + 48, y: at.y + 48 };
    }
    const n = placeClip(clip, at);
    if (n) toast.success(`Pasted ${n} step${n > 1 ? "s" : ""}`);
  }, [rf, nodes, placeClip, toast]);

  const duplicateSelected = useCallback(() => {
    if (!selectedSteps.length) return;
    const clip = clipOf(selectedSteps);
    const minX = Math.min(...clip.nodes.map((n) => n.position.x));
    const minY = Math.min(...clip.nodes.map((n) => n.position.y));
    placeClip(clip, { x: minX + 48, y: minY + 48 });
  }, [selectedSteps, clipOf, placeClip]);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "c" && selectedSteps.length) {
        // Leave a normal text copy alone (text selected on the page).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void copySelected();
      } else if (k === "v") {
        e.preventDefault();
        void pasteSteps();
      } else if (k === "a") {
        // Select every step (not the Start step, which can't be copied).
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.type !== "trigger" })));
      } else if (k === "d" && selectedSteps.length) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedSteps.length, copySelected, pasteSteps, duplicateSelected]);

  const snapshot = (): FlowGraph => ({
      nodes: nodes.map((n) => {
        const data: FlowNodeData = { ...n.data };
        delete data.problems; // display-only, from the last save attempt
        delete data.active;
        return { id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data };
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || "next", target: e.target })),
  });

  const save = async () => {
    const ok = await onSave(snapshot());
    if (ok) setDirty(false);
    return ok;
  };

  // The page's header Save button, Ctrl+S and its leave-with-unsaved-changes
  // prompt all save through here, and its local backup reads the graph.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { save, snapshot };
  });
  useEffect(() => {
    if (dirty) onGraphChange?.(snapshot());
    // snapshot() reads nodes/edges; re-run only when they (or dirtiness) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, dirty]);

  const selected = nodes.find((n) => n.id === selectedId) || null;

  return (
    <div className="flex flex-1 min-h-0">
      {/* Palette */}
      {!readOnly && (
        <aside className="w-64 shrink-0 border-r border-gray-100 bg-white p-3 space-y-2 overflow-y-auto">
          <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 px-1 pb-1">Steps</p>
          {ADDABLE_STEPS.map((t) => {
            const Icon = PALETTE_ICONS[t]!;
            const meta = STEP_META[t];
            return (
              <button
                key={t}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, t);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => setDropHover(false)}
                onClick={() => addStep(t)}
                title="Drag onto the canvas, or click to add it in the middle"
                className="group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm cursor-grab active:cursor-grabbing transition-[border-color,box-shadow]"
              >
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}>
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-gray-800">{meta.label}</span>
                  <span className="block text-[11.5px] text-gray-400 leading-snug">{meta.hint}</span>
                </span>
                <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-400 shrink-0" />
              </button>
            );
          })}
          <p className="text-[11.5px] text-gray-400 leading-relaxed px-1 pt-3">
            Drag a step onto the canvas, or click it to add it in the middle — a clicked step connects to the selected step&apos;s first free output. Drag from an output dot to connect by hand; select a line and press Delete to remove it. Drag on empty space to select several steps (Ctrl+A selects all); scroll or right-drag to move around, Ctrl+scroll to zoom. Ctrl+C / Ctrl+V copies steps (also into another flow), Ctrl+D duplicates them.
          </p>
        </aside>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`flex-1 min-w-0 relative bg-canvas transition-shadow ${dropHover ? "ring-2 ring-inset ring-brand/40" : ""}`}
        onDragOver={readOnly ? undefined : onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false);
        }}
        onDrop={readOnly ? undefined : onDrop}
      >
        <ReactFlow
          onInit={setRf}
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          // Like n8n: left-drag on empty canvas draws a selection box (any step
          // it touches is selected); the wheel/touchpad or a right/middle-button
          // drag moves around; Ctrl+wheel zooms.
          // Right-drag pans, so the browser menu would pop up on release.
          onPaneContextMenu={(e) => e.preventDefault()}
          selectionOnDrag={!readOnly}
          selectionMode={SelectionMode.Partial}
          panOnDrag={readOnly ? true : [1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode={["Control", "Meta"]}
          multiSelectionKeyCode={["Control", "Meta", "Shift"]}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
          colorMode={resolvedTheme ?? "light"}
          className="flow-canvas"
        >
          <Background gap={20} color="var(--flow-grid)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-white !border !border-gray-200 !rounded-lg" maskColor="rgba(0,0,0,0.04)" />
        </ReactFlow>

        {!readOnly && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 shadow-sm px-1.5 py-1">
            <span className="px-1.5 text-[11.5px] text-gray-400 whitespace-nowrap">
              {selectedSteps.length ? `${selectedSteps.length} selected` : "Drag on empty space to select"}
            </span>
            <button
              type="button"
              onClick={() => void copySelected()}
              disabled={!selectedSteps.length}
              title="Copy (Ctrl+C)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            <button
              type="button"
              onClick={duplicateSelected}
              disabled={!selectedSteps.length}
              title="Duplicate (Ctrl+D)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <CopyPlus className="w-3.5 h-3.5" /> Duplicate
            </button>
            <button
              type="button"
              onClick={() => void pasteSteps()}
              title={canPaste ? "Paste (Ctrl+V)" : "Paste (Ctrl+V) — copy steps here or in another flow first"}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
            >
              <ClipboardPaste className="w-3.5 h-3.5" /> Paste
            </button>
          </div>
        )}

        {generalProblems.length > 0 && (
          <div className="absolute top-3 left-3 right-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 shadow-sm">
            {generalProblems.map((p, i) => <p key={i} className="text-[12px] text-red-600">{p}</p>)}
          </div>
        )}

        <div className="absolute bottom-4 right-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setTesting((t) => !t); setActiveNodeId(null); }}
              className={`inline-flex items-center gap-2 text-[13px] font-semibold rounded-xl px-4 py-2.5 shadow-md border ${testing ? "bg-gray-800 text-white dark:text-gray-50 border-gray-800" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
            >
              <FlaskConical className="w-4 h-4" /> {testing ? "Close test" : "Test"}
            </button>
          </div>
      </div>

      {/* Step editor */}
      <aside className="w-[340px] shrink-0 border-l border-gray-100 bg-white flex flex-col min-h-0">
        {testing ? (
          <FlowSimulator graph={snapshot()} templates={templates} onClose={() => { setTesting(false); setActiveNodeId(null); }} onActiveNode={setActiveNodeId} />
        ) : selected ? (
          <StepEditor
            key={selected.id}
            nodeId={selected.id}
            type={selected.type}
            data={selected.data}
            problems={problemsByNode[selected.id] || []}
            onChange={(d) => updateData(selected.id, d)}
            onDelete={() => deleteNode(selected.id)}
            templates={templates}
            agents={agents}
            variables={variables}
            readOnly={readOnly}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-2">
            <p className="text-[14px] font-semibold text-gray-700">Select a step to edit it</p>
            <p className="text-[12px] text-gray-400">Start with the Start step: add the campaign template&apos;s buttons, then build what happens after each tap.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
