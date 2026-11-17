import type { Diagram, Point } from '../model/types';
import { emptyDiagram } from '../model/defaults';
import { edgeBounds, nodeBounds } from '../model/diagram';
import type { Fragment } from './library';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b2 - y };
}

/** Everything a diagram's objects cover, shapes and connector routes alike, rotation included. */
export function coveredBoxes(d: Diagram, ids?: string[]): Box[] {
  const pick = ids ? new Set(ids) : null;
  const out: Box[] = [];
  for (const n of Object.values(d.nodes)) if (!pick || pick.has(n.id)) out.push(nodeBounds(n));
  for (const e of Object.values(d.edges)) {
    if (pick && !pick.has(e.id)) continue;
    const b = edgeBounds(d, e);
    if (b) out.push(b);
  }
  return out;
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Where to centre a template (in the sense of `insertFragment`) so it does not
 * land on top of existing work.
 *
 * Tries the preferred point (the middle of the view) first, then rings of
 * candidates around it, nearest first, so the template sits right next to
 * the existing work; failing that it goes to the right of everything.
 */
export function freeSpot(frag: Fragment, preferred: Point, doc: Diagram, gap = 40): Point {
  if (frag.nodes.length === 0) return preferred;
  const covered = coveredBoxes(doc);
  if (covered.length === 0) return preferred;
  /*
   * Existing work is treated as one block. Fitting a template into the gaps
   * between someone's shapes would interleave two diagrams; placing it beside
   * the block keeps each one readable.
   */
  const taken = [union(covered) as Box];

  // The point insertFragment centres on: the middle of the shapes' boxes.
  const minX = Math.min(...frag.nodes.map((n) => n.x));
  const minY = Math.min(...frag.nodes.map((n) => n.y));
  const maxX = Math.max(...frag.nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...frag.nodes.map((n) => n.y + n.h));
  const ref = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  // What it really covers, wires and rotated parts included.
  const tmp = emptyDiagram();
  for (const n of frag.nodes) tmp.nodes[n.id] = n;
  for (const e of frag.edges) tmp.edges[e.id] = e;
  const own = union(coveredBoxes(tmp)) as Box;
  const at = (c: Point): Box => ({ x: own.x + c.x - ref.x, y: own.y + c.y - ref.y, w: own.w, h: own.h });
  const free = (c: Point) => !taken.some((t) => overlaps(at(c), t, gap));

  if (free(preferred)) return preferred;
  const step = Math.max(60, Math.min(own.w, own.h) / 2);
  const candidates: Point[] = [];
  for (let ring = 1; ring <= 12; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        candidates.push({ x: preferred.x + dx * step, y: preferred.y + dy * step });
      }
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y));
  for (const c of candidates) if (free(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
  const all = union(taken) as Box;
  return { x: Math.round(all.x + all.w + gap + (ref.x - own.x)), y: Math.round(all.y + (ref.y - own.y)) };
}
