import type { Diagram, Edge, Node, Point, Rect } from './types';
import { rotatedBounds, unionRect, expandRect } from './geometry';
import { routeEdge } from './routing';

/* --------------------------------------------------------------- lookups */

export function getNode(d: Diagram, id: string): Node | undefined {
  return d.nodes[id];
}

export function getEdge(d: Diagram, id: string): Edge | undefined {
  return d.edges[id];
}

export function nodeList(d: Diagram): Node[] {
  return d.order.map((id) => d.nodes[id]).filter(Boolean) as Node[];
}

export function edgeList(d: Diagram): Edge[] {
  return d.order.map((id) => d.edges[id]).filter(Boolean) as Edge[];
}

export function isEmpty(d: Diagram): boolean {
  return d.order.length === 0;
}

/** Edges whose source or target references the given node. */
export function edgesForNode(d: Diagram, nodeId: string): Edge[] {
  return Object.values(d.edges).filter(
    (e) => e.source.nodeId === nodeId || e.target.nodeId === nodeId,
  );
}

/* ---------------------------------------------------------------- bounds */

export function nodeBounds(n: Node): Rect {
  return rotatedBounds({ x: n.x, y: n.y, w: n.w, h: n.h }, n.rotation);
}

export function edgeBounds(d: Diagram, e: Edge): Rect | null {
  const route = routeEdge(d, e);
  if (!route || route.samples.length === 0) return null;
  const xs = route.samples.map((p) => p.x);
  const ys = route.samples.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

export function diagramBounds(d: Diagram): Rect {
  const rects: Rect[] = [];
  for (const n of Object.values(d.nodes)) rects.push(nodeBounds(n));
  for (const e of Object.values(d.edges)) {
    const b = edgeBounds(d, e);
    if (b) rects.push(b);
  }
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return unionRect(rects);
}

export function selectionBounds(d: Diagram, ids: string[]): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const n = d.nodes[id];
    if (n) {
      rects.push(nodeBounds(n));
      continue;
    }
    const e = d.edges[id];
    if (e) {
      const b = edgeBounds(d, e);
      if (b) rects.push(expandRect(b, 2));
    }
  }
  return rects.length ? unionRect(rects) : null;
}

/* -------------------------------------------------------------- ordering */

export function normalizeOrder(d: Diagram): void {
  const seen = new Set<string>();
  d.order = d.order.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return !!(d.nodes[id] || d.edges[id]);
  });
  for (const id of Object.keys(d.nodes)) if (!seen.has(id)) d.order.push(id);
  for (const id of Object.keys(d.edges)) if (!seen.has(id)) d.order.push(id);
  d.order.forEach((id, i) => {
    if (d.nodes[id]) d.nodes[id].z = i;
    else if (d.edges[id]) d.edges[id].z = i;
  });
}

export type ZCommand = 'front' | 'forward' | 'backward' | 'back';

