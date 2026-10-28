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
import { ClipboardPaste, Copy, CopyPlus, GripVertical, MessageSquare, List, HelpCircle, Tag, UserRound, Flag, FlaskConical, GalleryHorizontal, Images, Redo2, Scissors, Undo2 } from "lucide-react";
import type { AssignableUser, FlowGraph, FlowNodeData, FlowNodeType, FlowValidationError, Template } from "@/types";
import { ADDABLE_STEPS, STEP_META, defaultData, outputsOf, uid, validateFlow } from "@/lib/flows";
import { readFlowFile, relinkTemplates } from "@/lib/flowTransfer";
import { StepNode, type StepFlowNode } from "./StepNode";
import { StepEditor } from "./StepEditor";
import { CutEdge, EdgeEditContext } from "./CutEdge";
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

// Every line is a CutEdge: a smooth-step line with a scissors button in the
// middle while it's pointed at or selected.
const edgeTypes = { cut: CutEdge };

const EDGE_DEFAULTS = {
  type: "cut",
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#8b929c" },
  // Line colour follows the theme (--flow-edge in globals.css).
  style: { stroke: "var(--flow-edge)", strokeWidth: 2.5 },
};

// Undo history: each entry is the canvas before an edit. Edits less than
// HISTORY_GROUP_MS apart (a drag, typing in a field) are one step to undo.
type Snap = { nodes: StepFlowNode[]; edges: Edge[] };
const HISTORY_LIMIT = 100;
const HISTORY_GROUP_MS = 600;

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
// A whole flow as steps to paste: everything but its Start step (a flow has
// exactly one), with the connections between them.
const clipOfFlow = (graph: FlowGraph): StepClip => {
  const nodes = graph.nodes.filter((n) => n.type !== "trigger");
  const ids = new Set(nodes.map((n) => n.id));
  return {
    kind: CLIP_KIND,
    v: 1,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle || "next", target: e.target })),
  };
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

/** The graph as saved: display-only fields dropped, positions rounded. */
function graphOf(nodes: StepFlowNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => {
      const data: FlowNodeData = { ...n.data };
      delete data.problems; // display-only, from the last save attempt
      delete data.active;
      return { id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || "next", target: e.target })),
  };
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
  /** Mark the flow's problems from the start, before any save (an imported flow). */
  checkOnOpen?: boolean;
}

