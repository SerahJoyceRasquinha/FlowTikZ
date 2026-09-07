import { describe, expect, it } from 'vitest';
import {
  rotatePoint,
  rotatedBounds,
  normalizeRect,
  unionRect,
  round,
  quadToCubic,
} from '../model/geometry';
import { SHAPE_LIST, getShapeDef, nodePorts } from '../model/shapes';
import { isClosed, segsToSvgPath } from '../model/path';
import { makeEdge, makeNode, emptyDiagram } from '../model/defaults';
import { routeEdge, portAnchor, autoPort, edgeLabelPoint } from '../model/routing';
import { normalizeOrder } from '../model/diagram';

function twoNodeDiagram() {
  const d = emptyDiagram();
  d.nodes.n1 = makeNode('process', 100, 100, { id: 'n1' });
  d.nodes.n2 = makeNode('process', 400, 400, { id: 'n2' });
  d.order = ['n1', 'n2'];
  return d;
}

describe('geometry', () => {
  it('rotates a point about an origin', () => {
    const p = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(round(p.x, 6)).toBe(0);
    expect(round(p.y, 6)).toBe(1);
  });

  it('recomputes the bounding box when a rectangle is rotated', () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, 45);
    // A 100x40 box at 45 degrees becomes a square of side (100+40)/sqrt(2).
    expect(round(b.w, 3)).toBe(round(b.h, 3));
    expect(b.w).toBeCloseTo(140 / Math.SQRT2, 3);
    expect(b.h).toBeGreaterThan(40);
    // A quarter turn swaps the extents exactly.
    const q = rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, 90);
    expect(round(q.w, 6)).toBe(40);
    expect(round(q.h, 6)).toBe(100);
  });

  it('leaves the bounding box alone at zero rotation', () => {
    expect(rotatedBounds({ x: 5, y: 6, w: 10, h: 20 }, 0)).toEqual({
      x: 5,
      y: 6,
      w: 10,
      h: 20,
    });
  });

  it('normalises a rectangle dragged in any direction', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 4 })).toEqual({
      x: 0,
      y: 4,
      w: 10,
      h: 6,
    });
  });

  it('unions rectangles', () => {
    expect(
      unionRect([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 30, h: 15 });
  });

  it('promotes a quadratic to an exact cubic', () => {
    const [c1, c2] = quadToCubic({ x: 0, y: 0 }, { x: 6, y: 6 }, { x: 12, y: 0 });
    expect(c1).toEqual({ x: 4, y: 4 });
    expect(c2).toEqual({ x: 8, y: 4 });
  });
});

