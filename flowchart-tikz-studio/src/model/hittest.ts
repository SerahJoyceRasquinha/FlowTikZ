import type { Diagram, Edge, Node, Point } from './types';
import { getShapeDef, nodeOutline } from './shapes';
import { isClosed, Seg } from './path';
import { cubicAt, distanceToSegment, rotatePoint } from './geometry';
import { routeEdge } from './routing';

/**
 * Pointer hit testing against real shape geometry.
 *
 * The renderer and the TikZ emitter already share one outline function per
 * shape; this module makes the *pointer* share it too. Hit testing against the
 * axis-aligned bounding box would mean a diamond responds well outside its
 * visible edges and a click in the gap between two shapes lands on whichever
 * box happens to reach further - both of which feel broken to draw with.
 *
 * Pure: no DOM, no React. The canvas calls it; the tests call it directly.
 */

/** Sample count per cubic when flattening an outline for containment tests. */
const CURVE_SAMPLES = 16;

/** Flatten an outline into one or more polylines in local coordinates. */
export function flattenOutline(segs: Seg[]): Point[][] {
  const rings: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const finish = () => {
    if (current.length > 1) rings.push(current);
    current = [];
  };

  for (const s of segs) {
    switch (s.c) {
      case 'M':
        finish();
        cursor = s.p;
        start = s.p;
        current = [cursor];
        break;
      case 'L':
        cursor = s.p;
        current.push(cursor);
        break;
      case 'C': {
        for (let i = 1; i <= CURVE_SAMPLES; i++) {
          current.push(cubicAt(cursor, s.c1, s.c2, s.p, i / CURVE_SAMPLES));
        }
        cursor = s.p;
        break;
      }
      case 'Z':
        current.push(start);
        cursor = start;
        break;
    }
  }
  finish();
  return rings;
}

/** Even-odd containment against a single ring. */
export function pointInRing(ring: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to any edge of any ring. */
export function distanceToRings(rings: Point[][], p: Point): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const d = distanceToSegment(p, ring[i - 1], ring[i]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Bring a world point into a node's unrotated local coordinate frame. */
export function toLocalPoint(n: Node, world: Point): Point {
  const centre = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const unrotated = rotatePoint(world, centre, -n.rotation);
  return { x: unrotated.x - n.x, y: unrotated.y - n.y };
}

function inLocalBox(n: Node, local: Point, tolerance: number): boolean {
  return (
    local.x >= -tolerance &&
    local.y >= -tolerance &&
    local.x <= n.w + tolerance &&
    local.y <= n.h + tolerance
  );
}

/**
 * True when `world` is on or inside the node's visible, interactive area.
 *
 * Closed outlines are tested against the filled region, so the whole interior
 * responds - the pointer never has to find the stroke. Shapes whose outline is
 * open (the annotation bracket) or absent (a text label) have no fillable
 * region, so their declared box is the interactive area instead; that is what
 * a user means by "the label", and it keeps every symbol selectable.
 *
 * `tolerance` is a forgiveness margin in diagram units, so small shapes and
 * thin strokes stay easy to hit. It never reaches into a neighbouring shape
 * far enough to steal its clicks: callers pass a few screen pixels' worth.
 */
export function nodeHitTest(n: Node, world: Point, tolerance = 0): boolean {
  if (!n || !Number.isFinite(n.w) || !Number.isFinite(n.h)) return false;
  const local = toLocalPoint(n, world);

  // Cheap rejection first; every branch below is inside the padded box.
  if (!inLocalBox(n, local, tolerance)) return false;

  const def = getShapeDef(n.kind);
  let outline: Seg[];
  try {
    outline = nodeOutline(n);
  } catch {
    return inLocalBox(n, local, tolerance);
  }
  if (def.noOutline || !isClosed(outline)) {
    // Text labels and open brackets: the declared box is the target.
    return inLocalBox(n, local, tolerance);
  }

  const rings = flattenOutline(outline);
  if (rings.length === 0) return inLocalBox(n, local, tolerance);
  for (const ring of rings) {
    if (pointInRing(ring, local)) return true;
  }
  return tolerance > 0 && distanceToRings(rings, local) <= tolerance;
}

/** Distance from a point to an edge's drawn path, or Infinity if unroutable. */
export function edgeDistance(d: Diagram, e: Edge, world: Point): number {
  let route;
  try {
    route = routeEdge(d, e);
  } catch {
    return Infinity;
  }
  if (!route || route.samples.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < route.samples.length; i++) {
    const dist = distanceToSegment(world, route.samples[i - 1], route.samples[i]);
    if (dist < best) best = dist;
  }
  return best;
}

export interface HitResult {
  id: string;
  kind: 'node' | 'edge';
}

/**
 * Topmost object under the pointer.
 *
 * The priority rule, in one sentence: being *inside* a shape beats everything
 * else. Concretely:
 *
 *  - If the pointer is within a shape's real outline, that shape is picked.
 *    A connector routed across the middle of a box can never take the click,
 *    however far in front of it that connector is painted - which is the
 *    behaviour that stops a diagram from feeling like it has an invisible
 *    layer over it.
 *  - Otherwise, a connector painted in front of the nearest shape wins if the
 *    pointer is genuinely on its path. That is the case where the pointer is
 *    in a shape's forgiveness margin rather than in the shape, so aiming at
 *    the line is the only thing the user can have meant.
 *  - Between two shapes, or two connectors, the one in front wins.
 */
export function hitTest(
  d: Diagram,
  world: Point,
  opts: { nodeTolerance?: number; edgeTolerance?: number } = {},
): HitResult | null {
  const nodeTolerance = opts.nodeTolerance ?? 0;
  const edgeTolerance = opts.edgeTolerance ?? 6;

  // `strict` is "the pointer is in the shape"; `node` is "in the shape or
  // within its forgiveness margin". They differ only in a band a few pixels
  // wide outside the outline, and that band is the only place a connector is
  // allowed to compete.
  let node: { id: string; z: number } | null = null;
  let strict = false;
  for (let i = d.order.length - 1; i >= 0; i--) {
    const id = d.order[i];
    const n = d.nodes[id];
    if (!n) continue;
    if (nodeHitTest(n, world, 0)) {
      node = { id, z: i };
      strict = true;
      break;
    }
    if (!node && nodeTolerance > 0 && nodeHitTest(n, world, nodeTolerance)) {
      node = { id, z: i };
    }
  }

  if (node && strict) return { id: node.id, kind: 'node' };

  // Only connectors painted in front of that shape can take the pick, so the
  // scan stops there. Routing every connector on every pointer move is the
  // expensive part of hit testing, and this skips most of it.
  const floor = node ? node.z : -1;
  let edge: { id: string; dist: number } | null = null;
  for (let i = d.order.length - 1; i > floor; i--) {
    const id = d.order[i];
    const e = d.edges[id];
    if (!e) continue;
    const dist = edgeDistance(d, e, world);
    if (dist <= edgeTolerance && (!edge || dist < edge.dist)) {
      edge = { id, dist };
    }
  }

  if (edge) return { id: edge.id, kind: 'edge' };
  if (node) return { id: node.id, kind: 'node' };
  return null;
}

/** Topmost node under the pointer, ignoring connectors. */
export function nodeAtPoint(
  d: Diagram,
  world: Point,
  tolerance = 0,
): Node | null {
  for (let i = d.order.length - 1; i >= 0; i--) {
    const n = d.nodes[d.order[i]];
    if (n && nodeHitTest(n, world, tolerance)) return n;
  }
  return null;
}