// Saving happens from the page header (Save button, Ctrl+S) through controlRef.
export function FlowBuilder({ initialGraph, templates, agents, readOnly, serverErrors, onSave, onDirtyChange, controlRef, onGraphChange, checkOnOpen = false }: FlowBuilderProps) {
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

  // After a save is refused by the check below, problems are re-checked on
  // every edit, so each one disappears as soon as it's fixed.
  const [checked, setChecked] = useState(checkOnOpen);
  const localErrors = useMemo(() => (checked ? validateFlow(graphOf(nodes, edges)) : []), [checked, nodes, edges]);
  const shownErrors = checked ? localErrors : serverErrors;

  // Problems by step, shown on the cards and in the editor.
  const problemsByNode = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of shownErrors) if (e.nodeId) (m[e.nodeId] ||= []).push(e.message);
    return m;
  }, [shownErrors]);
  const generalProblems = shownErrors.filter((e) => !e.nodeId).map((e) => e.message);

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

  // Edits arrive as "change the step's current data", applied to the latest
  // copy in state. An edit that lands late — an image upload finishing, a
  // library pick — used to be built from the data as it was when it started,
  // and wrote over everything changed since (cards added meanwhile vanished).
  const updateData = useCallback((id: string, update: (prev: FlowNodeData) => FlowNodeData) => {
    let type: FlowNodeType | undefined;
    let data: FlowNodeData | undefined;
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id) return n;
      type = n.type;
      data = update(n.data);
      return { ...n, data };
    }));
    // A removed button/option takes its branch with it.
    setEdges((es) => {
      if (!type || !data) return es;
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

  // `text` comes from a real paste (Ctrl+V); the toolbar button reads the
  // clipboard itself. Copied steps paste into the middle of the view. A whole
  // flow (Copy flow on the Flows list, or a .flow.json file's text) pastes
  // beside the existing steps, like n8n — everything but its Start step.
  const pasteSteps = useCallback(async (text?: string) => {
    let clip: StepClip | null = null;
    let wholeFlow = false;
    try {
      const raw = text ?? (await navigator.clipboard.readText());
      clip = parseClip(raw);
      const file = clip ? null : readFlowFile(raw);
      if (file) {
        clip = clipOfFlow(relinkTemplates(file.graph, templates).graph);
        wholeFlow = true;
      }
    } catch {
      /* not allowed to read: fall back to this tab's copy */
    }
    clip = clip ?? (text === undefined ? memoryClip : null);
    if (!clip) {
      if (text === undefined) toast.error("Nothing to paste — copy some steps or a flow first");
      return;
    }
    let at: { x: number; y: number };
    if (wholeFlow && nodes.length) {
      // To the right of everything already on the canvas, top-aligned.
      at = {
        x: Math.max(...nodes.map((n) => n.position.x)) + NODE_W + 160,
        y: Math.min(...nodes.map((n) => n.position.y)),
      };
    } else {
      // Into the middle of the view, nudged if something is already right there.
      const box = canvasRef.current?.getBoundingClientRect();
      const centre = rf && box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : { x: 0, y: 0 };
      at = { x: centre.x - NODE_W / 2, y: centre.y - NODE_H / 2 };
      while (nodes.some((n) => Math.abs(n.position.x - at.x) < 40 && Math.abs(n.position.y - at.y) < 40)) {
        at = { x: at.x + 48, y: at.y + 48 };
      }
    }
    const n = placeClip(clip, at);
    if (!n) {
      if (wholeFlow) toast.error("That flow only has a Start step — nothing to paste");
      return;
    }
    if (wholeFlow) {
      // Bring the pasted flow into view.
      setTimeout(() => rf?.fitView({ duration: 300, padding: 0.15 }), 50);
      toast.success(`Pasted a flow (${n} step${n > 1 ? "s" : ""}) beside yours — connect your Start step to it`);
    } else {
      toast.success(`Pasted ${n} step${n > 1 ? "s" : ""}`);
    }
  }, [rf, nodes, placeClip, toast, templates]);

  const duplicateSelected = useCallback(() => {
    if (!selectedSteps.length) return;
    const clip = clipOf(selectedSteps);
    const minX = Math.min(...clip.nodes.map((n) => n.position.x));
    const minY = Math.min(...clip.nodes.map((n) => n.position.y));
    placeClip(clip, { x: minX + 48, y: minY + 48 });
  }, [selectedSteps, clipOf, placeClip]);

  // Cut (Ctrl+X): copy the selected steps, then remove them and their lines.
  const cutSelected = useCallback(async () => {
    if (!selectedSteps.length) {
      toast.error("Select one or more steps to cut");
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
    const ids = new Set(clip.nodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedId((s) => (s && ids.has(s) ? null : s));
    markDirty();
    toast.success(`Cut ${clip.nodes.length} step${clip.nodes.length > 1 ? "s" : ""} — paste with Ctrl+V`);
  }, [selectedSteps, clipOf, markDirty, toast]);

  // ── Undo / redo (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) ──
  // Watches the saved shape of the canvas (steps, their content and position,
  // lines): selecting or zooming is not an edit. The canvas before each edit
  // goes on the undo stack; a burst of edits (dragging, typing) is grouped.
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const shownKey = useRef<string | null>(null);
  const shownSnap = useRef<Snap>({ nodes, edges });
  const lastEditAt = useRef(0);
  const restoring = useRef(false);
  const graphKey = useMemo(() => JSON.stringify(graphOf(nodes, edges)), [nodes, edges]);
  useEffect(() => {
    const now: Snap = { nodes, edges };
    if (shownKey.current !== null && graphKey !== shownKey.current) {
      if (restoring.current) {
        restoring.current = false;
      } else {
        const t = Date.now();
        if (t - lastEditAt.current > HISTORY_GROUP_MS) {
          past.current.push(shownSnap.current);
          if (past.current.length > HISTORY_LIMIT) past.current.shift();
        }
        lastEditAt.current = t;
        future.current = [];
      }
    }
    shownKey.current = graphKey;
    shownSnap.current = now;
    // Keyed on the graph's shape; nodes/edges are read for the snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  const restore = useCallback((snap: Snap) => {
    // Only flag it when the canvas will actually change — otherwise the flag
    // would outlive this restore and swallow the next real edit.
    restoring.current = JSON.stringify(graphOf(snap.nodes, snap.edges)) !== shownKey.current;
    lastEditAt.current = 0; // the next edit starts a new undo step
    setNodes(snap.nodes.map((n) => ({ ...n, selected: false })));
    setEdges(snap.edges.map((e) => ({ ...e, selected: false })));
    setSelectedId((s) => (s && snap.nodes.some((n) => n.id === s) ? s : null));
    markDirty();
  }, [markDirty]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) {
      toast.error("Nothing to undo");
      return;
    }
    future.current.push(shownSnap.current);
    restore(prev);
  }, [restore, toast]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) {
      toast.error("Nothing to redo");
      return;
    }
    past.current.push(shownSnap.current);
    restore(next);
  }, [restore, toast]);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else if (k === "x" && selectedSteps.length) {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void cutSelected();
      } else if (k === "c" && selectedSteps.length) {
        // Leave a normal text copy alone (text selected on the page).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void copySelected();
      } else if (k === "a") {
        // Select every step (not the Start step, which can't be copied).
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.type !== "trigger" })));
      } else if (k === "d" && selectedSteps.length) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    // Ctrl+V as a real paste event: it carries the clipboard text, so no
    // clipboard permission prompt, and pasting into a text box is left alone.
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      e.preventDefault();
      void pasteSteps(text);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [readOnly, selectedSteps.length, copySelected, cutSelected, pasteSteps, duplicateSelected, undo, redo]);

  const snapshot = (): FlowGraph => graphOf(nodes, edges);

  // Checked here first: a flow with problems is never sent, so the canvas is
  // left exactly as it is and the problems show on the steps straight away.
  const save = async () => {
    const g = snapshot();
    const problems = validateFlow(g);
    if (problems.length) {
      setChecked(true);
      const first = problems.find((p) => p.nodeId);
      if (first?.nodeId) setSelectedId(first.nodeId);
      toast.error(`Not saved — ${problems.length} problem${problems.length > 1 ? "s" : ""} to fix, marked on the steps. Nothing was lost.`);
      return false;
    }
    const ok = await onSave(g);
    if (ok) {
      setDirty(false);
      setChecked(false);
    }
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
            Drag a step onto the canvas, or click it to add it in the middle — a clicked step connects to the selected step&apos;s first free output. Drag from an output dot to connect by hand; point at a line and click its scissors to cut it (or select it and press Delete). Drag on empty space to select several steps (Ctrl+A selects all); scroll or right-drag to move around, Ctrl+scroll to zoom. Ctrl+Z undoes, Ctrl+Y redoes. Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste steps (also into another flow), Ctrl+D duplicates them. To pass a patient to the team, connect a button to a <b>Hand to agent</b> step.
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
        <EdgeEditContext.Provider value={!readOnly}>
        <ReactFlow
          onInit={setRf}
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
        </EdgeEditContext.Provider>

        {!readOnly && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 shadow-sm px-1.5 py-1">
            <button
              type="button"
              onClick={undo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              className="inline-flex items-center rounded-lg p-1.5 text-gray-700 hover:bg-gray-50"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={redo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              className="inline-flex items-center rounded-lg p-1.5 text-gray-700 hover:bg-gray-50"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <span className="w-px h-5 bg-gray-200 mx-1" aria-hidden />
            <span className="px-1.5 text-[11.5px] text-gray-400 whitespace-nowrap">
              {selectedSteps.length ? `${selectedSteps.length} selected` : "Drag on empty space to select"}
            </span>
            <button
              type="button"
              onClick={() => void cutSelected()}
              disabled={!selectedSteps.length}
              title="Cut (Ctrl+X)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <Scissors className="w-3.5 h-3.5" /> Cut
            </button>
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
            onChange={(update) => updateData(selected.id, update)}
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
