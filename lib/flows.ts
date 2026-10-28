// Shared helpers for the flow builder. The server (utils/flowGraph.js) is the
// authority on what's valid; the limits here only drive counters and hints.
import type { FlowGraph, FlowNode, FlowNodeData, FlowNodeType, FlowOption, FlowRunStatus, Template, TemplateCard } from "@/types";

export const FLOW_LIMITS = {
  body: 1024,
  text: 4096,
  buttonTitle: 20,
  buttons: 3,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  listButtonLabel: 20,
  header: 60,
  footer: 60,
};

export interface StepMeta {
  label: string;
  hint: string;
  color: string; // accent for the node header
}

export const STEP_META: Record<FlowNodeType, StepMeta> = {
  trigger: { label: "Start", hint: "When the customer taps a button on the campaign message", color: "#3B694C" },
  message: { label: "Message", hint: "Send text, an image or video, with up to 3 buttons", color: "#4F72A8" },
  list: { label: "List", hint: "A menu of up to 10 options", color: "#8C7BC0" },
  carousel: { label: "Carousel template", hint: "An approved carousel template (paid per send)", color: "#0E8C7A" },
  cards: { label: "Product cards", hint: "Swipeable cards with images and buttons — free in the chat window", color: "#D9466F" },
  question: { label: "Question", hint: "Ask something and save the answer (e.g. their name)", color: "#E2A33B" },
  // Retired step: it can no longer be added or saved, but older flows may
  // still contain one, so it renders as a "delete this step" card. At runtime
  // the server hands the patient to the team when a flow reaches it.
  slot_picker: {
    label: "Pick appointment (no longer available — delete this step)",
    hint: "This step was retired. Delete it to save the flow — a patient who reaches it is handed to the team.",
    color: "#9CA3AF",
  },
  tag: { label: "Tag", hint: "Add a tag to the customer", color: "#4AA7C2" },
  assign: { label: "Hand to agent", hint: "Assign the chat to a person — automation stops", color: "#C8475B" },
  end: { label: "End", hint: "Optionally send a last message, then stop", color: "#6B7280" },
};

/** Step types offered in the palette (the Start step is created with the flow). */
export const ADDABLE_STEPS: FlowNodeType[] = ["message", "list", "cards", "carousel", "question", "tag", "assign", "end"];

export const RUN_STATUS_META: Record<FlowRunStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "In progress", cls: "bg-blue-50 text-blue-700" },
  COMPLETED: { label: "Completed", cls: "bg-green-50 text-green-700" },
  HANDED_OFF: { label: "Handed to agent", cls: "bg-amber-50 text-amber-700" },
  STOPPED: { label: "Stopped", cls: "bg-gray-100 text-gray-600" },
  EXPIRED: { label: "No answer (24h)", cls: "bg-gray-100 text-gray-500" },
  FAILED: { label: "Failed", cls: "bg-red-50 text-red-700" },
};

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

export function defaultData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case "trigger":
      return { templateId: null, buttons: [] };
    case "message":
      return { text: "", mediaType: "NONE", buttons: [] };
    case "list":
      return { text: "", buttonLabel: "View options", rows: [{ id: uid("r"), title: "" }] };
    case "carousel":
      return { templateId: null, cards: [] };
    case "cards":
      return { text: "", cards: [newFlowCard(2), newFlowCard(2)] };
    case "question":
      return { text: "", inputType: "text", variable: "" };
    case "slot_picker": // retired — never added any more
      return {};
    case "tag":
      return { tag: "" };
    case "assign":
      return { agentId: null, text: "Thanks! One of our team will be with you shortly." };
    case "end":
      return { text: "" };
  }
}

/** Output handles of a step, as [handleId, label] — mirrors flowGraph.handlesOf. */
export function outputsOf(type: FlowNodeType, data: FlowNodeData): [string, string][] {
  switch (type) {
    case "trigger":
      return [...(data.buttons || []).map((b): [string, string] => [`btn:${b.id}`, b.title || "Button"]), ["any", "Any other reply"]];
    case "message":
      return data.buttons && data.buttons.length
        ? data.buttons.map((b): [string, string] => [`btn:${b.id}`, b.title || "Button"])
        : [["next", "Then"]];
    case "list":
      return (data.rows || []).map((r): [string, string] => [`row:${r.id}`, r.title || "Option"]);
    case "carousel": {
      const taps = (data.cards || []).flatMap((c, i) =>
        c.buttons.map((b): [string, string] => [`card:${i}:${b.id}`, `${c.label ?? `Card ${i + 1}`} · ${b.title}`]),
      );
      return taps.length ? taps : [["next", "Then"]];
    }
    case "cards": {
      const taps = (data.cards || []).flatMap((c, i) =>
        c.buttons
          .filter((b) => b.type !== "URL")
          .map((b): [string, string] => [`card:${c.id}:${b.id}`, `${flowCardLabel(c, i)} · ${b.title || "Button"}`]),
      );
      return taps.length ? taps : [["next", "Then"]];
    }
    case "question":
      return [["next", "After a valid answer"]];
    case "slot_picker":
      // Retired: kept only so an old flow's existing line still draws. It is
      // never followed — the patient is handed to the team here.
      return [["next", "Not used — delete this step"]];
    case "tag":
      return [["next", "Then"]];
    default:
      return [];
  }
}

