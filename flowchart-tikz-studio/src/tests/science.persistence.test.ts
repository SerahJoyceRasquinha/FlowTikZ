import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../persistence/schema';
import { coerceScience } from '../science/coerce';
import { chemGallery, circuitGallery, mathGallery, mixedGallery, moleculeGallery, physicsGallery, SAMPLE_REACTION } from '../science/gallery';
import { generateLatex } from '../latex/generator';
import { sampleDiagram } from '../model/sample';
import { useEditor } from '../state/store';
import { emptyDiagram, makeNode } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { remapDiagramIds } from '../import/conversion/ids';
import { MOLECULE_TEMPLATES, fromBlueprint, mirrorMolecule } from '../science/chem/molecule';
import { loadEngine } from '../science/math/engine';
import { recentSymbols, frequentSymbols, recordUse } from '../science/recents';
import type { MathSpec } from '../science/types';

const s = () => useEditor.getState();
const SPEC: MathSpec = { type: 'math', latex: '\\frac{a}{b}', display: true, natural: { w: 3, h: 2 } };

beforeAll(async () => {
  await loadEngine();
});

beforeEach(() => {
  resetIdCounters();
  useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [], snapshot: null, clipboard: null, dirty: false });
});

describe('saving and reopening', () => {
  it.each([['math', mathGallery], ['chem', chemGallery], ['circuit', circuitGallery], ['molecule', moleculeGallery], ['physics', physicsGallery], ['mixed', mixedGallery]] as const)('%s survives a save unchanged', (_n, make) => {
    const d = make();
    const { diagram, warnings } = deserialize(serialize(d));
    expect(warnings).toEqual([]);
    expect(generateLatex(diagram).code).toBe(generateLatex(d).code);
    expect(diagram.nodes).toEqual(d.nodes);
    expect(Object.keys(diagram.edges).sort()).toEqual(Object.keys(d.edges).sort());
    for (const id of Object.keys(d.edges)) expect(diagram.edges[id].wire).toBe(d.edges[id].wire);
  });
  it('a flowchart file written before this upgrade loads byte-compatibly', () => {
    const d = sampleDiagram();
    const legacy = JSON.parse(serialize(d));
    for (const n of Object.values(legacy.diagram.nodes) as object[]) {
      expect(n).not.toHaveProperty('science');
      expect(n).not.toHaveProperty('flipH');
    }
    const { diagram, warnings } = deserialize(JSON.stringify(legacy));
    expect(warnings).toEqual([]);
    expect(generateLatex(diagram).code).toBe(generateLatex(d).code);
  });
  it('edges without the new field stay without it', () => {
    const d = sampleDiagram();
    const { diagram } = deserialize(serialize(d));
    for (const e of Object.values(diagram.edges)) expect('wire' in e).toBe(false);
  });
  it('unknown kinds fall back as before', () => {
    const d = emptyDiagram();
    d.nodes.a = makeNode('process', 0, 0, { id: 'a' });
    d.nodes.a.kind = 'future.thing';
    d.order.push('a');
    expect(() => generateLatex(d)).not.toThrow();
  });
  it('a formula with a corrupt payload is reported, not fatal', () => {
    const d = mathGallery();
    const raw = JSON.parse(serialize(d));
    const id = Object.keys(raw.diagram.nodes)[0];
    raw.diagram.nodes[id].science = { type: 'math', latex: 7 };
    const { diagram, warnings } = deserialize(JSON.stringify(raw));
    expect(diagram.nodes[id]).toBeUndefined();
    expect(warnings[0]).toContain(id);
  });
  it('undo, redo and reload reproduce formulas exactly', () => {
    const id = s().insertScience('math', SPEC, { w: 60, h: 40 }, { x: 100, y: 100 });
    const code = generateLatex(s().doc).code;
    s().undo();
    expect(s().doc.nodes[id]).toBeUndefined();
    s().redo();
    expect(generateLatex(s().doc).code).toBe(code);
    s().loadDocument(deserialize(serialize(s().doc)).diagram, { markSaved: true });
    expect(generateLatex(s().doc).code).toBe(code);
  });
});

describe('coerceScience', () => {
  it('rejects junk', () => {
    for (const bad of [null, 3, 'x', {}, { type: 'nope' }, { type: 'math' }, { type: 'chem' }, { type: 'molecule', atoms: 'x' }]) {
      expect(coerceScience(bad)).toBeNull();
    }
  });
  it('fills in defaults for a sparse circuit', () => {
    expect(coerceScience({ type: 'circuit', label: 'R' })).toEqual({ type: 'circuit', label: 'R', value: '', voltage: '', current: '', currentDir: 'forward' });
  });
  it('drops bonds to missing atoms and self-bonds', () => {
    const out = coerceScience({
      type: 'molecule',
      atoms: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
      bonds: [{ id: 'g', a: 'a', b: 'b', order: 9 }, { id: 'h', a: 'a', b: 'z' }, { id: 'i', a: 'a', b: 'a' }],
    });
    expect(out).toMatchObject({ bonds: [{ id: 'g', order: 1, stereo: 'none' }] });
  });
  it('clamps unknown states and arrows in a reaction', () => {
    const out = coerceScience({
      type: 'chem',
      source: 'A',
      reaction: { reactants: [{ formula: 'A', state: 'plasma' }], stages: [{ arrow: '~~>', products: [] }] },
    }) as { reaction: typeof SAMPLE_REACTION };
    expect(out.reaction.reactants[0].state).toBe('');
    expect(out.reaction.stages[0].arrow).toBe('->');
  });
  it('rejects a non-finite natural size', () => {
    expect(coerceScience({ type: 'math', latex: 'x', natural: { w: -1, h: 2 } })).toMatchObject({ natural: null });
  });
  it('a ring naming a missing atom is dropped', () => {
    const out = coerceScience({ type: 'molecule', atoms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], bonds: [], aromaticRings: [['a', 'b', 'x'], ['a', 'b', 'c']] }) as { aromaticRings: string[][] };
    expect(out.aromaticRings).toEqual([['a', 'b', 'c']]);
  });
});

