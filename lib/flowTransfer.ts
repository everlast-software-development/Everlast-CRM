// Flow files: a flow exported to JSON and imported again — into another
// environment (local → live) or as a starting point for a new flow.
//
// Template ids are database ids and differ between environments, so a file
// carries each referenced template's NAME too; import looks the template up by
// name in the current account and clears it when there is no match.
import type { FlowGraph, Template } from "@/types";

const KIND = "everlast-flow";

export interface FlowFile {
  kind: typeof KIND;
  v: 1;
  exportedAt: string;
  name: string;
  description: string | null;
  graph: FlowGraph;
}

type FlowLike = { name: string; description: string | null; graph: FlowGraph };

/** The flow as file text — what Export downloads and Copy flow puts on the clipboard. */
export function flowFileText(flow: FlowLike, templates: Template[]): string {
  const nameOf = new Map(templates.map((t) => [t.id, t.name]));
  const graph: FlowGraph = {
    edges: flow.graph.edges,
    nodes: flow.graph.nodes.map((n) => {
      const id = n.data.templateId;
      return typeof id === "number" && nameOf.has(id) ? { ...n, data: { ...n.data, templateName: nameOf.get(id) } } : n;
    }),
  };
  const file: FlowFile = { kind: KIND, v: 1, exportedAt: new Date().toISOString(), name: flow.name, description: flow.description, graph };
  return JSON.stringify(file, null, 2);
}

/** A flow file's text, or null when the text is anything else (no error). */
export function readFlowFile(text: string): FlowFile | null {
  try {
    return parseFlowFile(text);
  } catch {
    return null;
  }
}

/** Downloads the flow as `<name>.flow.json`. */
export function downloadFlowFile(flow: FlowLike, templates: Template[]) {
  const blob = new Blob([flowFileText(flow, templates)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${flow.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "flow"}.flow.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class FlowFileError extends Error {}

/** Reads a flow file, or throws a FlowFileError saying what's wrong with it. */
export function parseFlowFile(text: string): FlowFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FlowFileError("That file isn't a flow export (it isn't valid JSON).");
  }
  const f = data as Partial<FlowFile>;
  if (f?.kind !== KIND || !f.graph || !Array.isArray(f.graph.nodes) || !Array.isArray(f.graph.edges)) {
    throw new FlowFileError("That file isn't a flow export from Everlast CRM.");
  }
  return {
    kind: KIND,
    v: 1,
    exportedAt: String(f.exportedAt || ""),
    name: String(f.name || "Imported flow").trim() || "Imported flow",
    description: f.description ? String(f.description) : null,
    graph: f.graph,
  };
}

/**
 * Hands an imported flow that still needs fixing to the new-flow builder: it is
 * put where the builder keeps unsaved work (the same key and shape as its own
 * backup), and /campaigns/flows/new?import=1 opens it straight away.
 */
export function openImportedDraft(name: string, description: string | null, graph: FlowGraph) {
  try {
    localStorage.setItem(
      "everlast:flow-draft:new",
      JSON.stringify({ graph, name, description: description || "", at: Date.now(), imported: true }),
    );
  } catch {
    // Storage blocked (private window): the builder opens empty instead.
  }
}

/**
 * Points the file's template references at this account's templates (same
 * name). Returns the graph and the template names that weren't found — those
 * steps keep their buttons but need a template chosen again.
 */
export function relinkTemplates(graph: FlowGraph, templates: Template[]): { graph: FlowGraph; missing: string[] } {
  const byName = new Map(templates.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const missing: string[] = [];
  const nodes = graph.nodes.map((n) => {
    const { templateName, ...data } = n.data as typeof n.data & { templateName?: string };
    if (data.templateId === undefined && !templateName) return n;
    const id = templateName ? byName.get(templateName.trim().toLowerCase()) : undefined;
    if (templateName && id === undefined && !missing.includes(templateName)) missing.push(templateName);
    return { ...n, data: { ...data, templateId: id ?? null } };
  });
  return { graph: { nodes, edges: graph.edges }, missing };
}
