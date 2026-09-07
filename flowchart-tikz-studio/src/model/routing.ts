import type { Diagram, Edge, Endpoint, Node, Point, PortId } from './types';
import { nodePorts } from './shapes';
import {
  add,
  cubicAt,
  cubicTangentAt,
  len,
  lerp,
  norm,
  rotatePoint,
  scale,
  sub,
} from './geometry';
import { Seg } from './path';

export interface Anchor {
  p: Point;
  /** Outward direction at the anchor. */
  dir: Point;
}

export interface Route {
  /** World-space geometry. Consumed verbatim by the SVG and TikZ emitters. */
  segs: Seg[];
  start: Point;
  end: Point;
  /** Direction the arrowhead at the start should point (away from the path). */
  startDir: Point;
  /** Direction the arrowhead at the end should point. */
  endDir: Point;
  /** Flattened polyline for hit testing and label placement. */
  samples: Point[];
  /** Cumulative arc length at each sample. */
  lengths: number[];
  totalLength: number;
}

const STUB = 22;

/** World position of a node's port, honouring rotation. */
export function portAnchor(n: Node, port: PortId): Anchor {
  if (port === 'c') {
    return { p: { x: n.x + n.w / 2, y: n.y + n.h / 2 }, dir: { x: 0, y: -1 } };
  }
  const ports = nodePorts(n);
  const def = ports.find((p) => p.id === port) ?? ports[0];
  const centre = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const world = { x: n.x + def.p.x, y: n.y + def.p.y };
  const p = rotatePoint(world, centre, n.rotation);
  const dir = rotatePoint(
    { x: centre.x + def.dir.x, y: centre.y + def.dir.y },
    centre,
    n.rotation,
  );
  return { p, dir: norm(sub(dir, centre)) };
}

export function availablePorts(n: Node): PortId[] {
  return nodePorts(n).map((p) => p.id);
}

/** Pick the port that best faces `towards`. */
export function autoPort(n: Node, towards: Point): PortId {
  const ports = nodePorts(n);
  const centre = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const want = norm(sub(towards, centre));
  let best = ports[0];
  let bestScore = -Infinity;
  for (const port of ports) {
    const a = portAnchor(n, port.id);
    const facing = a.dir.x * want.x + a.dir.y * want.y;
    const proximity = -len(sub(a.p, towards)) / 1000;
    const score = facing + proximity;
    if (score > bestScore) {
      bestScore = score;
      best = port;
    }
  }
  return best.id;
}

function endpointHint(d: Diagram, e: Endpoint): Point | undefined {
  if (e.point) return e.point;
  if (e.nodeId) {
    const n = d.nodes[e.nodeId];
    if (n) return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }
  return undefined;
}

export function resolveEndpoint(
  d: Diagram,
  e: Endpoint,
  other: Endpoint,
): Anchor | null {
  if (e.point && !e.nodeId) return { p: e.point, dir: { x: 0, y: 0 } };
  if (!e.nodeId) return null;
  const n = d.nodes[e.nodeId];
  if (!n) return null;
  const port =
    !e.port || e.port === 'auto'
      ? autoPort(n, endpointHint(d, other) ?? { x: n.x, y: n.y })
      : e.port;
  return portAnchor(n, port);
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) {
      out.push(p);
    }
  }
  return out;
}

function elbowPoints(a: Anchor, b: Anchor): Point[] {
  const horiz0 = Math.abs(a.dir.x) >= Math.abs(a.dir.y);
  const horiz1 = Math.abs(b.dir.x) >= Math.abs(b.dir.y);
  const s0 = add(a.p, scale(a.dir, STUB));
  const s1 = add(b.p, scale(b.dir, STUB));
  let mid: Point[];
  if (horiz0 && horiz1) {
    const mx = (s0.x + s1.x) / 2;
    mid = [
      { x: mx, y: s0.y },
      { x: mx, y: s1.y },
    ];
  } else if (!horiz0 && !horiz1) {
    const my = (s0.y + s1.y) / 2;
    mid = [
      { x: s0.x, y: my },
      { x: s1.x, y: my },
    ];
  } else if (horiz0) {
    mid = [{ x: s1.x, y: s0.y }];
  } else {
    mid = [{ x: s0.x, y: s1.y }];
  }
  return dedupe([a.p, s0, ...mid, s1, b.p]);
}

