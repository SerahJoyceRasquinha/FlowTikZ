import type { Diagram, Edge, Endpoint, Node, Point, PortId } from '../../model/types';
import { makeEdge } from '../../model/defaults';
import { autoPort, portAnchor, routeEdge } from '../../model/routing';
import { nodePorts } from '../../model/shapes';
import { nodeHitTest } from '../../model/hittest';
import { distanceToSegment, norm, rotatePoint } from '../../model/geometry';
import type { IRConnector, IREndpoint } from '../ir/types';
import type { ReportBuilder } from '../report';
import { mapArrow, mapDash, round2 } from './styleMapper';

/**
 * Connector reconstruction.
 *
 * The goal is a *semantic* connector - bound to its shapes, attached at a
 * named port - because that is what makes it follow the shapes when they are
 * moved afterwards, exactly as a connector drawn by hand does. Source
 * geometry is only kept as explicit waypoints when the native router would
 * draw something visibly different; a route the router reproduces on its own
 * is left to the router, so it stays live.
 */

export interface ConnectorContext {
  diagram: Diagram;
  /** Diagram node for an IR object id. */
  nodeFor: (irId: string | undefined) => Node | undefined;
  /** Source px -> diagram units. */
  tf: (p: Point) => Point;
  scale: number;
  report: ReportBuilder;
  /** Attach free ends to shapes they visibly touch. */
  inferAttachments: boolean;
  /** Distance, in diagram units, within which geometry counts as "the same". */
  tolerance: number;
  id: string;
}

export interface MappedConnector {
  edge: Edge;
  /** Ends attached by inference rather than by the source. */
  inferred: number;
  /** Ends left floating. */
  free: number;
}

/** Nearest port of `n` to a world point, and how far it is. */
export function nearestPort(n: Node, p: Point): { port: PortId; dist: number } {
  let best: { port: PortId; dist: number } = { port: 'auto', dist: Infinity };
  for (const def of nodePorts(n)) {
    const a = portAnchor(n, def.id).p;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < best.dist) best = { port: def.id, dist: d };
  }
  return best;
}

/** The node whose outline a point touches, preferring the smallest such node. */
export function touchedNode(d: Diagram, p: Point, tolerance: number, exclude?: string): Node | undefined {
  let best: { n: Node; area: number } | undefined;
  for (const n of Object.values(d.nodes)) {
    if (!n || n.id === exclude || n.kind === 'text') continue;
    if (nodeHitTest(n, p, tolerance)) {
      const area = n.w * n.h;
      if (!best || area < best.area) best = { n, area };
    }
  }
  return best?.n;
}

function polyDeviation(a: Point[], b: Point[]): number {
  const dist = (p: Point, poly: Point[]) => {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i - 1], poly[i]));
    return poly.length === 1 ? Math.hypot(p.x - poly[0].x, p.y - poly[0].y) : best;
  };
  const densify = (poly: Point[]) => {
    const out: Point[] = [];
    for (let i = 1; i < poly.length; i++) {
      const s = poly[i - 1];
      const e = poly[i];
      const n = Math.max(1, Math.ceil(Math.hypot(e.x - s.x, e.y - s.y) / 4));
      for (let k = 0; k < n; k++) out.push({ x: s.x + ((e.x - s.x) * k) / n, y: s.y + ((e.y - s.y) * k) / n });
    }
    out.push(poly[poly.length - 1]);
    return out;
  };
  let worst = 0;
  for (const p of densify(a)) worst = Math.max(worst, dist(p, b));
  for (const p of densify(b)) worst = Math.max(worst, dist(p, a));
  return worst;
}

function isAxisAligned(points: Point[], eps = 1): boolean {
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dx > eps && dy > eps) return false;
  }
  return true;
}

interface ResolvedEnd {
  endpoint: Endpoint;
  node?: Node;
  inferred: boolean;
}