export function starterGraph(): FlowGraph {
  const start: FlowNode = { id: "start", type: "trigger", position: { x: 0, y: 120 }, data: defaultData("trigger") };
  return { nodes: [start], edges: [] };
}

/** A one-line description of a step for the canvas card. */
export function previewOf(node: { type: FlowNodeType; data: FlowNodeData }): string {
  const d = node.data;
  switch (node.type) {
    case "trigger":
      return d.buttons?.length ? `${d.buttons.length} template button${d.buttons.length > 1 ? "s" : ""}` : "Add the template's buttons";
    case "message":
    case "list":
    case "question":
      return d.text || "No text yet";
    case "slot_picker":
      return "No longer available. Delete this step and reconnect the flow — a patient who reaches it is handed to the team.";
    case "carousel":
      return d.cards?.length ? `${d.cards.length} cards: ${d.cards.map((c) => c.label).join(", ")}` : "Choose a carousel template";
    case "cards":
      return d.cards?.length ? `${d.cards.length} cards: ${d.cards.map((c, i) => flowCardLabel(c, i)).join(", ")}` : "Add some cards";
    case "tag":
      return d.tag ? `Adds “${d.tag}”` : "No tag yet";
    case "assign":
      return d.agentId ? "To a specific agent" : "To the team (unassigned queue)";
    case "end":
      return d.text || "Ends silently";
  }
}

// ── Templates → flow ────────────────────────────────────────────────────────

/** A short name for a carousel card: the first line of its text. */
export function cardLabel(card: TemplateCard, index: number): string {
  const first = card.body.split("\n")[0].trim();
  return (first.length > 24 ? `${first.slice(0, 23)}…` : first) || `Card ${index + 1}`;
}

/** A carousel step's snapshot of a template: each card's label and quick replies. */
export function carouselSnapshot(t: Pick<Template, "cards">) {
  return (t.cards || []).map((c, i) => ({
    label: cardLabel(c, i),
    buttons: c.buttons.filter((b) => b.type === "QUICK_REPLY").map((b) => ({ id: b.id, title: b.title })),
  }));
}

/**
 * The taps a campaign template can start a flow with, as Start-step buttons.
 * A standard template: one per quick reply, matched by title. A carousel: one
 * per card quick reply, id c<card>_<button> — the server matches the tap's
 * payload to that id, because several cards usually share a title.
 */
export function templateStartButtons(t: Pick<Template, "buttons" | "cards">): FlowOption[] {
  if (t.cards && t.cards.length) {
    return t.cards.flatMap((c, i) =>
      c.buttons.filter((b) => b.type === "QUICK_REPLY").map((b) => ({ id: `c${i}_${b.id}`, title: `${cardLabel(c, i)} · ${b.title}` })),
    );
  }
  return (t.buttons || [])
    .filter((b) => (b.type || "QUICK_REPLY") === "QUICK_REPLY")
    .map((b) => ({ id: uid("b"), title: b.title }));
}

// ── Product cards (interactive carousel) ──────────────────────────────────
export const CARD_LIMITS = { min: 2, max: 10, body: 160, lineBreaks: 2, button: 20 };

/** A new card with `quickReplies` quick-reply buttons (or one link button when 0). */
export function newFlowCard(quickReplies: number): import("@/types").FlowCard {
  return {
    id: uid("card"),
    mediaType: "IMAGE",
    mediaUrl: "",
    body: "",
    buttons: quickReplies > 0
      ? Array.from({ length: quickReplies }, (_, j) => ({ id: `b${j}`, type: "QUICK_REPLY" as const, title: j === 0 ? "View offer" : "Book now" }))
      : [{ id: "b0", type: "URL" as const, title: "Shop now", url: "" }],
  };
}