/** Insert cubic corner fillets into a polyline. */
function roundPolyline(points: Point[], radius: number): Seg[] {
  if (points.length < 3 || radius <= 0.01) {
    return points.map((p, i) =>
      i === 0 ? ({ c: 'M', p } as Seg) : ({ c: 'L', p } as Seg),
    );
  }
  const segs: Seg[] = [{ c: 'M', p: points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inDir = norm(sub(cur, prev));
    const outDir = norm(sub(next, cur));
    const r = Math.min(
      radius,
      len(sub(cur, prev)) / 2,
      len(sub(next, cur)) / 2,
    );
    const p1 = sub(cur, scale(inDir, r));
    const p2 = add(cur, scale(outDir, r));
    segs.push({ c: 'L', p: p1 });
    // Quarter-circle-ish fillet: control points pulled toward the corner.
    const k = 0.5523;
    segs.push({
      c: 'C',
      c1: add(p1, scale(inDir, r * k)),
      c2: sub(p2, scale(outDir, r * k)),
      p: p2,
    });
  }
  segs.push({ c: 'L', p: points[points.length - 1] });
  return segs;
}

function zigzagPoints(points: Point[], amplitude = 8, wavelength = 18): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = sub(b, a);
    const l = len(d);
    if (l < 1e-6) continue;
    const u = scale(d, 1 / l);
    const nvec = { x: -u.y, y: u.x };
    const count = Math.max(2, Math.round(l / wavelength));
    for (let j = 1; j < count; j++) {
      const t = j / count;
      const base = lerp(a, b, t);
      const side = j % 2 === 0 ? -1 : 1;
      out.push(add(base, scale(nvec, amplitude * side)));
    }
    out.push(b);
  }
  return out;
}

function polylineSegs(points: Point[]): Seg[] {
  return points.map((p, i) =>
    i === 0 ? ({ c: 'M', p } as Seg) : ({ c: 'L', p } as Seg),
  );
}

/** Flatten a segment list into sample points with cumulative arc length. */
export function flatten(segs: Seg[], perCurve = 24) {
  const samples: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const s of segs) {
    if (s.c === 'M') {
      cursor = s.p;
      samples.push(cursor);
    } else if (s.c === 'L') {
      cursor = s.p;
      samples.push(cursor);
    } else if (s.c === 'C') {
      for (let i = 1; i <= perCurve; i++) {
        samples.push(cubicAt(cursor, s.c1, s.c2, s.p, i / perCurve));
      }
      cursor = s.p;
    }
  }
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1] + len(sub(samples[i], samples[i - 1])));
  }
  return { samples, lengths, totalLength: lengths[lengths.length - 1] ?? 0 };
}

export function pointAtFraction(route: Route, t: number): Point {
  const target = route.totalLength * Math.min(1, Math.max(0, t));
  const { samples, lengths } = route;
  if (samples.length === 0) return { x: 0, y: 0 };
  for (let i = 1; i < samples.length; i++) {
    if (lengths[i] >= target) {
      const span = lengths[i] - lengths[i - 1];
      const f = span < 1e-9 ? 0 : (target - lengths[i - 1]) / span;
      return lerp(samples[i - 1], samples[i], f);
    }
  }
  return samples[samples.length - 1];
}

export function tangentAtFraction(route: Route, t: number): Point {
  const eps = 0.002;
  const a = pointAtFraction(route, Math.max(0, t - eps));
  const b = pointAtFraction(route, Math.min(1, t + eps));
  const d = sub(b, a);
  return len(d) < 1e-6 ? { x: 1, y: 0 } : norm(d);
}

/**
 * Compute the world-space geometry of an edge. Pure function of the model:
 * calling it twice with the same diagram gives byte-identical output, which is
 * what keeps the generated LaTeX stable between regenerations.
 */