describe('store operations on scientific objects', () => {
  it('inserts centred, selected, as one undo step', () => {
    const before = s().past.length;
    const id = s().insertScience('math', SPEC, { w: 60, h: 40 }, { x: 100, y: 200 });
    const n = s().doc.nodes[id];
    expect([n.x, n.y, n.w, n.h]).toEqual([70, 180, 60, 40]);
    expect(s().selection).toEqual([id]);
    expect(s().past.length).toBe(before + 1);
  });
  it('edits keep the centre and are undoable', () => {
    const id = s().insertScience('math', SPEC, { w: 60, h: 40 }, { x: 100, y: 200 });
    s().updateScience(id, { ...SPEC, latex: 'y' }, { w: 20, h: 20 });
    const n = s().doc.nodes[id];
    expect(n.x + n.w / 2).toBeCloseTo(100);
    expect(n.y + n.h / 2).toBeCloseTo(200);
    expect((n.science as MathSpec).latex).toBe('y');
    s().undo();
    expect((s().doc.nodes[id].science as MathSpec).latex).toBe(SPEC.latex);
  });
  it('does not share the spec object with the caller', () => {
    const local = { ...SPEC };
    const id = s().insertScience('math', local, { w: 60, h: 40 }, { x: 0, y: 0 });
    local.latex = 'changed';
    expect((s().doc.nodes[id].science as MathSpec).latex).toBe(SPEC.latex);
  });
  it('copy and paste carry the payload', () => {
    const id = s().insertScience('math', SPEC, { w: 60, h: 40 }, { x: 0, y: 0 });
    s().setSelection([id]);
    s().duplicateSelection();
    const copy = s().doc.nodes[s().selection[0]];
    expect(copy.id).not.toBe(id);
    expect(copy.science).toEqual(s().doc.nodes[id].science);
  });
  it('flip mirrors a molecule in its own data', () => {
    const m = fromBlueprint(MOLECULE_TEMPLATES.find((t) => t.id === 'ethanol')!.blueprint);
    const id = s().insertScience('molecule', m, { w: 100, h: 60 }, { x: 0, y: 0 });
    s().flipSelection('h');
    expect(s().doc.nodes[id].science).toEqual(mirrorMolecule(m, 'h'));
    expect(s().doc.nodes[id].flipH).toBeUndefined();
  });
  it('formulas do not gain a mirror flag', () => {
    const id = s().insertScience('math', SPEC, { w: 60, h: 40 }, { x: 0, y: 0 });
    s().flipSelection('h');
    expect(s().doc.nodes[id].flipH).toBeUndefined();
  });
  it('import remapping keeps the payload', () => {
    const d = circuitGallery();
    const { diagram } = remapDiagramIds(JSON.parse(JSON.stringify(d)), (p: string) => `${p}x${Math.random().toString(36).slice(2, 8)}`);
    expect(generateLatex(diagram).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('a large mixed diagram generates quickly', () => {
    const d = emptyDiagram();
    for (let i = 0; i < 400; i++) {
      const n = makeNode(i % 2 ? 'circuit.resistor' : 'math', i * 3, i * 3, { id: `n${i}`, science: i % 2 ? { type: 'circuit', label: 'R', value: '', voltage: '', current: '', currentDir: 'forward' } : SPEC });
      d.nodes[n.id] = n;
      d.order.push(n.id);
    }
    const t0 = performance.now();
    generateLatex(d);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('recently used symbols', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
      clear: () => Object.keys(store).forEach((k) => delete store[k]),
    };
  });
  const sym = (tex: string) => ({ tex, glyph: tex, name: tex });
  it('newest first, and frequent needs repeat use', () => {
    recordUse('t', sym('a'));
    recordUse('t', sym('b'));
    expect(recentSymbols('t').map((x) => x.tex)).toEqual(['b', 'a']);
    expect(frequentSymbols('t')).toEqual([]);
    recordUse('t', sym('a'));
    expect(recentSymbols('t').map((x) => x.tex)).toEqual(['a', 'b']);
    expect(frequentSymbols('t').map((x) => x.tex)).toEqual(['a']);
  });
  it('libraries are separate', () => {
    recordUse('one', sym('a'));
    expect(recentSymbols('two')).toEqual([]);
  });
  it('survives corrupt storage', () => {
    localStorage.setItem('flowtikz:symbols:bad', 'not json');
    expect(recentSymbols('bad')).toEqual([]);
  });
});
