// "Tidy up" for the flow builder: lays the steps out left to right.
//
// - Columns: a step's column is its distance from the Start step (the fewest
//   connections to reach it), so a line back to an earlier step (a "menu"
//   loop) never pushes anything further right.
// - Order: within a column, steps follow the order of the outputs that lead to
//   them — button 1's step above button 2's.
// - Rows: each step's branches are centred beside it, without overlapping
//   what's already in that column.
// Steps nothing leads to (not yet connected) start their own groups below.

export interface LayoutNode {
  id: string;
  isStart: boolean;
  width: number;
  height: number;
  /** Where it is now — keeps loose steps in their current top-to-bottom order. */
  y: number;
  /** This step's outputs in display order (button 1, button 2, …, next). */
  outputs: string[];
}
export interface LayoutEdge {
  source: string;
  sourceHandle: string;
  target: string;
}

const COL_GAP = 120;
const ROW_GAP = 48;

export function tidyLayout(nodes: LayoutNode[], edges: LayoutEdge[]): Record<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Children of each step, in the order of its outputs.
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    const out = edges
      .filter((e) => e.source === n.id && byId.has(e.target))
      .sort((a, b) => rank(n.outputs, a.sourceHandle) - rank(n.outputs, b.sourceHandle))
      .map((e) => e.target);
    children.set(n.id, [...new Set(out)]);
  }
  const hasIncoming = new Set(edges.filter((e) => byId.has(e.source)).map((e) => e.target));

  // Breadth-first from the Start step, then from each step nothing leads to,
  // then from anything left (a loop with no way in).
  const layer = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const groups: string[][] = []; // each: the steps reached from one root, in visit order
  const visitFrom = (root: string) => {
    if (layer.has(root)) return;
    const group: string[] = [];
    layer.set(root, 0);
    parent.set(root, null);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      group.push(id);
      for (const c of children.get(id) || []) {
        if (layer.has(c)) continue;
        layer.set(c, layer.get(id)! + 1);
        parent.set(c, id);
        queue.push(c);
      }
    }
    groups.push(group);
  };
  const byY = [...nodes].sort((a, b) => a.y - b.y);
  for (const n of byY) if (n.isStart) visitFrom(n.id);
  for (const n of byY) if (!n.isStart && !hasIncoming.has(n.id)) visitFrom(n.id);
  for (const n of byY) visitFrom(n.id);

  // Column x, shared by every group: each column as wide as its widest step.
  const colW: number[] = [];
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    colW[l] = Math.max(colW[l] || 0, n.width);
  }
  const colX: number[] = [];
  let x = 0;
  for (let i = 0; i < colW.length; i++) {
    colX[i] = x;
    x += (colW[i] || 0) + COL_GAP;
  }

  // Each group below the previous one. Within a group, column by column:
  // siblings (same parent) are centred on their parent, pushed down only as
  // far as needed to clear the steps already placed in that column.
  const pos: Record<string, { x: number; y: number }> = {};
  const centreY = (id: string) => pos[id].y + byId.get(id)!.height / 2;
  let groupTop = 0;
  for (const group of groups) {
    const columns: string[][] = [];
    for (const id of group) (columns[layer.get(id)!] ||= []).push(id);
    // Laid out freely around the root (branches may centre above it), then
    // the whole group is moved so its top edge sits at groupTop.
    columns.forEach((col, i) => {
      if (!col) return;
      let cursor = -Infinity;
      for (let k = 0; k < col.length; ) {
        const p = parent.get(col[k]) ?? null;
        let end = k + 1;
        while (end < col.length && p !== null && parent.get(col[end]) === p) end++;
        const sibs = col.slice(k, end);
        const h = sibs.reduce((s, id) => s + byId.get(id)!.height, 0) + ROW_GAP * (sibs.length - 1);
        let y = Math.max(p !== null ? centreY(p) - h / 2 : 0, cursor);
        for (const id of sibs) {
          pos[id] = { x: colX[i], y };
          y += byId.get(id)!.height + ROW_GAP;
        }
        cursor = y;
        k = end;
      }
    });
    const top = Math.min(...group.map((id) => pos[id].y));
    let bottom = groupTop;
    for (const id of group) {
      pos[id].y += groupTop - top;
      bottom = Math.max(bottom, pos[id].y + byId.get(id)!.height);
    }
    groupTop = bottom + ROW_GAP * 2;
  }
  return pos;
}

function rank(outputs: string[], handle: string) {
  const i = outputs.indexOf(handle || "next");
  return i === -1 ? outputs.length : i;
}