export function reorder(d: Diagram, ids: string[], cmd: ZCommand): void {
  const set = new Set(ids);
  const moving = d.order.filter((id) => set.has(id));
  const rest = d.order.filter((id) => !set.has(id));
  if (moving.length === 0) return;

  if (cmd === 'front') {
    d.order = [...rest, ...moving];
  } else if (cmd === 'back') {
    d.order = [...moving, ...rest];
  } else if (cmd === 'forward') {
    const next = [...d.order];
    for (let i = next.length - 2; i >= 0; i--) {
      if (set.has(next[i]) && !set.has(next[i + 1])) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
    d.order = next;
  } else {
    const next = [...d.order];
    for (let i = 1; i < next.length; i++) {
      if (set.has(next[i]) && !set.has(next[i - 1])) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
    d.order = next;
  }
  normalizeOrder(d);
}

/* ------------------------------------------------------------- alignment */

export type AlignMode =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v';

export function alignNodes(d: Diagram, ids: string[], mode: AlignMode): void {
  const nodes = ids.map((id) => d.nodes[id]).filter(Boolean) as Node[];
  if (nodes.length < 2) return;
  const rects = nodes.map(nodeBounds);
  const box = unionRect(rects);
  nodes.forEach((n, i) => {
    if (n.locked) return;
    const r = rects[i];
    switch (mode) {
      case 'left':
        n.x += box.x - r.x;
        break;
      case 'right':
        n.x += box.x + box.w - (r.x + r.w);
        break;
      case 'top':
        n.y += box.y - r.y;
        break;
      case 'bottom':
        n.y += box.y + box.h - (r.y + r.h);
        break;
      case 'center-h':
        n.x += box.x + box.w / 2 - (r.x + r.w / 2);
        break;
      case 'center-v':
        n.y += box.y + box.h / 2 - (r.y + r.h / 2);
        break;
    }
  });
}

export function distributeNodes(
  d: Diagram,
  ids: string[],
  axis: 'h' | 'v',
): void {
  const nodes = ids.map((id) => d.nodes[id]).filter(Boolean) as Node[];
  if (nodes.length < 3) return;
  const withRects = nodes.map((n) => ({ n, r: nodeBounds(n) }));
  withRects.sort((a, b) =>
    axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y,
  );
  const first = withRects[0].r;
  const last = withRects[withRects.length - 1].r;
  const span =
    axis === 'h'
      ? last.x + last.w / 2 - (first.x + first.w / 2)
      : last.y + last.h / 2 - (first.y + first.h / 2);
  const step = span / (withRects.length - 1);
  withRects.forEach(({ n, r }, i) => {
    if (i === 0 || i === withRects.length - 1 || n.locked) return;
    if (axis === 'h') {
      const target = first.x + first.w / 2 + step * i;
      n.x += target - (r.x + r.w / 2);
    } else {
      const target = first.y + first.h / 2 + step * i;
      n.y += target - (r.y + r.h / 2);
    }
  });
}

/* -------------------------------------------------------------- grouping */

export function groupMembers(d: Diagram, groupId: string): string[] {
  return d.groups[groupId]?.memberIds ?? [];
}

/** Expand a selection so that picking one group member picks the whole group. */
export function expandSelectionToGroups(d: Diagram, ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const n = d.nodes[id];
    if (n?.groupId && d.groups[n.groupId]) {
      for (const m of d.groups[n.groupId].memberIds) out.add(m);
    } else {
      out.add(id);
    }
  }
  return [...out];
}

/* --------------------------------------------------------------- removal */

/**
 * Delete objects. Edges attached to a removed node are converted to floating
 * endpoints rather than silently dropped, so undo never resurrects a dangling
 * reference and the generated LaTeX stays valid.
 */
export function removeObjects(d: Diagram, ids: string[]): void {
  const set = new Set(ids);
  for (const id of ids) {
    if (d.nodes[id]) {
      for (const e of edgesForNode(d, id)) {
        if (set.has(e.id)) continue;
        const route = routeEdge(d, e);
        if (e.source.nodeId === id) {
          e.source = { point: route ? { ...route.start } : { x: 0, y: 0 } };
        }
        if (e.target.nodeId === id) {
          e.target = { point: route ? { ...route.end } : { x: 0, y: 0 } };
        }
      }
      const groupId = d.nodes[id].groupId;
      if (groupId && d.groups[groupId]) {
        d.groups[groupId].memberIds = d.groups[groupId].memberIds.filter(
          (m) => m !== id,
        );
        if (d.groups[groupId].memberIds.length < 2) delete d.groups[groupId];
      }
      delete d.nodes[id];
    } else if (d.edges[id]) {
      delete d.edges[id];
    }
  }
  d.order = d.order.filter((id) => d.nodes[id] || d.edges[id]);
  normalizeOrder(d);
}

/* -------------------------------------------------------------- snapping */

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const SNAP_TOLERANCE = 6;

/**
 * Snap a moving bounding box to the grid and to the edges/centres of other
 * nodes. Returns the correction to apply, plus guides for rendering.
 */
export function computeSnap(
  d: Diagram,
  moving: Rect,
  excludeIds: string[],
  opts: { grid: boolean; objects: boolean; gridSize: number },
): SnapResult {
  const exclude = new Set(excludeIds);
  let dx = 0;
  let dy = 0;
  const guides: SnapGuide[] = [];

  if (opts.objects) {
    const targets = Object.values(d.nodes)
      .filter((n) => !exclude.has(n.id))
      .map(nodeBounds);

    const movingX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
    const movingY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

    let bestX: { delta: number; value: number; other: Rect } | null = null;
    let bestY: { delta: number; value: number; other: Rect } | null = null;

    for (const t of targets) {
      const tx = [t.x, t.x + t.w / 2, t.x + t.w];
      const ty = [t.y, t.y + t.h / 2, t.y + t.h];
      for (const mv of movingX) {
        for (const tv of tx) {
          const delta = tv - mv;
          if (
            Math.abs(delta) <= SNAP_TOLERANCE &&
            (!bestX || Math.abs(delta) < Math.abs(bestX.delta))
          ) {
            bestX = { delta, value: tv, other: t };
          }
        }
      }
      for (const mv of movingY) {
        for (const tv of ty) {
          const delta = tv - mv;
          if (
            Math.abs(delta) <= SNAP_TOLERANCE &&
            (!bestY || Math.abs(delta) < Math.abs(bestY.delta))
          ) {
            bestY = { delta, value: tv, other: t };
          }
        }
      }
    }

    if (bestX) {
      dx = bestX.delta;
      guides.push({
        axis: 'x',
        value: bestX.value,
        from: Math.min(moving.y, bestX.other.y),
        to: Math.max(moving.y + moving.h, bestX.other.y + bestX.other.h),
      });
    }
    if (bestY) {
      dy = bestY.delta;
      guides.push({
        axis: 'y',
        value: bestY.value,
        from: Math.min(moving.x, bestY.other.x),
        to: Math.max(moving.x + moving.w, bestY.other.x + bestY.other.w),
      });
    }
  }

  if (opts.grid && dx === 0 && dy === 0) {
    const g = opts.gridSize || 10;
    dx = Math.round(moving.x / g) * g - moving.x;
    dy = Math.round(moving.y / g) * g - moving.y;
    if (Math.abs(dx) > SNAP_TOLERANCE) dx = 0;
    if (Math.abs(dy) > SNAP_TOLERANCE) dy = 0;
  }

  return { dx, dy, guides };
}

export function snapPoint(p: Point, gridSize: number, enabled: boolean): Point {
  if (!enabled || gridSize <= 0) return p;
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
}
