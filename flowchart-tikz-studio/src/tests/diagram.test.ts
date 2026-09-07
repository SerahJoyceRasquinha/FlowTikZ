import { describe, expect, it } from 'vitest';
import {
  alignNodes,
  computeSnap,
  diagramBounds,
  distributeNodes,
  edgesForNode,
  expandSelectionToGroups,
  normalizeOrder,
  removeObjects,
  reorder,
  selectionBounds,
  snapPoint,
} from '../model/diagram';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import type { Diagram } from '../model/types';

function grid(): Diagram {
  const d = emptyDiagram();
  const specs = [
    ['n1', 0, 0, 100, 50],
    ['n2', 200, 30, 60, 90],
    ['n3', 400, 100, 120, 40],
  ] as const;
  for (const [id, x, y, w, h] of specs) {
    d.nodes[id] = makeNode('process', x, y, { id, w, h });
    d.order.push(id);
  }
  normalizeOrder(d);
  return d;
}

describe('bounds', () => {
  it('covers every shape', () => {
    const b = diagramBounds(grid());
    expect(b).toEqual({ x: 0, y: 0, w: 520, h: 140 });
  });

  it('is empty for an empty diagram', () => {
    expect(diagramBounds(emptyDiagram())).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('includes connector geometry', () => {
    const d = grid();
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 'w' },
      target: { point: { x: -200, y: 0 } },
      routing: 'straight',
    });
    d.order.push('e1');
    expect(diagramBounds(d).x).toBe(-200);
  });

  it('returns null when nothing is selected', () => {
    expect(selectionBounds(grid(), [])).toBeNull();
  });
});

describe('z ordering', () => {
  it('brings to front and sends to back', () => {
    const d = grid();
    reorder(d, ['n1'], 'front');
    expect(d.order[2]).toBe('n1');
    reorder(d, ['n1'], 'back');
    expect(d.order[0]).toBe('n1');
  });

  it('steps one position at a time', () => {
    const d = grid();
    reorder(d, ['n1'], 'forward');
    expect(d.order).toEqual(['n2', 'n1', 'n3']);
    reorder(d, ['n1'], 'backward');
    expect(d.order).toEqual(['n1', 'n2', 'n3']);
  });

  it('keeps the z field in step with the order array', () => {
    const d = grid();
    reorder(d, ['n3'], 'back');
    expect(d.nodes.n3.z).toBe(0);
    expect(d.nodes.n1.z).toBe(1);
  });

  it('moves a multi-selection as a block', () => {
    const d = grid();
    reorder(d, ['n1', 'n2'], 'front');
    expect(d.order).toEqual(['n3', 'n1', 'n2']);
  });
});

describe('alignment and distribution', () => {
  it('aligns left edges', () => {
    const d = grid();
    alignNodes(d, ['n1', 'n2', 'n3'], 'left');
    expect([d.nodes.n1.x, d.nodes.n2.x, d.nodes.n3.x]).toEqual([0, 0, 0]);
  });

  it('aligns right edges', () => {
    const d = grid();
    alignNodes(d, ['n1', 'n2', 'n3'], 'right');
    expect(d.nodes.n1.x + d.nodes.n1.w).toBe(520);
    expect(d.nodes.n2.x + d.nodes.n2.w).toBe(520);
  });

  it('aligns horizontal centres', () => {
    const d = grid();
    alignNodes(d, ['n1', 'n2'], 'center-h');
    expect(d.nodes.n1.x + d.nodes.n1.w / 2).toBeCloseTo(d.nodes.n2.x + d.nodes.n2.w / 2);
  });

  it('never moves a locked shape', () => {
    const d = grid();
    d.nodes.n2.locked = true;
    alignNodes(d, ['n1', 'n2', 'n3'], 'left');
    expect(d.nodes.n2.x).toBe(200);
  });

  it('needs two shapes to align and three to distribute', () => {
    const d = grid();
    const before = JSON.stringify(d.nodes);
    alignNodes(d, ['n1'], 'left');
    distributeNodes(d, ['n1', 'n2'], 'h');
    expect(JSON.stringify(d.nodes)).toBe(before);
  });

  it('spaces centres evenly when distributing', () => {
    const d = grid();
    distributeNodes(d, ['n1', 'n2', 'n3'], 'h');
    const centres = ['n1', 'n2', 'n3'].map((id) => d.nodes[id].x + d.nodes[id].w / 2);
    expect(centres[1] - centres[0]).toBeCloseTo(centres[2] - centres[1], 6);
  });
});

