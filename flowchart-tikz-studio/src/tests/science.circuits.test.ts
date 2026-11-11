import { beforeEach, describe, expect, it } from 'vitest';
import { CIRCUIT_DEFS, CIRCUIT_GROUPS, bipoleUnit, isCircuitKind } from '../science/physics/circuits';
import { PHYSICS_SHAPE_DEFS } from '../science/physics/diagramShapes';
import { SHAPE_DEFS, SHAPE_LIST, getShapeDef, nodeBodies, nodeDecorations, nodeOutline, nodePorts, nodeSolids } from '../model/shapes';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import { portAnchor, routeEdge } from '../model/routing';
import { useEditor } from '../state/store';
import { resetIdCounters } from '../model/ids';
import { circuitGallery } from '../science/gallery';
import { generateLatex } from '../latex/generator';
import { hitTest } from '../model/hittest';
import type { Diagram, Edge } from '../model/types';
import { emptyCircuitSpec } from '../science/types';

const s = () => useEditor.getState();

beforeEach(() => {
  resetIdCounters();
  useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [], snapshot: null, clipboard: null, dirty: false, tool: 'select', pendingShape: null });
});

const PT_TO_DU = 50 / 28.4527559;

describe('component library', () => {
  it('covers every requested component', () => {
    const names = CIRCUIT_DEFS.map((d) => d.label.toLowerCase()).join('|');
    for (const need of ['resistor', 'variable resistor', 'potentiometer', 'capacitor', 'variable capacitor', 'inductor', 'cell', 'battery', 'dc voltage', 'ac voltage', 'current source', 'switch (open)', 'switch (closed)', 'ground', 'earth', 'diode', 'led', 'zener', 'npn', 'pnp', 'op-amp', 'fuse', 'lamp', 'bulb', 'motor', 'generator', 'transformer', 'ammeter', 'voltmeter', 'junction', 'terminal']) {
      expect(names, need).toContain(need);
    }
  });
  it('registers each component as a real shape, outside the flowchart palette', () => {
    for (const d of CIRCUIT_DEFS) expect(SHAPE_DEFS[d.id]?.id).toBe(d.id);
    expect(SHAPE_LIST.some((d) => isCircuitKind(d.id))).toBe(false);
    expect(SHAPE_LIST).toHaveLength(29);
  });
  it('has unique ids, and a group for each', () => {
    expect(new Set(CIRCUIT_DEFS.map((d) => d.id)).size).toBe(CIRCUIT_DEFS.length);
    for (const d of CIRCUIT_DEFS) expect(CIRCUIT_GROUPS).toContain(d.group);
  });
  it.each(CIRCUIT_DEFS.map((d) => [d.id]))('%s draws something inside its box', (id) => {
    const n = makeNode(id as string, 0, 0);
    const parts = [...nodeDecorations(n), ...nodeBodies(n), ...nodeSolids(n)];
    expect(parts.length).toBeGreaterThan(0);
    for (const seg of parts.flat()) {
      if (seg.c === 'Z') continue;
      expect(Number.isFinite(seg.p.x) && Number.isFinite(seg.p.y)).toBe(true);
      expect(seg.p.x).toBeGreaterThanOrEqual(-2);
      expect(seg.p.x).toBeLessThanOrEqual(n.w + 2);
    }
  });
  it.each(CIRCUIT_DEFS.filter((d) => d.mode === 'bipole').map((d) => [d.id]))('%s has terminals at its two ends', (id) => {
    const n = makeNode(id as string, 100, 100);
    const a = portAnchor(n, 'w');
    const b = portAnchor(n, 'e');
    expect(a.p).toEqual({ x: 100, y: 100 + n.h / 2 });
    expect(b.p).toEqual({ x: 100 + n.w, y: 100 + n.h / 2 });
  });
  it('matches the anchors measured from a CircuiTikZ compile', () => {
    // pt offsets from the element centre: npn B (-23.90,0) C (0,21.91) E (0,-21.91).
    const npn = makeNode('circuit.npn', 0, 0);
    const c = { x: npn.w, y: npn.h / 2 };
    expect(portAnchor(npn, 'B').p.x - c.x).toBeCloseTo(-23.9 * PT_TO_DU, 0);
    expect(portAnchor(npn, 'C').p.y - c.y).toBeCloseTo(-21.91 * PT_TO_DU, 0);
    expect(portAnchor(npn, 'E').p.y - c.y).toBeCloseTo(21.91 * PT_TO_DU, 0);
    // op amp: inputs (-33.86, +-13.94), output (33.86, 0).
    const op = makeNode('circuit.opamp', 0, 0);
    expect(op.w / 2).toBeCloseTo(33.86 * PT_TO_DU, 0);
    expect(op.h / 2 - portAnchor(op, 'minus').p.y).toBeCloseTo(13.94 * PT_TO_DU, -1);
    // transformer: all at (+-29.875, +-29.875).
    const t = makeNode('circuit.transformer', 0, 0);
    expect(t.w / 2).toBeCloseTo(29.875 * PT_TO_DU, 0);
    // pR wiper: 0.4 of the bipole length above the line.
    const p = makeNode('circuit.potentiometer', 0, 0);
    expect(p.h / 2 - portAnchor(p, 'wiper').p.y).toBeCloseTo(0.4 * bipoleUnit(p.h), 5);
  });
  it('scales the symbol with height and the leads with width', () => {
    expect(bipoleUnit(40)).toBe(70);
    const small = makeNode('circuit.capacitor', 0, 0, { w: 100, h: 40 });
    const long = makeNode('circuit.capacitor', 0, 0, { w: 200, h: 40 });
    const plate = (n: typeof small) => {
      const ys = nodeDecorations(n)[0].filter((p) => p.c !== 'Z').map((p) => (p as { p: { y: number } }).p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(plate(small)).toBeCloseTo(plate(long), 5);
  });
  it('is grabbed anywhere in its box', () => {
    const d = emptyDiagram();
    const n = makeNode('circuit.capacitor', 0, 0, { id: 'c' });
    d.nodes.c = n;
    d.order.push('c');
    expect(hitTest(d, { x: 12, y: 8 }, { nodeTolerance: 1, edgeTolerance: 1 })?.id).toBe('c');
  });
});

describe('physics parts', () => {
  it('offers a useful set, all registered, outside the flowchart palette', () => {
    expect(PHYSICS_SHAPE_DEFS.length).toBeGreaterThanOrEqual(18);
    for (const d of PHYSICS_SHAPE_DEFS) {
      expect(SHAPE_DEFS[d.id]).toBeDefined();
      expect(SHAPE_LIST.includes(d)).toBe(false);
    }
  });
  it.each(PHYSICS_SHAPE_DEFS.map((d) => [d.id]))('%s has geometry and ports', (id) => {
    const n = makeNode(id as string, 0, 0);
    expect(nodeOutline(n).length).toBeGreaterThan(0);
    expect(nodePorts(n).length).toBeGreaterThan(0);
  });
});

describe('flip and rotation', () => {
  it('mirrors terminals and drawing', () => {
    const n = makeNode('circuit.npn', 0, 0, { flipH: true });
    expect(portAnchor(n, 'B').p.x).toBeCloseTo(n.w, 5);
    expect(portAnchor(n, 'B').dir.x).toBe(1);
    expect(portAnchor(n, 'C').p.x).toBe(0);
    const v = makeNode('circuit.npn', 0, 0, { flipV: true });
    expect(portAnchor(v, 'C').p.y).toBe(v.h);
  });
  it('does not touch flowchart shapes without flags', () => {
    const n = makeNode('process', 0, 0);
    expect(nodeOutline(n)).toEqual(getShapeDef('process').outline(n.w, n.h, n));
  });
  it('rotates terminals around the centre', () => {
    const n = makeNode('circuit.resistor', 0, 0, { rotation: 90 });
    const a = portAnchor(n, 'w');
    expect(a.p.x).toBeCloseTo(50, 5);
    expect(a.p.y).toBeCloseTo(20 - 50, 5);
  });
  it('flip and rotate are one undoable step each, skip locked and plain shapes', () => {
    const a = s().addNode('circuit.diode', { x: 0, y: 0 });
    const plain = s().addNode('process', { x: 300, y: 0 });
    s().setSelection([a, plain]);
    s().flipSelection('h');
    expect(s().doc.nodes[a].flipH).toBe(true);
    expect(s().doc.nodes[plain].flipH).toBeUndefined();
    s().undo();
    expect(s().doc.nodes[a].flipH).toBeUndefined();
    s().redo();
    s().flipSelection('h');
    expect(s().doc.nodes[a].flipH).toBeUndefined();
    s().rotateSelectionBy(90);
    expect(s().doc.nodes[a].rotation).toBe(90);
    s().rotateSelectionBy(-180);
    expect(s().doc.nodes[a].rotation).toBe(270);
    s().setSelection([a]);
    s().toggleLock();
    s().rotateSelectionBy(90);
    expect(s().doc.nodes[a].rotation).toBe(270);
  });
});

describe('wires', () => {
  function pair(): Diagram {
    return s().doc;
  }
  const add = (kind: string, x: number, y: number) => s().addNode(kind, { x, y });

  it('a connector to a component becomes a plain wire', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('circuit.resistor', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    const edge = pair().edges[e];
    expect(edge.wire).toBe(true);
    expect(edge.arrowEnd).toBe('none');
    expect(edge.routing).toBe('orthogonal');
  });
  it('an ordinary connector is untouched', () => {
    const a = add('process', 0, 0);
    const b = add('process', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    expect(pair().edges[e].wire).toBeUndefined();
    expect(pair().edges[e].arrowEnd).toBe('stealth');
  });
  it('an explicit arrow request is honoured', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('process', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' }, arrowEnd: 'latex' });
    expect(pair().edges[e].wire).toBeUndefined();
  });
  it('inline terminals join with one straight run', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('circuit.resistor', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    const r = routeEdge(pair(), pair().edges[e])!;
    expect(r.segs).toHaveLength(2);
  });
  it.each([
    [0, 0, 300, 120],
    [0, 0, -300, 120],
    [0, 0, 300, -120],
    [0, 0, 0, 200],
  ])('every leg is horizontal or vertical (%i,%i -> %i,%i)', (x0, y0, x1, y1) => {
    for (const rot of [0, 90, 180, 270]) {
      useEditor.setState({ doc: emptyDiagram() });
      const a = add('circuit.resistor', x0, y0);
      const b = add('circuit.resistor', x1, y1);
      s().setSelection([b]);
      s().rotateSelectionBy(rot);
      const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
      const r = routeEdge(pair(), pair().edges[e])!;
      for (let i = 1; i < r.samples.length; i++) {
        const dx = Math.abs(r.samples[i].x - r.samples[i - 1].x);
        const dy = Math.abs(r.samples[i].y - r.samples[i - 1].y);
        expect(Math.min(dx, dy)).toBeLessThan(0.01);
      }
    }
  });
  it('does not pass back through the component it leaves', () => {
    const a = add('circuit.resistor', 0, 0);
    const c = add('circuit.capacitor', 300, 0);
    s().setSelection([c]);
    s().rotateSelectionBy(90);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: c, port: 'w' } });
    const node = pair().nodes[c];
    const r = routeEdge(pair(), pair().edges[e])!;
    const inside = r.samples.slice(0, -1).filter((p) => Math.abs(p.x - (node.x + node.w / 2)) < 1 && p.y > node.y + node.h / 2 - 50 && p.y < node.y + node.h / 2 + 50);
    expect(inside).toHaveLength(0);
  });
  it('keeps both ends attached when a component moves or rotates', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('circuit.resistor', 300, 200);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    s().setSelection([b]);
    s().moveSelection(70, 40, false);
    s().rotateSelectionBy(90);
    const r = routeEdge(pair(), pair().edges[e])!;
    expect(r.end.x).toBeCloseTo(portAnchor(pair().nodes[b], 'w').p.x, 5);
    expect(r.end.y).toBeCloseTo(portAnchor(pair().nodes[b], 'w').p.y, 5);
  });
  it('style: thickness, colour and dash reach the LaTeX', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('circuit.resistor', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    s().updateEdge(e, { stroke: '#ab1234', strokeWidth: 3, strokeStyle: 'dashed' });
    const code = generateLatex(pair()).code;
    expect(code).toContain('fcAB1234');
    expect(code).toContain('dash pattern=');
    expect(code).toMatch(/line width=1\.707pt/);
  });
  it('junction splits a wire in two, undoably, and the dot sits on it', () => {
    const a = add('circuit.resistor', 0, 0);
    const b = add('circuit.resistor', 300, 0);
    const e = s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    const before = JSON.stringify(pair());
    const j = s().addJunctionOnWire(e, { x: 150, y: 6 })!;
    const dot = pair().nodes[j];
    expect(dot.kind).toBe('circuit.junction');
    expect(dot.y + dot.h / 2).toBeCloseTo(pair().nodes[a].y + pair().nodes[a].h / 2, 5);
    const edges = Object.values(pair().edges) as Edge[];
    expect(edges).toHaveLength(2);
    expect(edges.some((x) => x.target.nodeId === j)).toBe(true);
    expect(edges.some((x) => x.source.nodeId === j)).toBe(true);
    expect(edges.every((x) => x.wire)).toBe(true);
    s().undo();
    expect(JSON.stringify(pair())).toBe(before);
  });
  it('junction request for a missing wire is ignored', () => {
    expect(s().addJunctionOnWire('nope', { x: 0, y: 0 })).toBeNull();
  });
  it('a corner junction joins horizontally and vertically', () => {
    const d = emptyDiagram();
    const dot = makeNode('circuit.junction', 0, 0, { id: 'j', science: emptyCircuitSpec() });
    d.nodes.j = dot;
    for (const p of nodePorts(dot)) expect(p.p).toEqual({ x: 5, y: 5 });
    expect(nodePorts(dot).map((p) => p.id).sort()).toEqual(['e', 'n', 's', 'w']);
  });
  it('wire without a live node is reported, not thrown', () => {
    const d = emptyDiagram();
    d.edges.e = makeEdge({ id: 'e', source: { nodeId: 'gone', port: 'e' }, target: { point: { x: 0, y: 0 } }, wire: true });
    d.order.push('e');
    expect(() => generateLatex(d)).not.toThrow();
  });
});