describe('shape definitions', () => {
  it('provides a non-empty outline for every registered shape', () => {
    for (const def of SHAPE_LIST) {
      const segs = def.outline(120, 80);
      expect(segs.length, def.id).toBeGreaterThan(1);
      expect(segsToSvgPath(segs).startsWith('M'), def.id).toBe(true);
    }
  });

  it('keeps every outline inside its declared box', () => {
    for (const def of SHAPE_LIST) {
      for (const seg of def.outline(120, 80)) {
        if (seg.c === 'Z') continue;
        const points = seg.c === 'C' ? [seg.c1, seg.c2, seg.p] : [seg.p];
        for (const p of points) {
          expect(p.x, `${def.id} x`).toBeGreaterThanOrEqual(-1);
          expect(p.x, `${def.id} x`).toBeLessThanOrEqual(121);
          expect(p.y, `${def.id} y`).toBeGreaterThanOrEqual(-1);
          expect(p.y, `${def.id} y`).toBeLessThanOrEqual(81);
        }
      }
    }
  });

  it('closes fillable shapes and leaves brackets open', () => {
    expect(isClosed(getShapeDef('process').outline(10, 10))).toBe(true);
    expect(isClosed(getShapeDef('annotation').outline(10, 10))).toBe(false);
  });

  it('survives degenerate sizes without producing NaN', () => {
    for (const def of SHAPE_LIST) {
      const path = segsToSvgPath(def.outline(1, 1));
      expect(path.includes('NaN'), def.id).toBe(false);
    }
  });

  it('exposes at least four ports on every shape', () => {
    for (const def of SHAPE_LIST) {
      const n = makeNode(def.id, 0, 0);
      expect(nodePorts(n).length, def.id).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('connector routing', () => {
  it('anchors to the requested port in world coordinates', () => {
    const n = makeNode('process', 100, 100, { id: 'n1', w: 100, h: 50 });
    expect(portAnchor(n, 'n').p).toEqual({ x: 150, y: 100 });
    expect(portAnchor(n, 's').p).toEqual({ x: 150, y: 150 });
    expect(portAnchor(n, 'e').p).toEqual({ x: 200, y: 125 });
  });

  it('rotates port anchors with the shape', () => {
    const n = makeNode('process', 0, 0, { id: 'n1', w: 100, h: 100, rotation: 90 });
    const a = portAnchor(n, 'n');
    expect(round(a.p.x)).toBe(100);
    expect(round(a.p.y)).toBe(50);
    expect(round(a.dir.x)).toBe(1);
  });

  it('follows the shape when it moves', () => {
    const d = twoNodeDiagram();
    const edge = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 's' },
      target: { nodeId: 'n2', port: 'n' },
      routing: 'straight',
    });
    d.edges.e1 = edge;
    d.order.push('e1');
    const before = routeEdge(d, edge)!;
    d.nodes.n1.x += 60;
    const after = routeEdge(d, edge)!;
    expect(after.start.x - before.start.x).toBe(60);
    expect(after.end).toEqual(before.end);
  });

  it('picks a facing port in auto mode', () => {
    const n = makeNode('process', 0, 0, { id: 'n1', w: 100, h: 100 });
    expect(autoPort(n, { x: 500, y: 50 })).toBe('e');
    expect(autoPort(n, { x: 50, y: -500 })).toBe('n');
  });

  it('produces geometry for every routing style', () => {
    const d = twoNodeDiagram();
    for (const routing of [
      'straight',
      'orthogonal',
      'rounded-orthogonal',
      'curved',
      'bezier',
      'zigzag',
      'polyline',
    ] as const) {
      const edge = makeEdge({
        id: `e-${routing}`,
        source: { nodeId: 'n1', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
        routing,
        bend: 40,
      });
      const route = routeEdge(d, edge)!;
      expect(route, routing).not.toBeNull();
      expect(route.totalLength, routing).toBeGreaterThan(0);
      expect(route.segs[0].c, routing).toBe('M');
    }
  });

  it('emits cubic segments for curved routes and lines for elbows', () => {
    const d = twoNodeDiagram();
    const curved = routeEdge(
      d,
      makeEdge({
        id: 'e1',
        source: { nodeId: 'n1', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
        routing: 'curved',
        bend: 50,
      }),
    )!;
    expect(curved.segs.some((s) => s.c === 'C')).toBe(true);

    const elbow = routeEdge(
      d,
      makeEdge({
        id: 'e2',
        source: { nodeId: 'n1', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
        routing: 'orthogonal',
      }),
    )!;
    expect(elbow.segs.every((s) => s.c === 'M' || s.c === 'L')).toBe(true);
    expect(elbow.segs.length).toBeGreaterThan(2);
  });

  it('rounds elbow corners into cubics when asked', () => {
    const d = twoNodeDiagram();
    const route = routeEdge(
      d,
      makeEdge({
        id: 'e1',
        source: { nodeId: 'n1', port: 'e' },
        target: { nodeId: 'n2', port: 'n' },
        routing: 'rounded-orthogonal',
        cornerRadius: 12,
      }),
    )!;
    expect(route.segs.some((s) => s.c === 'C')).toBe(true);
  });

  it('generates alternating offsets for zig-zag routes', () => {
    const d = twoNodeDiagram();
    const route = routeEdge(
      d,
      makeEdge({
        id: 'e1',
        source: { nodeId: 'n1', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
        routing: 'zigzag',
      }),
    )!;
    expect(route.segs.length).toBeGreaterThan(4);
  });

  it('routes to a floating point when there is no target shape', () => {
    const d = twoNodeDiagram();
    const route = routeEdge(
      d,
      makeEdge({
        id: 'e1',
        source: { nodeId: 'n1', port: 's' },
        target: { point: { x: 700, y: 700 } },
        routing: 'straight',
      }),
    )!;
    expect(route.end).toEqual({ x: 700, y: 700 });
  });

  it('returns null when an endpoint references a missing shape', () => {
    const d = twoNodeDiagram();
    const route = routeEdge(
      d,
      makeEdge({
        id: 'e1',
        source: { nodeId: 'ghost', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
      }),
    );
    expect(route).toBeNull();
  });

  it('places a label along the path with a perpendicular offset', () => {
    const d = twoNodeDiagram();
    const edge = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 's' },
      target: { nodeId: 'n2', port: 'n' },
      routing: 'straight',
    });
    const route = routeEdge(d, edge)!;
    const mid = edgeLabelPoint(route, 0.5, 0);
    const offset = edgeLabelPoint(route, 0.5, 20);
    expect(Math.hypot(offset.x - mid.x, offset.y - mid.y)).toBeCloseTo(20, 1);
  });

  it('is deterministic: identical input gives identical geometry', () => {
    const d = twoNodeDiagram();
    const edge = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 'auto' },
      target: { nodeId: 'n2', port: 'auto' },
      routing: 'orthogonal',
    });
    expect(JSON.stringify(routeEdge(d, edge))).toBe(
      JSON.stringify(routeEdge(d, edge)),
    );
  });
});

describe('order normalisation', () => {
  it('removes duplicates and dangling ids, and adds missing ones', () => {
    const d = twoNodeDiagram();
    d.order = ['n1', 'n1', 'ghost'];
    normalizeOrder(d);
    expect(d.order).toEqual(['n1', 'n2']);
    expect(d.nodes.n2.z).toBe(1);
  });
});