describe('deletion', () => {
  it('removes the shape and detaches its connectors instead of dropping them', () => {
    const d = grid();
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 'e' },
      target: { nodeId: 'n2', port: 'w' },
    });
    d.order.push('e1');
    normalizeOrder(d);
    removeObjects(d, ['n2']);
    expect(d.nodes.n2).toBeUndefined();
    expect(d.edges.e1).toBeDefined();
    expect(d.edges.e1.target.nodeId).toBeUndefined();
    expect(d.edges.e1.target.point).toBeDefined();
  });

  it('deletes a connector on its own', () => {
    const d = grid();
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 'e' },
      target: { nodeId: 'n2', port: 'w' },
    });
    d.order.push('e1');
    removeObjects(d, ['e1']);
    expect(d.edges.e1).toBeUndefined();
    expect(d.order).not.toContain('e1');
  });

  it('dissolves a group that drops below two members', () => {
    const d = grid();
    d.groups.g1 = { id: 'g1', memberIds: ['n1', 'n2'] };
    d.nodes.n1.groupId = 'g1';
    d.nodes.n2.groupId = 'g1';
    removeObjects(d, ['n2']);
    expect(d.groups.g1).toBeUndefined();
  });

  it('finds the connectors attached to a shape', () => {
    const d = grid();
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 'e' },
      target: { nodeId: 'n2', port: 'w' },
    });
    expect(edgesForNode(d, 'n1').map((e) => e.id)).toEqual(['e1']);
    expect(edgesForNode(d, 'n3')).toEqual([]);
  });
});

describe('grouping', () => {
  it('expands a selection to every group member', () => {
    const d = grid();
    d.groups.g1 = { id: 'g1', memberIds: ['n1', 'n2'] };
    d.nodes.n1.groupId = 'g1';
    d.nodes.n2.groupId = 'g1';
    expect(expandSelectionToGroups(d, ['n1']).sort()).toEqual(['n1', 'n2']);
  });

  it('leaves ungrouped shapes alone', () => {
    expect(expandSelectionToGroups(grid(), ['n3'])).toEqual(['n3']);
  });
});

describe('snapping', () => {
  it('snaps a point to the grid when enabled', () => {
    expect(snapPoint({ x: 47, y: 13 }, 10, true)).toEqual({ x: 50, y: 10 });
    expect(snapPoint({ x: 47, y: 13 }, 10, false)).toEqual({ x: 47, y: 13 });
  });

  it('snaps a moving box to another shape\'s edge and reports a guide', () => {
    const d = grid();
    const result = computeSnap(
      d,
      { x: 198, y: 300, w: 60, h: 90 },
      ['n9'],
      { grid: false, objects: true, gridSize: 10 },
    );
    expect(result.dx).toBe(2);
    expect(result.guides.some((g) => g.axis === 'x' && g.value === 200)).toBe(true);
  });

  it('ignores the shapes being moved', () => {
    const d = grid();
    const result = computeSnap(
      d,
      { x: 198, y: 30, w: 60, h: 90 },
      ['n2'],
      { grid: false, objects: true, gridSize: 10 },
    );
    expect(result.dx).toBe(0);
  });

  it('falls back to the grid when no object is near', () => {
    const d = grid();
    const result = computeSnap(
      d,
      { x: 997, y: 1003, w: 50, h: 50 },
      [],
      { grid: true, objects: true, gridSize: 10 },
    );
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(-3);
  });

  it('does not snap across large distances', () => {
    const d = grid();
    const result = computeSnap(
      d,
      { x: 140, y: 300, w: 60, h: 90 },
      [],
      { grid: false, objects: true, gridSize: 10 },
    );
    expect(result.dx).toBe(0);
  });
});
