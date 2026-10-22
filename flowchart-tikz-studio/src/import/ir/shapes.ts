import type { Node, Point, Rect } from '../../model/types';
import type { Seg } from '../../model/path';
import { getShapeDef } from '../../model/shapes';
import { makeNode } from '../../model/defaults';
import { flattenOutline } from '../../model/hittest';
import { distanceToSegment } from '../../model/geometry';
import type { IRObject, IRShapeType } from './types';

/**
 * The bridge between the IR's semantic shape vocabulary and the application's
 * shape registry. Both directions live here so they cannot drift apart.
 */

/** IR type -> native registry kind. `polygon`/`path` become `freeform`. */
export const IR_TO_KIND: Record<IRShapeType, string> = {
  rectangle: 'process',
  'rounded-rectangle': 'process',
  terminator: 'terminator',
  ellipse: 'ellipse',
  circle: 'ellipse',
  diamond: 'decision',
  parallelogram: 'io',
  hexagon: 'preparation',
  trapezoid: 'manual-operation',
  triangle: 'extract',
  'inverted-triangle': 'merge',
  document: 'document',
  'multi-document': 'multi-document',
  cylinder: 'database',
  'predefined-process': 'predefined',
  'manual-input': 'manual-input',
  delay: 'delay',
  display: 'display',
  'off-page': 'offpage',
  note: 'note',
  card: 'card',
  'stored-data': 'stored-data',
  'internal-storage': 'internal-storage',
  'direct-access-storage': 'direct-access-storage',
  'loop-limit': 'loop-limit',
  or: 'or',
  'summing-junction': 'summing-junction',
  annotation: 'annotation',
  text: 'text',
  polygon: 'freeform',
  path: 'freeform',
  image: 'process',
};

/** Native kind -> IR type, for writing the reconstruction SVG. */
export const KIND_TO_IR: Record<string, IRShapeType> = {
  terminator: 'terminator',
  process: 'rectangle',
  rectangle: 'rectangle',
  decision: 'diamond',
  io: 'parallelogram',
  predefined: 'predefined-process',
  preparation: 'hexagon',
  'manual-input': 'manual-input',
  'manual-operation': 'trapezoid',
  delay: 'delay',
  display: 'display',
  connector: 'circle',
  offpage: 'off-page',
  merge: 'inverted-triangle',
  extract: 'triangle',
  or: 'or',
  'summing-junction': 'summing-junction',
  document: 'document',
  'multi-document': 'multi-document',
  database: 'cylinder',
  'stored-data': 'stored-data',
  'internal-storage': 'internal-storage',
  'direct-access-storage': 'direct-access-storage',
  card: 'card',
  'loop-limit': 'loop-limit',
  ellipse: 'ellipse',
  text: 'text',
  note: 'note',
  annotation: 'annotation',
  freeform: 'path',
};

/** Native kind for an IR object, before any outline matching. */
export function kindForObject(o: Pick<IRObject, 'shape' | 'w' | 'h'>): string {
  if (o.shape === 'circle') {
    // A small circle in a flowchart is the on-page connector symbol.
    return Math.abs(o.w - o.h) <= Math.max(1, 0.04 * o.w) && Math.max(o.w, o.h) <= 80 ? 'connector' : 'ellipse';
  }
  return IR_TO_KIND[o.shape] ?? 'process';
}

/** A throwaway node of a given kind and box, for asking the registry for geometry. */
export function probeNode(kind: string, box: Rect, cornerRadius = 0): Node {
  const n = makeNode(kind, box.x, box.y, { id: '__probe', w: box.w, h: box.h });
  n.style.cornerRadius = cornerRadius;
  return n;
}

/** Outline of a native kind laid out in `box`, in absolute coordinates. */
export function nativeOutline(kind: string, box: Rect, cornerRadius = 0): Seg[] {
  const node = probeNode(kind, box, cornerRadius);
  const local = getShapeDef(kind).outline(box.w, box.h, node);
  return translate(local, box.x, box.y);
}

/** Outline plus inner strokes (a cylinder's lid, a predefined process's bars). */
export function nativeGeometry(kind: string, box: Rect, cornerRadius = 0): Seg[] {
  const def = getShapeDef(kind);
  const node = probeNode(kind, box, cornerRadius);
  const decorations = def.decorations ? def.decorations(box.w, box.h, node) : [];
  return translate([...def.outline(box.w, box.h, node), ...decorations.flat()], box.x, box.y);
}

