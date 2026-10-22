import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { sampleDiagram } from '../model/sample';
import { diagramBounds } from '../model/diagram';
import { routeEdge } from '../model/routing';
import { nodeHitTest } from '../model/hittest';
import { rectIntersects } from '../model/geometry';
import { runImport } from '../import/pipeline';
import { generateLatex } from '../latex/generator';
import { deserialize, serialize } from '../persistence/schema';
import { readAutosave, scheduleAutosave } from '../persistence/autosave';
import { lintLatex } from './latexLint';
import { BYTES } from './helpers/importFixtures';
import type { Diagram } from '../model/types';

/**
 * 20. import into empty canvas   21. into existing canvas   23/24. undo / redo
 * 26-29. editing, text, moving, connectors following   31. autosave   + persistence
 */

async function imported(bytes = BYTES.flowchartDrawio, name = 'flow.drawio'): Promise<Diagram> {
  const res = await runImport({ bytes, name, mime: '' }, { signal: new AbortController().signal, onProgress: () => undefined });
  return res.diagram;
}

const S = () => useEditor.getState();
const latex = () => generateLatex(S().doc).code;
const node = (text: string) => Object.values(S().doc.nodes).find((n) => n.text === text)!;

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  resetIdCounters();
  useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [], snapshot: null, dirty: false, clipboard: null });
});

describe('committing an import', () => {
  it('into an empty canvas: one undo step, dirty, transparent background (20)', async () => {
    const d = await imported();
    S().applyImport(d, 'replace');
    expect(Object.keys(S().doc.nodes)).toHaveLength(13);
    expect(S().past).toHaveLength(1);
    expect(S().dirty).toBe(true);
    expect(S().doc.settings.background).toBe('none');
    expect(S().doc.name).toBe('flow');
  });

  it('replace an existing diagram, then undo and redo the whole import (21, 23, 24)', async () => {
    S().loadDocument(sampleDiagram(), { markSaved: true });
    const before = JSON.stringify(S().doc);
    const beforeLatex = latex();
    S().applyImport(await imported(), 'replace');
    expect(latex()).not.toBe(beforeLatex);
    expect(Object.keys(S().doc.nodes)).toHaveLength(13);

    S().undo(); // Ctrl+Z undoes the complete import
    expect(JSON.stringify(S().doc)).toBe(before);
    expect(latex()).toBe(beforeLatex);

    S().redo();
    expect(Object.keys(S().doc.nodes)).toHaveLength(13);
  });

  it('insert beside existing work: nothing overlaps, ids never collide, selection is the import (21)', async () => {
    S().loadDocument(sampleDiagram(), { markSaved: true });
    const existingIds = new Set(S().doc.order);
    const existingBox = diagramBounds(S().doc);
    const { ids } = S().applyImport(await imported(), 'insert');
    expect(ids.every((id) => !existingIds.has(id))).toBe(true);
    expect(new Set(S().doc.order).size).toBe(S().doc.order.length);
    for (const id of existingIds) expect(S().doc.order).toContain(id);
    for (const id of ids) {
      const n = S().doc.nodes[id];
      if (n) expect(rectIntersects({ x: n.x, y: n.y, w: n.w, h: n.h }, existingBox)).toBe(false);
    }
    expect(S().selection).toEqual(ids);
    // Edges refer to the new ids.
    for (const e of Object.values(S().doc.edges)) {
      if (e.source.nodeId) expect(S().doc.nodes[e.source.nodeId]).toBeTruthy();
      if (e.target.nodeId) expect(S().doc.nodes[e.target.nodeId]).toBeTruthy();
    }
    S().undo();
    expect(new Set(S().doc.order)).toEqual(existingIds);
  });

  it('two imports in a row stay independent (38)', async () => {
    S().applyImport(await imported(), 'replace');
    const first = new Set(S().doc.order);
    S().applyImport(await imported(BYTES.flowchartSvg, 'b.svg'), 'insert');
    expect(S().doc.order.length).toBeGreaterThan(first.size);
    expect(new Set(S().doc.order).size).toBe(S().doc.order.length);
    expect(lintLatex(latex(), { standalone: true }).problems).toEqual([]);
  });

  it('open as a new document: fresh history, unsaved', async () => {
    S().loadDocument(sampleDiagram(), { markSaved: true });
    const oldId = S().doc.id;
    S().addNode('process', { x: 0, y: 0 });
    S().applyImport(await imported(), 'new');
    expect(S().doc.id).not.toBe(oldId);
    expect(S().past).toHaveLength(0);
    expect(S().dirty).toBe(true);
    expect(Object.keys(S().doc.nodes)).toHaveLength(13);
  });

  it('the committed document shares nothing with the import result', async () => {
    const d = await imported();
    S().applyImport(d, 'replace');
    const id = S().doc.order.find((i) => S().doc.nodes[i])!;
    S().updateNodeStyle([id], { fill: '#123456' });
    expect(Object.values(d.nodes).some((n) => n.style.fill === '#123456')).toBe(false);
  });
});