export function routeEdge(d: Diagram, edge: Edge): Route | null {
  const a = resolveEndpoint(d, edge.source, edge.target);
  const b = resolveEndpoint(d, edge.target, edge.source);
  if (!a || !b) return null;

  const waypoints = edge.waypoints ?? [];
  let segs: Seg[];
  let startDir: Point;
  let endDir: Point;

  switch (edge.routing) {
    case 'orthogonal':
    case 'rounded-orthogonal': {
      const pts =
        waypoints.length > 0
          ? dedupe([a.p, ...waypoints, b.p])
          : elbowPoints(a, b);
      segs =
        edge.routing === 'rounded-orthogonal'
          ? roundPolyline(pts, edge.cornerRadius || 10)
          : polylineSegs(pts);
      startDir = norm(sub(pts[0], pts[1] ?? pts[0]));
      endDir = norm(sub(pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]));
      break;
    }
    case 'zigzag': {
      const base = waypoints.length > 0 ? [a.p, ...waypoints, b.p] : [a.p, b.p];
      const pts = zigzagPoints(base);
      segs = polylineSegs(pts);
      startDir = norm(sub(pts[0], pts[1] ?? pts[0]));
      endDir = norm(sub(pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]));
      break;
    }
    case 'polyline': {
      const pts = dedupe([a.p, ...waypoints, b.p]);
      segs = polylineSegs(pts);
      startDir = norm(sub(pts[0], pts[1] ?? pts[0]));
      endDir = norm(sub(pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]));
      break;
    }
    case 'curved': {
      // Quadratic through a perpendicular-displaced midpoint, promoted to a
      // cubic so TikZ can spell it with `.. controls .. and .. ..`.
      const mid = lerp(a.p, b.p, 0.5);
      const dvec = sub(b.p, a.p);
      const nvec = norm({ x: -dvec.y, y: dvec.x });
      const q = add(mid, scale(nvec, edge.bend));
      const c1 = {
        x: a.p.x + (2 / 3) * (q.x - a.p.x),
        y: a.p.y + (2 / 3) * (q.y - a.p.y),
      };
      const c2 = {
        x: b.p.x + (2 / 3) * (q.x - b.p.x),
        y: b.p.y + (2 / 3) * (q.y - b.p.y),
      };
      segs = [
        { c: 'M', p: a.p },
        { c: 'C', c1, c2, p: b.p },
      ];
      startDir = norm(scale(cubicTangentAt(a.p, c1, c2, b.p, 0), -1));
      endDir = cubicTangentAt(a.p, c1, c2, b.p, 1);
      break;
    }
    case 'bezier': {
      const dist = Math.max(40, len(sub(b.p, a.p)) * 0.4);
      const dirA = len(a.dir) > 0 ? a.dir : norm(sub(b.p, a.p));
      const dirB = len(b.dir) > 0 ? b.dir : norm(sub(a.p, b.p));
      const nvec = norm({ x: -(b.p.y - a.p.y), y: b.p.x - a.p.x });
      const c1 = add(add(a.p, scale(dirA, dist)), scale(nvec, edge.bend * 0.5));
      const c2 = add(add(b.p, scale(dirB, dist)), scale(nvec, edge.bend * 0.5));
      segs = [
        { c: 'M', p: a.p },
        { c: 'C', c1, c2, p: b.p },
      ];
      startDir = norm(scale(cubicTangentAt(a.p, c1, c2, b.p, 0), -1));
      endDir = cubicTangentAt(a.p, c1, c2, b.p, 1);
      break;
    }
    case 'straight':
    default: {
      const pts = dedupe([a.p, ...waypoints, b.p]);
      segs = polylineSegs(pts);
      startDir = norm(sub(pts[0], pts[1] ?? pts[0]));
      endDir = norm(sub(pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]));
      break;
    }
  }

  const flat = flatten(segs);
  return {
    segs,
    start: a.p,
    end: b.p,
    startDir,
    endDir,
    samples: flat.samples,
    lengths: flat.lengths,
    totalLength: flat.totalLength,
  };
}

/** Label anchor point in world coordinates. */
export function edgeLabelPoint(route: Route, pos: number, offset: number): Point {
  const p = pointAtFraction(route, pos);
  const t = tangentAtFraction(route, pos);
  const nvec = { x: -t.y, y: t.x };
  return add(p, scale(nvec, offset));
}