export function translate(segs: Seg[], dx: number, dy: number): Seg[] {
  const t = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return segs.map((s) =>
    s.c === 'Z' ? s : s.c === 'C' ? { c: 'C', c1: t(s.c1), c2: t(s.c2), p: t(s.p) } : { c: s.c, p: t(s.p) },
  );
}

/* ------------------------------------------------------ outline matching */

function samplePolyline(rings: Point[][], step: number): Point[] {
  const out: Point[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    if (ring.length) out.push(ring[ring.length - 1]);
  }
  return out;
}

function distToRings(p: Point, rings: Point[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const d = distanceToSegment(p, ring[i - 1], ring[i]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Symmetric Hausdorff distance between two outlines. */
export function outlineDeviation(a: Seg[], b: Seg[], step = 2): number {
  const ra = flattenOutline(a);
  const rb = flattenOutline(b);
  if (!ra.length || !rb.length) return Infinity;
  let worst = 0;
  for (const p of samplePolyline(ra, step)) worst = Math.max(worst, distToRings(p, rb));
  for (const p of samplePolyline(rb, step)) worst = Math.max(worst, distToRings(p, ra));
  return worst;
}

export function segsBounds(segs: Seg[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const visit = (p: Point) => {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  // Curve bounds come from the flattened curve, not the control hull.
  for (const ring of flattenOutline(segs)) ring.forEach(visit);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Kinds worth testing a closed outline against, cheapest first. */
const CANDIDATES = [
  'process',
  'decision',
  'ellipse',
  'terminator',
  'io',
  'preparation',
  'manual-operation',
  'manual-input',
  'extract',
  'merge',
  'offpage',
  'card',
  'loop-limit',
  'note',
  'document',
  'database',
  'delay',
  'display',
  'stored-data',
  'direct-access-storage',
  'predefined',
  'internal-storage',
  'multi-document',
  'or',
  'summing-junction',
];

export interface OutlineMatch {
  kind: string;
  cornerRadius: number;
  /** Largest distance between the source outline and the native one, in px. */
  deviation: number;
}

/**
 * Recognise a closed outline as a native symbol.
 *
 * The comparison is geometric - the symmetric Hausdorff distance between the
 * source outline and the registry's own outline for the same box - so the
 * answer is exactly "does the native shape trace the same line", not a
 * heuristic on vertex counts. The tolerance scales with the shape so a
 * hand-drawn-looking polygon is not forced into a symbol it merely resembles.
 */
export function matchOutline(segs: Seg[], opts: { tolerance?: number } = {}): OutlineMatch | null {
  if (!segs.some((s) => s.c === 'Z')) return null;
  const box = segsBounds(segs);
  if (box.w < 2 || box.h < 2) return null;
  const tol = opts.tolerance ?? Math.max(1.5, Math.min(box.w, box.h) * 0.045);

  // Estimate a corner radius for the rounded-rectangle candidate from how far
  // the outline stays from the box's top-left corner.
  const rings = flattenOutline(segs);
  const cornerGap = distToRings({ x: box.x, y: box.y }, rings);
  const radius = cornerGap > 0.75 ? Math.min(box.w / 2, box.h / 2, cornerGap / (Math.SQRT2 - 1)) : 0;

  let best: OutlineMatch | null = null;
  for (const kind of CANDIDATES) {
    const radii = kind === 'process' && radius > 0 ? [radius, 0] : [0];
    for (const r of radii) {
      // Inner strokes count: a rectangle with two bars is a predefined
      // process, and a plain rectangle is not.
      const dev = outlineDeviation(segs, nativeGeometry(kind, box, r));
      if (dev <= tol && (!best || dev < best.deviation)) best = { kind, cornerRadius: r, deviation: dev };
    }
    if (best && best.deviation < 0.5) break;
  }
  if (best && best.kind === 'process' && best.cornerRadius >= Math.min(box.w, box.h) / 2 - 0.5) {
    best = { ...best, kind: 'terminator', cornerRadius: 0 };
  }
  return best;
}