function resolveEnd(
  ep: IREndpoint | undefined,
  contact: Point | undefined,
  towards: Point | undefined,
  ctx: ConnectorContext,
  otherNodeId?: string,
): ResolvedEnd {
  let node = ctx.nodeFor(ep?.objectId);
  let inferred = false;
  if (!node && contact && ctx.inferAttachments) {
    node = touchedNode(ctx.diagram, contact, ctx.tolerance, otherNodeId);
    inferred = !!node;
  }
  if (!node) {
    return { endpoint: { point: contact ? { ...contact } : { x: 0, y: 0 } }, inferred: false };
  }

  let port: PortId = 'auto';
  const available = new Set(nodePorts(node).map((p) => p.id));
  if (ep?.port && ep.port !== 'auto' && (available.has(ep.port) || ep.port === 'c')) {
    port = ep.port;
  } else if (ep?.fx !== undefined && ep?.fy !== undefined) {
    // A draw.io "exit/entry" constraint: a point on the box, as fractions.
    const centre = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
    const world = rotatePoint({ x: node.x + ep.fx * node.w, y: node.y + ep.fy * node.h }, centre, node.rotation);
    const near = nearestPort(node, world);
    port = near.port;
    if (near.dist > Math.max(3, ctx.tolerance * 0.5)) {
      ctx.report.tally('approximated', 'Connector attachment point moved to the nearest connection point of its shape');
    }
  } else if (contact && !ep?.objectId) {
    // Inferred attachment: the port nearest where the line actually touched.
    port = nearestPort(node, contact).port;
  } else if (contact && ep?.objectId && !ep.floating) {
    port = nearestPort(node, contact).port;
  } else if (towards) {
    // No stated attachment and the route bends: face the first bend, fixed.
    port = autoPort(node, towards);
  }
  return { endpoint: { nodeId: node.id, port }, node, inferred };
}