/** The card's name: its first line without WhatsApp formatting. */
export function flowCardLabel(c: import("@/types").FlowCard, i: number): string {
  const first = (c.body || "").split("\n")[0].replace(/[*_~`]/g, "").trim();
  return first || c.label || `Card ${i + 1}`;
}

// ── Checking a flow before it is sent to the server ─────────────────────────

/**
 * The step-level checks of the server's validateGraph (utils/flowGraph.js),
 * run in the browser before saving: a flow with problems is never sent, so
 * nothing on the canvas changes and the problems show on the steps at once.
 * The server stays the authority and checks everything again.
 */
export function validateFlow(graph: FlowGraph): import("@/types").FlowValidationError[] {
  const errors: import("@/types").FlowValidationError[] = [];
  const fail = (message: string, nodeId?: string) => errors.push(nodeId ? { nodeId, message } : { message });
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const https = /^https:\/\/\S+$/i;

  for (const n of graph.nodes) {
    const d = n.data || {};
    const id = n.id;
    const titles = (list: FlowOption[] | undefined, kind: string, max: number) => {
      for (const o of list || []) {
        if (!s(o.title)) fail(`Every ${kind} needs a title`, id);
        else if (s(o.title).length > max) fail(`${kind[0].toUpperCase()}${kind.slice(1)} "${s(o.title)}" is longer than ${max} characters`, id);
      }
    };
    const badVariable = () => {
      const v = s(d.variable);
      if (v && !VARIABLE_RE.test(v)) fail(`"${v}" isn't a valid field name — use lowercase letters, numbers and _`, id);
    };
    switch (n.type) {
      case "slot_picker":
        fail("The Pick appointment step is no longer available — remove it from this flow.", id);
        break;
      case "trigger":
        titles(d.buttons, "button", 1000);
        break;
      case "message": {
        const buttons = d.buttons || [];
        const media = d.mediaType && d.mediaType !== "NONE";
        if (media && !https.test(s(d.mediaUrl))) fail(`Add the ${s(d.mediaType).toLowerCase()} — choose, upload or import it`, id);
        titles(buttons, "button", FLOW_LIMITS.buttonTitle);
        if (buttons.length > FLOW_LIMITS.buttons) fail(`WhatsApp allows at most ${FLOW_LIMITS.buttons} buttons`, id);
        if (d.link) {
          if (buttons.length) fail("A link button can't be combined with reply buttons — use one or the other", id);
          if (!s(d.link.title)) fail("The link button needs a title", id);
          else if (s(d.link.title).length > FLOW_LIMITS.buttonTitle) fail(`Link button "${s(d.link.title)}" is longer than ${FLOW_LIMITS.buttonTitle} characters`, id);
          if (!https.test(s(d.link.url))) fail("The link button needs a link starting with https://", id);
        }
        const interactive = buttons.length > 0 || !!d.link;
        if ((!media || d.link) && !s(d.text)) fail("Message text is required", id);
        const max = interactive ? FLOW_LIMITS.body : FLOW_LIMITS.text;
        if (s(d.text).length > max) fail(`Text is ${s(d.text).length} characters — WhatsApp allows ${max}`, id);
        if (interactive && s(d.footer).length > FLOW_LIMITS.footer) fail(`Footer is longer than ${FLOW_LIMITS.footer} characters`, id);
        if (buttons.length) badVariable();
        break;
      }
      case "list":
        if (!s(d.text)) fail("Message text is required", id);
        if (!s(d.buttonLabel)) fail("The list needs a button label (e.g. \"View options\")", id);
        if (!(d.rows || []).length) fail("A list needs at least one option", id);
        titles(d.rows, "option", FLOW_LIMITS.rowTitle);
        badVariable();
        break;
      case "carousel":
        if (!d.templateId) fail("Choose an approved carousel template", id);
        break;
      case "cards": {
        if (!s(d.text)) fail("Message text is required", id);
        const cards = d.cards || [];
        if (cards.length < CARD_LIMITS.min || cards.length > CARD_LIMITS.max) fail(`Cards needs between ${CARD_LIMITS.min} and ${CARD_LIMITS.max} cards`, id);
        cards.forEach((c, i) => {
          if (!https.test(s(c.mediaUrl))) fail(`Card ${i + 1} needs its ${(c.mediaType || "IMAGE").toLowerCase()} — choose, upload or import it`, id);
          if (!c.buttons.length) fail(`Card ${i + 1} needs a button`, id);
          for (const b of c.buttons) {
            if (!s(b.title)) fail(`Card ${i + 1}: every button needs a title`, id);
            if (b.type === "URL" && !/^https?:\/\//i.test(s(b.url))) fail(`Card ${i + 1}: "${s(b.title)}" needs a link starting with https://`, id);
          }
        });
        badVariable();
        break;
      }
      case "question":
        if (!s(d.text)) fail("Message text is required", id);
        if (!s(d.variable)) fail("Choose a field name to save the answer in (e.g. preferred_date)", id);
        badVariable();
        break;
      case "tag":
        if (!s(d.tag)) fail("Enter the tag to add", id);
        break;
    }
  }

  const start = graph.nodes.find((n) => n.type === "trigger");
  if (!start) fail("A flow needs a Start step");
  else if (!graph.edges.some((e) => e.source === start.id)) fail("Connect at least one Start output to a step", start.id);
  return errors;
}

export const VARIABLE_RE = /^[a-z_][a-z0-9_]{0,39}$/;
export const BUILT_IN_VARIABLES = ["first_name", "customer_name", "phone"];