describe('imported objects behave like native ones', () => {
  beforeEach(async () => {
    S().applyImport(await imported(), 'replace');
  });

  it('editing a shape updates the TikZ (26)', () => {
    const recv = node('Receive\norder');
    S().updateNodeStyle([recv.id], { fill: '#00ff00', strokeStyle: 'dotted' });
    expect(latex()).toContain('fill=green');
    S().undo();
    expect(latex()).not.toContain('fill=green');
  });

  it('editing text re-escapes it in the LaTeX (27)', () => {
    const recv = node('Receive\norder');
    S().commit((d) => void (d.nodes[recv.id].text = '50% & $5_000'));
    const code = latex();
    expect(code).toContain('50\\% \\& \\$5\\_000');
    expect(lintLatex(code, { standalone: true }).problems).toEqual([]);
  });

  it('moving a shape moves its coordinates and its connectors follow (28, 29)', () => {
    const check = node('In stock?');
    const edge = Object.values(S().doc.edges).find((e) => e.target.nodeId === check.id)!;
    const before = routeEdge(S().doc, edge)!.end;
    const codeBefore = latex();
    S().setSelection([check.id]);
    S().beginInteraction();
    S().moveSelection(200, 60, false);
    S().endInteraction();
    const after = routeEdge(S().doc, S().doc.edges[edge.id])!.end;
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(60, 0);
    expect(latex()).not.toBe(codeBefore);
    // Selecting the imported object selects its whole group, like any group.
    const ship = node('Ship');
    S().setSelection([ship.id]);
    expect(S().selection).toContain(node('Invoice').id);
  });

  it('delete, duplicate, copy/paste, lock, reorder, group and ungroup all work', () => {
    const recv = node('Receive\norder');
    S().setSelection([recv.id]);
    S().duplicateSelection();
    const copy = S().selection[0];
    expect(S().doc.nodes[copy].text).toBe('Receive\norder');
    expect(S().doc.nodes[copy].meta?.import?.format).toBe('drawio');
    S().toggleLock();
    expect(S().doc.nodes[copy].locked).toBe(true);
    S().reorderSelection('back');
    expect(S().doc.order[0]).toBe(copy);
    S().setSelection([node('Start').id, recv.id]);
    S().group();
    expect(S().doc.nodes[recv.id].groupId).toBeTruthy();
    S().ungroup();
    expect(S().doc.nodes[recv.id].groupId).toBeUndefined();
    S().setSelection([copy]);
    S().deleteSelection();
    expect(S().doc.nodes[copy]).toBeUndefined();
  });

  it('an imported free-form outline resizes, rotates and hit-tests like a symbol', () => {
    const lane = node('Warehouse');
    expect(lane.kind).toBe('freeform');
    expect(nodeHitTest(lane, { x: lane.x + 5, y: lane.y + lane.h - 5 })).toBe(true);
    S().commit((d) => {
      d.nodes[lane.id].w *= 2;
      d.nodes[lane.id].rotation = 30;
    });
    const code = latex();
    expect(code).toContain('rotate around={-30:');
    expect(lintLatex(code, { standalone: true }).problems).toEqual([]);
  });

  it('connector routing and arrowheads are editable (routing, arrows, waypoints)', () => {
    const e = Object.values(S().doc.edges)[0];
    S().updateEdge(e.id, { routing: 'bezier', arrowEnd: 'diamond', arrowStart: 'bar' });
    const code = latex();
    expect(code).toMatch(/Diamond\[/);
    expect(code).toMatch(/Bar\[/);
  });
});

describe('persistence of imported diagrams', () => {
  afterEach(() => vi.useRealTimers());

  it('saves and reloads with outlines, metadata and background intact, regenerating identical LaTeX', async () => {
    S().applyImport(await imported(), 'replace');
    const code = latex();
    const { diagram, warnings } = deserialize(serialize(S().doc));
    expect(warnings).toEqual([]);
    expect(diagram.settings.background).toBe('none');
    const lane = Object.values(diagram.nodes).find((n) => n.kind === 'freeform')!;
    expect(lane.path!.length).toBeGreaterThan(4);
    expect(Object.values(diagram.nodes).find((n) => n.text === 'Pick list (PL-7)')!.meta!.import!.preserved!['data:owner']).toBe('warehouse');
    S().loadDocument(diagram, { markSaved: true });
    expect(latex()).toBe(code);
  });

  it('rejects corrupt outline and metadata values in a save file instead of crashing', () => {
    const raw = JSON.parse(serialize(sampleDiagram()));
    const id = Object.keys(raw.diagram.nodes)[0];
    raw.diagram.nodes[id].kind = 'freeform';
    raw.diagram.nodes[id].path = [{ c: 'M', p: { x: 'NaN', y: 0 } }];
    raw.diagram.nodes[id].meta = { import: { format: 7 } };
    const { diagram } = deserialize(JSON.stringify(raw));
    expect(diagram.nodes[id].path).toBeUndefined();
    expect(diagram.nodes[id].meta).toBeUndefined();
    expect(() => generateLatex(diagram)).not.toThrow();
  });

  it('autosaves the imported document (31)', async () => {
    if (typeof localStorage === 'undefined') {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
    }
    const d = await imported();
    vi.useFakeTimers();
    S().applyImport(d, 'replace');
    scheduleAutosave(S().doc);
    vi.advanceTimersByTime(1000);
    const found = readAutosave();
    expect(found).not.toBeNull();
    expect(Object.keys(found!.diagram.nodes)).toHaveLength(13);
    expect(found!.diagram.settings.background).toBe('none');
    vi.unstubAllGlobals();
  });
});