describe('labels and designators', () => {
  it('numbers components by kind', () => {
    const a = s().addNode('circuit.resistor', { x: 0, y: 0 });
    const b = s().addNode('circuit.resistor', { x: 200, y: 0 });
    const c = s().addNode('circuit.capacitor', { x: 400, y: 0 });
    const label = (id: string) => (s().doc.nodes[id].science as { label: string }).label;
    expect([label(a), label(b), label(c)]).toEqual(['R_{1}', 'R_{2}', 'C_{1}']);
  });
  it('junctions and grounds have none', () => {
    const a = s().addNode('circuit.junction', { x: 0, y: 0 });
    expect((s().doc.nodes[a].science as { label: string }).label).toBe('');
  });
});

describe('selection operations treat components natively', () => {
  it('duplicate, copy, paste, delete and undo', () => {
    const a = s().addNode('circuit.resistor', { x: 0, y: 0 });
    const b = s().addNode('circuit.resistor', { x: 300, y: 0 });
    s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    s().setSelection([a, b]);
    s().duplicateSelection();
    expect(Object.keys(s().doc.nodes)).toHaveLength(4);
    expect(Object.values(s().doc.edges)).toHaveLength(2);
    expect(Object.values(s().doc.edges).every((e) => e.wire)).toBe(true);
    s().deleteSelection();
    expect(Object.keys(s().doc.nodes)).toHaveLength(2);
    s().undo();
    expect(Object.keys(s().doc.nodes)).toHaveLength(4);
    s().setSelection([a]);
    s().copySelection();
    s().paste({ x: 500, y: 500 });
    expect(Object.keys(s().doc.nodes)).toHaveLength(5);
  });
  it('group, align and reorder', () => {
    const a = s().addNode('circuit.resistor', { x: 0, y: 0 });
    const b = s().addNode('circuit.resistor', { x: 300, y: 100 });
    s().setSelection([a, b]);
    s().align('top');
    expect(s().doc.nodes[a].y).toBe(s().doc.nodes[b].y);
    s().group();
    expect(s().doc.nodes[a].groupId).toBeDefined();
    s().setSelection([a]);
    expect(s().selection).toHaveLength(2);
    s().ungroup();
    expect(s().doc.nodes[a].groupId).toBeUndefined();
    s().setSelection([a]);
    s().reorderSelection('front');
    expect(s().doc.order[s().doc.order.length - 1]).toBe(a);
  });
});

describe('gallery', () => {
  it('generates without errors', () => {
    const r = generateLatex(circuitGallery());
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