export function mapConnector(c: IRConnector, ctx: ConnectorContext): MappedConnector {
  const report = ctx.report;
  const pts = c.points.map(ctx.tf);
  const interior = pts.slice(1, -1);
  const srcFloating = !!c.source?.floating;
  const dstFloating = !!c.target?.floating;

  const src = resolveEnd(
    c.source,
    srcFloating ? undefined : pts[0],
    interior[0],
    ctx,
  );
  const dst = resolveEnd(
    c.target,
    dstFloating ? undefined : pts[pts.length - 1],
    interior[interior.length - 1],
    ctx,
    src.node?.id,
  );
  // With nothing else to go on, floating ends attach at the port facing the other end.
  if (src.node && src.endpoint.port === 'auto' && interior.length) src.endpoint.port = autoPort(src.node, interior[0]);
  if (dst.node && dst.endpoint.port === 'auto' && interior.length) dst.endpoint.port = autoPort(dst.node, interior[interior.length - 1]);

  const preserved: Record<string, string | number | boolean> = {};
  const notes: string[] = [];
  const strokeWidth = round2(c.style.strokeWidth * ctx.scale);
  const edge = makeEdge({
    id: ctx.id,
    source: src.endpoint,
    target: dst.endpoint,
    routing: 'straight',
    waypoints: [],
    bend: 0,
    arrowStart: mapArrow(c.arrowStart, report),
    arrowEnd: mapArrow(c.arrowEnd, report),
    arrowSize: round2(
      c.arrowSize !== undefined ? c.arrowSize * ctx.scale : Math.min(20, Math.max(7, 6 + strokeWidth * 2)),
    ),
    stroke: c.style.stroke,
    strokeOpacity: c.style.strokeOpacity,
    strokeWidth,
    strokeStyle: mapDash(c.style.dash, c.style.dashArray, c.style.strokeWidth, report, preserved),
    opacity: c.style.opacity,
    cornerRadius: c.cornerRadius !== undefined ? round2(c.cornerRadius * ctx.scale) : 10,
  });

  /* -------------------------------------------------------- routing */
  const tryRoute = (e: Edge) => routeEdge(ctx.diagram, e);

  if (c.routing === 'curved') {
    edge.routing = 'curved';
    const a0 = pts[0];
    const b0 = pts[pts.length - 1];
    const curve = c.curve?.map((s) =>
      s.c === 'Z' ? s : s.c === 'C' ? { ...s, c1: ctx.tf(s.c1), c2: ctx.tf(s.c2), p: ctx.tf(s.p) } : { ...s, p: ctx.tf(s.p) },
    );
    const cubics = curve?.filter((s) => s.c === 'C') ?? [];
    if (a0 && b0) {
      const mid = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const nvec = norm({ x: -(b0.y - a0.y), y: b0.x - a0.x });
      let q: Point | null = null;
      if (cubics.length === 1 && cubics[0].c === 'C') {
        // A quadratic promoted to a cubic has c1 = a + 2/3 (q - a), so q can
        // be read straight back. Two estimates that disagree mean the source
        // was a genuine cubic, which the model approximates.
        const s = cubics[0];
        const q1 = { x: a0.x + 1.5 * (s.c1.x - a0.x), y: a0.y + 1.5 * (s.c1.y - a0.y) };
        const q2 = { x: b0.x + 1.5 * (s.c2.x - b0.x), y: b0.y + 1.5 * (s.c2.y - b0.y) };
        q = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
        if (Math.hypot(q1.x - q2.x, q1.y - q2.y) > ctx.tolerance) {
          report.tally('approximated', 'Asymmetric curve drawn as the nearest symmetric curve');
        }
      } else if (interior.length) {
        const apex = interior[Math.floor(interior.length / 2)];
        q = { x: mid.x + 2 * (apex.x - mid.x), y: mid.y + 2 * (apex.y - mid.y) };
        if (interior.length > 1 || cubics.length > 1) {
          report.tally('approximated', 'Multi-segment curve drawn as a single smooth curve');
        }
      }
      edge.bend = q ? round2((q.x - mid.x) * nvec.x + (q.y - mid.y) * nvec.y) : 0;
    }
    if (c.curve) preserved.curveSegments = cubics.length;
  } else if (pts.length >= 3 || (c.routing === 'orthogonal' && pts.length >= 2)) {
    const orthogonal = c.routing === 'orthogonal' || isAxisAligned(pts);
    edge.routing = orthogonal ? (c.rounded ? 'rounded-orthogonal' : 'orthogonal') : 'polyline';
    const bound = !!src.node && !!dst.node;
    let simplified = false;
    if (orthogonal && bound) {
      // Would the router, left to itself, draw what the source drew?
      const auto = tryRoute({ ...edge, waypoints: [] });
      if (auto && polyDeviation(auto.samples, pts) <= ctx.tolerance) simplified = true;
    }
    if (!simplified) {
      const wps = interior.map((p) => ({ x: round2(p.x), y: round2(p.y) }));
      if (orthogonal && wps.length) {
        // Keep the first and last legs straight: the anchor may sit a hair
        // away from where the source line met the shape.
        const route = tryRoute({ ...edge, waypoints: [] });
        const a = route?.start ?? pts[0];
        const b = route?.end ?? pts[pts.length - 1];
        const firstVertical = Math.abs(pts[1].x - pts[0].x) < Math.abs(pts[1].y - pts[0].y);
        if (firstVertical) wps[0].x = round2(a.x);
        else wps[0].y = round2(a.y);
        const n = pts.length;
        const lastVertical = Math.abs(pts[n - 1].x - pts[n - 2].x) < Math.abs(pts[n - 1].y - pts[n - 2].y);
        if (lastVertical) wps[wps.length - 1].x = round2(b.x);
        else wps[wps.length - 1].y = round2(b.y);
      }
      edge.waypoints = wps;
    }
  } else {
    edge.routing = 'straight';
  }

  /* ---------------------------------------------------------- label */
  if (c.label) {
    edge.label = {
      text: c.label.text,
      pos: c.label.position,
      offset: round2(c.label.offset * ctx.scale),
      fontSize: round2(Math.max(1, c.label.fontSize * ctx.scale)),
      color: c.label.color,
      background: c.label.background,
    };
    if (c.label.bold || c.label.italic) {
      preserved.labelBold = !!c.label.bold;
      preserved.labelItalic = !!c.label.italic;
      report.tally('style-difference', 'Bold or italic connector labels shown in regular weight');
    }
  }

  const free = (src.node ? 0 : 1) + (dst.node ? 0 : 1);
  const inferred = (src.inferred ? 1 : 0) + (dst.inferred ? 1 : 0);
  if (inferred) notes.push('Attached to the shape its line touched.');

  if (Object.keys(preserved).length || notes.length || c.sourceId || c.confidence !== undefined) {
    edge.meta = {
      import: {
        format: '',
        ...(c.sourceId ? { sourceId: c.sourceId } : {}),
        ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
        ...(Object.keys(preserved).length ? { preserved: { ...c.preserved, ...preserved } } : c.preserved ? { preserved: { ...c.preserved } } : {}),
        ...(notes.length ? { notes } : {}),
      },
    };
  }
  return { edge, inferred, free };
}
