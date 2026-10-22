import { describe, expect, it } from 'vitest';
import {
  edgeDistance,
  flattenOutline,
  hitTest,
  nodeAtPoint,
  nodeHitTest,
  pointInRing,
  toLocalPoint,
} from '../model/hittest';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import { SHAPE_LIST, nodeOutline } from '../model/shapes';
import { isClosed } from '../model/path';

function centreOf(n: { x: number; y: number; w: number; h: number }) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

describe('flattening an outline', () => {
  it('produces a closed ring for a closed shape', () => {
    const n = makeNode('rectangle', 0, 0, { id: 'n1', w: 100, h: 60 });
    const rings = flattenOutline(nodeOutline(n));
    expect(rings).toHaveLength(1);
    const ring = rings[0];
    expect(ring.length).toBeGreaterThan(3);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('samples curves rather than cutting the corner', () => {
    const n = makeNode('ellipse', 0, 0, { id: 'n1', w: 100, h: 100 });
    const ring = flattenOutline(nodeOutline(n))[0];
    // Every sample sits on the circle of radius 50 about the centre.
    for (const p of ring) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeGreaterThan(46);
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeLessThan(50.5);
    }
  });

  it('tests containment with an even-odd rule', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(pointInRing(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInRing(square, { x: 15, y: 5 })).toBe(false);
    expect(pointInRing(square, { x: -1, y: 5 })).toBe(false);
  });
});

describe('hitting a shape', () => {
  it('hits the interior of every shape in the registry, not just its border', () => {
    for (const def of SHAPE_LIST) {
      const n = makeNode(def.id, 100, 100, { id: 'n1' });
      const c = centreOf(n);
      expect(nodeHitTest(n, c), `${def.id}: centre should hit`).toBe(true);
      // A point plainly outside the box never hits.
      expect(
        nodeHitTest(n, { x: n.x - 40, y: n.y - 40 }),
        `${def.id}: outside should miss`,
      ).toBe(false);
    }
  });

  it('respects the actual geometry of a diamond instead of its bounding box', () => {
    const n = makeNode('decision', 0, 0, { id: 'n1', w: 200, h: 200 });
    // Centre: inside. Top-left corner of the bounding box: outside the diamond.
    expect(nodeHitTest(n, { x: 100, y: 100 })).toBe(true);
    expect(nodeHitTest(n, { x: 4, y: 4 })).toBe(false);
    // Just inside the sloping edge, where a bounding box would be wrong.
    expect(nodeHitTest(n, { x: 55, y: 100 })).toBe(true);
    expect(nodeHitTest(n, { x: 20, y: 30 })).toBe(false);
  });

  it('respects the geometry of a triangle', () => {
    const n = makeNode('extract', 0, 0, { id: 'n1', w: 100, h: 100 });
    // Apex at the top middle, base along the bottom.
    expect(nodeHitTest(n, { x: 50, y: 80 })).toBe(true);
    expect(nodeHitTest(n, { x: 5, y: 5 })).toBe(false);
    expect(nodeHitTest(n, { x: 95, y: 5 })).toBe(false);
  });

  it('treats the whole box of a text label as its target', () => {
    const n = makeNode('text', 0, 0, { id: 'n1', w: 120, h: 40 });
    // A text label has no fill to click, so its declared box is the target.
    expect(nodeHitTest(n, { x: 60, y: 20 })).toBe(true);
    expect(nodeHitTest(n, { x: 5, y: 35 })).toBe(true);
    expect(nodeHitTest(n, { x: 140, y: 20 })).toBe(false);
  });

  it('treats the whole box of an open annotation bracket as its target', () => {
    const n = makeNode('annotation', 0, 0, { id: 'n1', w: 120, h: 90 });
    expect(isClosed(nodeOutline(n))).toBe(false);
    expect(nodeHitTest(n, { x: 80, y: 45 })).toBe(true);
    expect(nodeHitTest(n, { x: 200, y: 45 })).toBe(false);
  });

  it('follows the shape when it is rotated', () => {
    const n = makeNode('rectangle', 0, 0, { id: 'n1', w: 200, h: 40, rotation: 90 });
    // Rotated a quarter turn about its centre, the box now runs vertically.
    expect(nodeHitTest(n, { x: 100, y: 20 })).toBe(true);
    expect(nodeHitTest(n, { x: 100, y: 100 })).toBe(true);
    expect(nodeHitTest(n, { x: 190, y: 20 })).toBe(false);
    const local = toLocalPoint(n, { x: 100, y: 100 });
    expect(local.x).toBeCloseTo(180, 5);
    expect(local.y).toBeCloseTo(20, 5);
  });

  it('gives a forgiveness margin without reaching into the next shape', () => {
    const n = makeNode('rectangle', 0, 0, { id: 'n1', w: 100, h: 60 });
    expect(nodeHitTest(n, { x: 102, y: 30 }, 0)).toBe(false);
    expect(nodeHitTest(n, { x: 102, y: 30 }, 4)).toBe(true);
    expect(nodeHitTest(n, { x: 120, y: 30 }, 4)).toBe(false);
  });

  it('stays sane for a shape squeezed to nothing', () => {
    const n = makeNode('decision', 0, 0, { id: 'n1', w: 1, h: 1 });
    expect(() => nodeHitTest(n, { x: 0.5, y: 0.5 }, 2)).not.toThrow();
    expect(nodeHitTest(n, { x: 500, y: 500 }, 2)).toBe(false);
  });

  it('refuses a node whose geometry is not a number', () => {
    const n = makeNode('rectangle', 0, 0, { id: 'n1' });
    n.w = Number.NaN;
    expect(nodeHitTest(n, { x: 0, y: 0 }, 4)).toBe(false);
  });
});

describe('picking from a diagram', () => {
  function stack() {
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('rectangle', 0, 0, { id: 'n1', w: 200, h: 200 });
    d.nodes.n2 = makeNode('rectangle', 100, 100, { id: 'n2', w: 200, h: 200 });
    d.order = ['n1', 'n2'];
    return d;
  }

  it('picks the shape painted in front where two overlap', () => {
    const d = stack();
    expect(nodeAtPoint(d, { x: 150, y: 150 })?.id).toBe('n2');
    expect(nodeAtPoint(d, { x: 50, y: 50 })?.id).toBe('n1');
    // Reversing the paint order reverses the pick, predictably.
    d.order = ['n2', 'n1'];
    expect(nodeAtPoint(d, { x: 150, y: 150 })?.id).toBe('n1');
  });

  it('does not select a shape the pointer is merely near', () => {
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('decision', 0, 0, { id: 'n1', w: 200, h: 200 });
    d.order = ['n1'];
    // Inside the bounding box, outside the diamond: nothing is picked.
    expect(nodeAtPoint(d, { x: 10, y: 10 }, 3)).toBeNull();
    expect(hitTest(d, { x: 10, y: 10 }, { nodeTolerance: 3 })).toBeNull();
  });

  it('gives a shape interior priority over a connector crossing it', () => {
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('rectangle', 0, 0, { id: 'n1', w: 300, h: 300 });
    d.nodes.n2 = makeNode('rectangle', 600, 0, { id: 'n2', w: 100, h: 100 });
    // A connector that starts outside and is painted in front of the big box.
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { point: { x: -200, y: 150 } },
      target: { point: { x: 400, y: 150 } },
      routing: 'straight',
    });
    d.order = ['n1', 'n2', 'e1'];

    // Right on the line, but plainly inside the shape: the shape wins.
    expect(hitTest(d, { x: 150, y: 150 })?.id).toBe('n1');
    // The same line, clear of every shape: the connector wins.
    const outside = hitTest(d, { x: -100, y: 150 });
    expect(outside?.id).toBe('e1');
    expect(outside?.kind).toBe('edge');
  });

  it('lets a connector win inside a shape’s forgiveness margin but not inside the shape', () => {
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('rectangle', 0, 0, { id: 'n1', w: 200, h: 200 });
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { point: { x: 206, y: -50 } },
      target: { point: { x: 206, y: 250 } },
      routing: 'straight',
    });
    d.order = ['n1', 'e1'];
    const opts = { nodeTolerance: 4, edgeTolerance: 6 };
    // Four pixels outside the shape's right edge: within its margin, but the
    // connector is right there and painted in front, so the connector wins.
    expect(hitTest(d, { x: 204, y: 100 }, opts)?.id).toBe('e1');
    // One pixel inside the shape: the shape wins, margin or no margin.
    expect(hitTest(d, { x: 199, y: 100 }, opts)?.id).toBe('n1');
  });

  it('prefers a shape the pointer is inside over one it is only near', () => {
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('rectangle', 0, 0, { id: 'n1', w: 100, h: 100 });
    // Painted in front, but the pointer is in its margin rather than in it.
    d.nodes.n2 = makeNode('rectangle', 103, 0, { id: 'n2', w: 100, h: 100 });
    d.order = ['n1', 'n2'];
    expect(hitTest(d, { x: 99, y: 50 }, { nodeTolerance: 5 })?.id).toBe('n1');
  });

  it('lets a connector painted in front win when it is the only thing there', () => {
    const d = emptyDiagram();
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { point: { x: 0, y: 0 } },
      target: { point: { x: 100, y: 0 } },
      routing: 'straight',
    });
    d.order = ['e1'];
    expect(hitTest(d, { x: 50, y: 2 }, { edgeTolerance: 6 })?.id).toBe('e1');
    expect(hitTest(d, { x: 50, y: 40 }, { edgeTolerance: 6 })).toBeNull();
  });

  it('measures distance to a connector along its drawn path', () => {
    const d = emptyDiagram();
    const e = makeEdge({
      id: 'e1',
      source: { point: { x: 0, y: 0 } },
      target: { point: { x: 100, y: 0 } },
      routing: 'straight',
    });
    d.edges.e1 = e;
    d.order = ['e1'];
    expect(edgeDistance(d, e, { x: 50, y: 0 })).toBeCloseTo(0, 6);
    expect(edgeDistance(d, e, { x: 50, y: 10 })).toBeCloseTo(10, 6);
  });

  it('reports Infinity for a connector that cannot be routed', () => {
    const d = emptyDiagram();
    const e = makeEdge({ id: 'e1', source: { nodeId: 'gone' }, target: {} });
    d.edges.e1 = e;
    d.order = ['e1'];
    expect(edgeDistance(d, e, { x: 0, y: 0 })).toBe(Infinity);
    expect(() => hitTest(d, { x: 0, y: 0 })).not.toThrow();
  });

  it('returns nothing for an empty diagram', () => {
    const d = emptyDiagram();
    expect(hitTest(d, { x: 0, y: 0 })).toBeNull();
    expect(nodeAtPoint(d, { x: 0, y: 0 })).toBeNull();
  });
});
