import { beforeEach, describe, expect, it } from 'vitest';
import { serialize, deserialize, LoadError } from '../persistence/schema';
import { sampleDiagram } from '../model/sample';
import { emptyDiagram } from '../model/defaults';
import { useEditor } from '../state/store';
import { generateLatex } from '../latex/generator';
import { resetIdCounters } from '../model/ids';

describe('save and load', () => {
  it('round-trips a diagram without losing anything that matters', () => {
    const original = sampleDiagram();
    const { diagram, warnings } = deserialize(serialize(original));
    expect(warnings).toEqual([]);
    expect(Object.keys(diagram.nodes).sort()).toEqual(Object.keys(original.nodes).sort());
    expect(Object.keys(diagram.edges).sort()).toEqual(Object.keys(original.edges).sort());
    expect(diagram.order).toEqual(original.order);
    expect(diagram.settings).toEqual(original.settings);
    expect(diagram.nodes.n4.text).toBe(original.nodes.n4.text);
    expect(diagram.edges.e4.label?.text).toBe('Yes');
    expect(diagram.nodes.n3.style.shading).toBe('axis-vertical');
  });

  it('regenerates byte-identical LaTeX after a round trip', () => {
    const original = sampleDiagram();
    const { diagram } = deserialize(serialize(original));
    const opts = { mode: 'standalone' as const, comments: true };
    expect(generateLatex(diagram, opts).code).toBe(generateLatex(original, opts).code);
  });

  it('writes a self-describing envelope', () => {
    const parsed = JSON.parse(serialize(sampleDiagram()));
    expect(parsed.format).toBe('flowchart-tikz-studio');
    expect(parsed.version).toBe(1);
    expect(typeof parsed.savedAt).toBe('string');
    expect(parsed.diagram.nodes).toBeTruthy();
  });

  it('rejects files that are not diagrams', () => {
    expect(() => deserialize('not json')).toThrow(LoadError);
    expect(() => deserialize('{"hello":"world"}')).toThrow(LoadError);
  });

  it('accepts a bare diagram object as well as an envelope', () => {
    const bare = JSON.stringify(sampleDiagram());
    expect(deserialize(bare).diagram.order.length).toBeGreaterThan(0);
  });

  it('fills in missing style fields with defaults', () => {
    const raw = JSON.stringify({
      diagram: {
        name: 'Sparse',
        nodes: { n1: { kind: 'process', x: 10, y: 10, w: 100, h: 50, text: 'hi' } },
        edges: {},
        order: ['n1'],
      },
    });
    const { diagram } = deserialize(raw);
    expect(diagram.nodes.n1.style.fill).toBe('#ffffff');
    expect(diagram.nodes.n1.textStyle.fontSize).toBe(14);
    expect(diagram.nodes.n1.rotation).toBe(0);
  });

  it('drops connectors that point at missing shapes, with a warning', () => {
    const raw = JSON.stringify({
      diagram: {
        nodes: { n1: { kind: 'process', x: 0, y: 0, w: 80, h: 40 } },
        edges: { e1: { source: { nodeId: 'n1' }, target: { nodeId: 'gone' } } },
        order: ['n1', 'e1'],
      },
    });
    const { diagram, warnings } = deserialize(raw);
    expect(diagram.edges.e1).toBeUndefined();
    expect(warnings.some((w) => w.includes('e1'))).toBe(true);
  });

  it('warns when the file came from a newer version', () => {
    const raw = JSON.stringify({ version: 99, diagram: sampleDiagram() });
    expect(deserialize(raw).warnings.some((w) => w.includes('v99'))).toBe(true);
  });

  it('recovers as much as possible from a partly corrupt file', () => {
    const raw = JSON.stringify({
      diagram: {
        nodes: {
          good: { kind: 'process', x: 0, y: 0, w: 80, h: 40 },
          bad: null,
        },
        edges: {},
        order: ['good', 'bad'],
      },
    });
    const { diagram, warnings } = deserialize(raw);
    expect(diagram.nodes.good).toBeDefined();
    expect(diagram.nodes.bad).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('editor store', () => {
  beforeEach(() => {
    resetIdCounters();
    useEditor.setState({
      doc: emptyDiagram(),
      selection: [],
      past: [],
      future: [],
      snapshot: null,
      clipboard: null,
      dirty: false,
    });
  });

  const s = () => useEditor.getState();

  it('adds a shape centred on the click point, snapped to the grid', () => {
    const id = s().addNode('process', { x: 300, y: 200 });
    const n = s().doc.nodes[id];
    const grid = s().doc.settings.gridSize;
    expect(n.x % grid).toBe(0);
    expect(n.y % grid).toBe(0);
    expect(Math.abs(n.x + n.w / 2 - 300)).toBeLessThanOrEqual(grid);
    expect(Math.abs(n.y + n.h / 2 - 200)).toBeLessThanOrEqual(grid);
    expect(s().selection).toEqual([id]);
  });

  it('places a shape exactly on the click point when snapping is off', () => {
    useEditor.setState((prev) => ({
      doc: { ...prev.doc, settings: { ...prev.doc.settings, snapToGrid: false } },
    }));
    const id = s().addNode('process', { x: 300, y: 200 });
    const n = s().doc.nodes[id];
    expect(n.x + n.w / 2).toBe(300);
    expect(n.y + n.h / 2).toBe(200);
  });

  it('undoes and redoes shape creation', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    expect(s().canUndo()).toBe(true);
    s().undo();
    expect(s().doc.nodes[id]).toBeUndefined();
    s().redo();
    expect(s().doc.nodes[id]).toBeDefined();
  });

  it('coalesces a drag into a single undo step', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    const startX = s().doc.nodes[id].x;
    s().beginInteraction();
    for (let i = 0; i < 10; i++) s().moveSelection(5, 0, false);
    s().endInteraction();
    expect(s().doc.nodes[id].x).toBe(startX + 50);
    s().undo();
    expect(s().doc.nodes[id].x).toBe(startX);
  });

  it('records nothing when an interaction changes nothing', () => {
    s().addNode('process', { x: 100, y: 100 });
    const depth = s().past.length;
    s().beginInteraction();
    s().endInteraction();
    expect(s().past.length).toBe(depth);
  });

  it('undoes a style change', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().updateNodeStyle([id], { fill: '#ff0000' });
    expect(s().doc.nodes[id].style.fill).toBe('#ff0000');
    s().undo();
    expect(s().doc.nodes[id].style.fill).toBe('#ffffff');
  });

  it('undoes a text change', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().commit((d) => void (d.nodes[id].text = 'Hello'));
    s().undo();
    expect(s().doc.nodes[id].text).toBe('');
  });

  it('undoes connector creation and deletion without dangling references', () => {
    const a = s().addNode('process', { x: 100, y: 100 });
    const b = s().addNode('process', { x: 400, y: 400 });
    const e = s().addEdge({
      source: { nodeId: a, port: 's' },
      target: { nodeId: b, port: 'n' },
    });
    expect(s().doc.edges[e]).toBeDefined();
    s().setSelection([e]);
    s().deleteSelection();
    expect(s().doc.edges[e]).toBeUndefined();
    s().undo();
    const restored = s().doc.edges[e];
    expect(restored.source.nodeId).toBe(a);
    expect(s().doc.nodes[a]).toBeDefined();
  });

  it('clears redo history once a new edit is made', () => {
    s().addNode('process', { x: 100, y: 100 });
    s().undo();
    expect(s().canRedo()).toBe(true);
    s().addNode('decision', { x: 200, y: 200 });
    expect(s().canRedo()).toBe(false);
  });

  it('copies and pastes with fresh ids and an offset', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().setSelection([id]);
    s().copySelection();
    s().paste();
    const ids = Object.keys(s().doc.nodes);
    expect(ids).toHaveLength(2);
    const copy = s().doc.nodes[ids.find((i) => i !== id)!];
    expect(copy.id).not.toBe(id);
    expect(copy.x).toBe(s().doc.nodes[id].x + 24);
  });

  it('rewires connectors between pasted copies rather than to the originals', () => {
    const a = s().addNode('process', { x: 100, y: 100 });
    const b = s().addNode('process', { x: 400, y: 100 });
    s().addEdge({ source: { nodeId: a, port: 'e' }, target: { nodeId: b, port: 'w' } });
    s().setSelection([a, b]);
    s().copySelection();
    s().paste();
    const edges = Object.values(s().doc.edges);
    expect(edges).toHaveLength(2);
    const copy = edges.find((e) => e.source.nodeId !== a)!;
    expect(copy.source.nodeId).not.toBe(a);
    expect(copy.target.nodeId).not.toBe(b);
    expect(s().doc.nodes[copy.source.nodeId!]).toBeDefined();
  });

  it('cuts to the clipboard', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().setSelection([id]);
    s().cutSelection();
    expect(s().doc.nodes[id]).toBeUndefined();
    s().paste();
    expect(Object.keys(s().doc.nodes)).toHaveLength(1);
  });

  it('groups and ungroups', () => {
    const a = s().addNode('process', { x: 0, y: 0 });
    const b = s().addNode('process', { x: 300, y: 0 });
    s().setSelection([a, b]);
    s().group();
    const gid = s().doc.nodes[a].groupId;
    expect(gid).toBeTruthy();
    expect(s().doc.groups[gid!].memberIds.sort()).toEqual([a, b].sort());
    s().setSelection([a]);
    expect(s().selection.sort()).toEqual([a, b].sort());
    s().ungroup();
    expect(s().doc.nodes[a].groupId).toBeUndefined();
  });

  it('locks shapes so they stop moving', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().setSelection([id]);
    s().toggleLock();
    const x = s().doc.nodes[id].x;
    s().moveSelection(50, 50, false);
    expect(s().doc.nodes[id].x).toBe(x);
  });

  it('selects all and clears the canvas', () => {
    s().addNode('process', { x: 0, y: 0 });
    s().addNode('decision', { x: 200, y: 0 });
    s().selectAll();
    expect(s().selection).toHaveLength(2);
    s().clearCanvas();
    expect(s().doc.order).toHaveLength(0);
    s().undo();
    expect(s().doc.order).toHaveLength(2);
  });

  it('keeps ids stable across moves and undo', () => {
    const id = s().addNode('process', { x: 100, y: 100 });
    s().beginInteraction();
    s().moveSelection(30, 30, false);
    s().endInteraction();
    s().undo();
    s().redo();
    expect(Object.keys(s().doc.nodes)).toEqual([id]);
  });

  it('zooms about a point, keeping that point under the cursor', () => {
    useEditor.setState({ view: { zoom: 1, panX: 0, panY: 0 } });
    s().zoomBy(2, { x: 100, y: 100 });
    const v = s().view;
    expect(v.zoom).toBe(2);
    // The world point that was under the cursor is still under the cursor.
    expect((100 - v.panX) / v.zoom).toBeCloseTo(100, 6);
  });

  it('fits the diagram into the viewport', () => {
    s().addNode('process', { x: 0, y: 0 });
    s().addNode('process', { x: 1000, y: 800 });
    s().fitToView({ width: 600, height: 400 });
    expect(s().view.zoom).toBeLessThan(1);
    expect(s().view.zoom).toBeGreaterThan(0);
  });

  it('loads a document and resets history', () => {
    s().addNode('process', { x: 0, y: 0 });
    s().loadDocument(sampleDiagram(), { markSaved: true });
    expect(s().past).toHaveLength(0);
    expect(s().dirty).toBe(false);
    expect(Object.keys(s().doc.nodes)).toHaveLength(8);
  });

  it('never reuses an id after loading a saved document', () => {
    s().loadDocument(sampleDiagram(), { markSaved: true });
    const id = s().addNode('process', { x: 0, y: 0 });
    expect(s().doc.nodes[id]).toBeDefined();
    expect(Object.keys(s().doc.nodes)).toHaveLength(9);
  });
});
