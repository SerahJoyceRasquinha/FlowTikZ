import { beforeAll, describe, expect, it } from 'vitest';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';
import { emptyDiagram, makeNode, makeEdge } from '../model/defaults';
import type { Diagram, Node } from '../model/types';
import { allComponents, chemGallery, circuitGallery, mathGallery, mixedGallery, moleculeGallery, physicsGallery, symbolGallery } from '../science/gallery';
import { CIRCUIT_DEFS } from '../science/physics/circuits';
import { emptyCircuitSpec, MathSpec, ScienceSpec } from '../science/types';
import { effectiveFontSize, labelSideFlipped, PackageRegistry } from '../latex/science';
import { MOLECULE_TEMPLATES, fromBlueprint, moleculeNaturalSize, BOND_DU } from '../science/chem/molecule';
import { sampleDiagram } from '../model/sample';
import { loadEngine, renderTex } from '../science/math/engine';

beforeAll(async () => {
  await loadEngine();
});

function doc(...nodes: Node[]): Diagram {
  const d = emptyDiagram();
  for (const n of nodes) {
    d.nodes[n.id] = n;
    d.order.push(n.id);
  }
  return d;
}

const math = (latex: string, patch: Partial<Node> = {}, spec: Partial<MathSpec> = {}) => {
  const n = makeNode('math', 0, 0, { id: 'm', w: 100, h: 40, science: { type: 'math', latex, display: true, natural: { w: 5, h: 2 }, ...spec } as ScienceSpec, ...patch });
  n.style = { ...n.style, strokeStyle: 'none', fillOpacity: 0, ...(patch.style ?? {}) };
  return n;
};
const comp = (kind: string, patch: Partial<Node> = {}) => makeNode(kind, 0, 0, { id: 'c', science: emptyCircuitSpec(), ...patch });
const out = (...nodes: Node[]) => generateLatex(doc(...nodes));

const GALLERIES: [string, () => Diagram][] = [
  ['math', mathGallery], ['symbols', symbolGallery], ['components', allComponents], ['circuits', circuitGallery],
  ['physics', physicsGallery], ['chemistry', chemGallery], ['molecules', moleculeGallery], ['mixed', mixedGallery],
];

describe.each(GALLERIES)('%s gallery output', (_name, make) => {
  it('passes static checks in standalone and snippet mode', () => {
    const a = generateLatex(make(), { mode: 'standalone', comments: true });
    const la = lintLatex(a.code, { standalone: true });
    expect(la.problems).toEqual([]);
    const b = generateLatex(make(), { mode: 'snippet', comments: true });
    expect(lintLatex(b.code, { standalone: false }).problems).toEqual([]);
    expect(lintLatex(generateLatex(make(), { mode: 'standalone', comments: false }).code, { standalone: true }).problems).toEqual([]);
  });
  it('has no duplicate package lines', () => {
    const lines = generateLatex(make()).code.split('\n').filter((l) => l.startsWith('\\usepackage'));
    expect(new Set(lines).size).toBe(lines.length);
  });
  it('regenerates byte for byte', () => {
    const d = make();
    expect(generateLatex(d).code).toBe(generateLatex(d).code);
  });
  it('reports no errors', () => {
    expect(generateLatex(make()).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('maps every object to its lines', () => {
    const d = make();
    const r = generateLatex(d);
    expect(r.blocks.map((b) => b.objectId).sort()).toEqual([...d.order].sort());
    const lines = r.code.split('\n');
    for (const b of r.blocks) expect(lines[b.startLine - 1]).toContain(b.objectId);
  });
});

describe('preamble', () => {
  it('a flowchart gains nothing', () => {
    const r = generateLatex(sampleDiagram());
    expect(r.code).not.toMatch(/circuitikz|mhchem|chemfig|amssymb/);
    expect(r.packages).toEqual(['tikz']);
  });
  it('a dollar sign in flowchart text adds no science styles', () => {
    const code = out(makeNode('process', 0, 0, { id: 'p', text: 'cost $5' })).code;
    expect(code).not.toContain('fcformula');
  });
  it('loads only what is used', () => {
    expect(out(math('x')).packages).toEqual(['tikz', 'amsmath', 'amssymb']);
    expect(out(comp('circuit.resistor')).packages).toEqual(['tikz', 'amsmath', 'circuitikz']);
    const c = makeNode('chem', 0, 0, { id: 'h', science: { type: 'chem', source: 'H2O', natural: null } });
    expect(out(c).packages).toEqual(['tikz', 'mhchem']);
    const mol = makeNode('molecule', 0, 0, { id: 'k', science: fromBlueprint(MOLECULE_TEMPLATES[0].blueprint) });
    expect(out(mol).packages).toEqual(['tikz', 'chemfig']);
  });
  it('adds cancel only when used', () => {
    expect(out(math('\\cancel{x}')).code).toContain('\\usepackage{cancel}');
    expect(out(math('x')).code).not.toContain('{cancel}');
  });
  it('loads tikz before circuitikz and amsmath before xcolor', () => {
    const code = generateLatex(mixedGallery()).code;
    expect(code.indexOf('{tikz}')).toBeLessThan(code.indexOf('{circuitikz}'));
    expect(code.indexOf('{amsmath}')).toBeLessThan(code.indexOf('{xcolor}'));
  });
  it('lists packages as comments in snippet mode', () => {
    const code = generateLatex(mixedGallery(), { mode: 'snippet', comments: true }).code;
    expect(code).toContain('%   \\usepackage[american]{circuitikz}');
    expect(code).toContain('%   \\usepackage[version=4]{mhchem}');
    expect(code).toContain('%   \\usepackage{chemfig}');
    expect(code).not.toMatch(/^\\usepackage/m);
  });
  it('a $ in plain text still pulls in amsmath, once', () => {
    const n = makeNode('process', 0, 0, { id: 'p', text: 'cost $5' });
    const lines = out(n, math('x')).code.split('\n').filter((l) => l === '\\usepackage{amsmath}');
    expect(lines.length).toBeLessThanOrEqual(1);
  });
  it('registry order is fixed', () => {
    const p = new PackageRegistry();
    p.use('chemfig', 'amsmath', 'circuitikz', 'chemfig');
    expect(p.list()).toEqual(['amsmath', 'circuitikz', 'chemfig']);
  });
});

describe('formula nodes', () => {
  it('writes real LaTeX, in display style', () => {
    expect(out(math('\\frac{a}{b}')).code).toContain('{$\\displaystyle \\frac{a}{b}$}');
  });
  it('inline style omits displaystyle', () => {
    expect(out(math('x', {}, { display: false })).code).toContain('{$x$}');
  });
  it('sets the scale from the box', () => {
    // 100 du wide over 5 em = 20 du font = 0.4 cm = 11.381 pt => 1.138.
    expect(out(math('x')).code).toContain('scale=1.138');
  });
  it('uses the smaller axis when the box is stretched', () => {
    const n = math('x', { w: 400, h: 40 });
    expect(effectiveFontSize(n, { w: 5, h: 2 })).toBe(20);
  });
  it('honours colour, rotation, opacity, fill and border', () => {
    const n = math('x', {
      rotation: 30,
      textStyle: { ...makeNode('math', 0, 0).textStyle, color: '#ab0011' },
      style: { ...makeNode('math', 0, 0).style, fill: '#00ab11', fillOpacity: 0.5, stroke: '#1100ab', strokeStyle: 'solid', opacity: 0.8 },
    });
    const code = out(n).code;
    for (const needle of ['text=fcAB0011', 'rotate=-30', 'opacity=0.8', 'fill=fc00AB11', 'fill opacity=0.5', 'draw=fc1100AB']) expect(code).toContain(needle);
  });
  it('bold wraps in boldsymbol', () => {
    const n = math('x', { textStyle: { ...makeNode('math', 0, 0).textStyle, bold: true } });
    expect(out(n).code).toContain('\\boldsymbol{x}');
  });
  it('flattens newlines, which would end math mode', () => {
    expect(out(math('a\n\nb')).code).toContain('$\\displaystyle a b$');
  });
  it('an invalid formula becomes a visible placeholder and a warning', () => {
    const r = out(math('\\frac{a'));
    expect(r.code).toContain('invalid formula');
    expect(r.code).not.toContain('\\frac{a}');
    expect(r.issues.some((i) => i.severity === 'warning' && /never closed/.test(i.message))).toBe(true);
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });
  it('an empty formula is reported too', () => {
    expect(out(math('  ')).issues.some((i) => /empty/.test(i.message))).toBe(true);
  });
  it('blocks primitives from a tampered save file', () => {
    for (const evil of ['\\input{/etc/passwd}', '\\write18{rm -rf /}', '\\immediate\\write18{x}', '\\usepackage{x}']) {
      const r = out(math(evil));
      expect(r.code, evil).not.toContain(evil);
    }
  });
  it('natural size from the real engine gives the expected font', () => {
    const r = renderTex('x+y')!;
    const n = math('x+y', { w: r.natural.w * 20, h: r.natural.h * 20 }, { natural: r.natural });
    expect(out(n).code).toContain('scale=1.138');
  });
});

describe('chemistry nodes', () => {
  const chem = (source: string, patch: Partial<Node> = {}) =>
    makeNode('chem', 0, 0, { id: 'h', w: 100, h: 40, science: { type: 'chem', source, natural: { w: 5, h: 2 } }, ...patch });
  it('writes mhchem', () => {
    expect(out(chem('H2SO4')).code).toContain('{\\ce{H2SO4}}');
  });
  it('makes a degree sign safe', () => {
    expect(out(chem('A ->[450 °C] B')).code).toContain('450 $^\\circ$C');
  });
  it('bold goes through math mode', () => {
    const n = chem('H2O', { textStyle: { ...makeNode('chem', 0, 0).textStyle, bold: true } });
    expect(out(n).code).toContain('$\\boldsymbol{\\ce{H2O}}$');
    expect(out(n).packages).toContain('amsmath');
  });
  it('an unbalanced source is refused', () => {
    expect(out(chem('H2{')).code).toContain('invalid formula');
  });
});

describe('molecule nodes', () => {
  const ethanol = () => fromBlueprint(MOLECULE_TEMPLATES.find((t) => t.id === 'ethanol')!.blueprint);
  const mol = (patch: Partial<Node> = {}) => {
    const science = ethanol();
    const nat = moleculeNaturalSize(science);
    return makeNode('molecule', 0, 0, { id: 'k', w: nat.w, h: nat.h, science, ...patch });
  };
  it('sets bond length so the compiled drawing matches the canvas', () => {
    const code = out(mol()).code;
    const k = Number(/scalebox\{([\d.]+)\}/.exec(code)![1]);
    const sep = Number(/atom sep=([\d.]+)cm/.exec(code)![1]);
    // Compiled bond length: atom sep times scalebox, equal to the canvas length.
    expect(sep * k).toBeCloseTo(BOND_DU / 50, 2);
  });
  it('resizing scales the bond length', () => {
    const base = mol();
    const big = mol({ w: base.w * 2, h: base.h * 2 });
    const sep = (c: string) => Number(/atom sep=([\d.]+)/.exec(c)![1]);
    expect(sep(out(big).code)).toBeCloseTo(sep(out(base).code), 2);
    const k = (c: string) => Number(/scalebox\{([\d.]+)\}/.exec(c)![1]);
    expect(k(out(big).code)).toBeCloseTo(k(out(base).code) * 2, 2);
  });
  it('honours bond colour, width and rotation', () => {
    const n = mol({ rotation: 15 });
    n.style = { ...n.style, stroke: '#00aa00', strokeWidth: 3 };
    const code = out(n).code;
    expect(code).toContain('draw=fc00AA00');
    expect(code).toContain('rotate=-15');
  });
  it('rejects a label chemfig cannot take', () => {
    const n = mol();
    (n.science as { atoms: { label: string }[] }).atoms[0].label = 'a%b';
    expect(out(n).code).toContain('invalid formula');
  });
  it('an empty molecule is reported and emits nothing', () => {
    const n = mol({ science: { type: 'molecule', atoms: [], bonds: [], aromaticRings: [] } });
    const r = out(n);
    expect(r.code).not.toContain('\\chemfig');
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('circuit components', () => {
  it.each(CIRCUIT_DEFS.filter((d) => d.mode === 'bipole').map((d) => [d.id, d.tikz]))('%s uses to[%s]', (id, tikz) => {
    expect(out(comp(id as string)).code).toContain(`to[${tikz}`);
  });
  it.each(CIRCUIT_DEFS.filter((d) => d.mode !== 'bipole').map((d) => [d.id, d.tikz]))('%s is a %s node', (id, tikz) => {
    expect(out(comp(id as string)).code).toContain(`\\node[${tikz}`);
  });
  it('writes labels, values, voltage and current', () => {
    const n = comp('circuit.resistor', { science: { ...emptyCircuitSpec(), label: 'R_1', value: '10\\,\\Omega', current: 'I' } });
    const code = out(n).code;
    expect(code).toContain('l={$R_1$}');
    expect(code).toContain('a={$10\\,\\Omega$}');
    expect(code).toContain('i={$I$}');
  });
  it('joins value into the label when a voltage takes the other side', () => {
    const n = comp('circuit.resistor', { science: { ...emptyCircuitSpec(), label: 'R', value: '1', voltage: 'V' } });
    expect(out(n).code).toContain('l={$R=1$}');
    expect(out(n).code).toContain('v={$V$}');
  });
  it('honours current direction', () => {
    const n = comp('circuit.resistor', { science: { ...emptyCircuitSpec(), current: 'I', currentDir: 'backward' } });
    expect(out(n).code).toContain('i<={$I$}');
  });
  it('keeps the name on the upper side at every orientation', () => {
    expect(labelSideFlipped(comp('circuit.resistor'))).toBe(false);
    expect(labelSideFlipped(comp('circuit.resistor', { rotation: 90 }))).toBe(false);
    expect(labelSideFlipped(comp('circuit.resistor', { rotation: 180 }))).toBe(true);
    expect(labelSideFlipped(comp('circuit.resistor', { rotation: 270 }))).toBe(true);
    expect(labelSideFlipped(comp('circuit.resistor', { flipH: true }))).toBe(true);
    expect(labelSideFlipped(comp('circuit.resistor', { rotation: 180, flipH: true }))).toBe(false);
    const n = comp('circuit.resistor', { rotation: 180, science: { ...emptyCircuitSpec(), label: 'R', value: '1', current: 'I' } });
    const code = out(n).code;
    expect(code).toContain('l_={$R$}');
    expect(code).toContain('a^={$1$}');
    expect(code).toContain('i_>={$I$}');
  });
  it('endpoints follow rotation and mirroring', () => {
    const horizontal = out(comp('circuit.diode', { x: 100, y: 100 })).code;
    const flipped = out(comp('circuit.diode', { x: 100, y: 100, flipH: true })).code;
    const coords = (c: string) => /\((-?[\d.]+),(-?[\d.]+)\) to\[D[^\]]*\] \((-?[\d.]+),(-?[\d.]+)\)/.exec(c)!.slice(1).map(Number);
    const a = coords(horizontal);
    const b = coords(flipped);
    expect([b[0], b[2]]).toEqual([a[2], a[0]]);
    const rot = coords(out(comp('circuit.diode', { x: 100, y: 100, rotation: 90 })).code);
    expect(rot[0]).toBeCloseTo(rot[2], 3);
  });
  it('flip top-bottom uses invert', () => {
    expect(out(comp('circuit.zener', { flipV: true })).code).toContain('invert');
  });
  it('sets the symbol length from the box height', () => {
    expect(out(comp('circuit.resistor')).code).toContain('bipoles/length=1.4cm');
    expect(out(comp('circuit.resistor', { h: 80 })).code).toContain('bipoles/length=2.8cm');
  });
  it('honours colour, width, opacity and fill', () => {
    const n = comp('circuit.lamp');
    n.style = { ...n.style, stroke: '#112233', strokeWidth: 2, opacity: 0.5, fill: '#ffee00' };
    const code = out(n).code;
    for (const needle of ['color=fc112233', 'line width=1.138pt', 'opacity=0.5', 'fill=fcFFEE00']) expect(code).toContain(needle);
  });
  it('does not pass a fill to a symbol with no body', () => {
    const n = comp('circuit.resistor');
    n.style = { ...n.style, fill: '#ffee00' };
    expect(out(n).code).not.toContain('fill=');
  });
  it('rotated nodes use a scope so the part does not shear', () => {
    const code = out(comp('circuit.npn', { rotation: 90 })).code;
    expect(code).toMatch(/\\begin\{scope\}\[shift=\{\([^)]*\)\}, rotate=-90, transform shape\]/);
    expect(code).toContain('\\node[npn');
  });
  it('mirrored nodes scale by -1', () => {
    expect(out(comp('circuit.pnp', { flipH: true })).code).toContain('xscale=-1');
  });
  it('resized nodes scale', () => {
    expect(out(comp('circuit.npn', { w: 84, h: 154 })).code).toContain('xscale=2, yscale=2');
  });
  it('honours the document scale', () => {
    const d = doc(comp('circuit.npn'));
    d.settings.unitsPerCm = 25;
    expect(generateLatex(d).code).toContain('xscale=2, yscale=2');
  });
  it('a bad label is left out with a warning, keeping the part', () => {
    const r = out(comp('circuit.resistor', { science: { ...emptyCircuitSpec(), label: '\\frac{' } }));
    expect(r.code).toContain('to[R');
    expect(r.code.split('\n').filter((l) => !l.trimStart().startsWith('%')).join('\n')).not.toContain('\\frac{');
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
  it('warns when a part is shorter than its symbol', () => {
    expect(out(comp('circuit.resistor', { w: 30 })).issues.some((i) => /shorter/.test(i.message))).toBe(true);
  });
  it('wires use coordinates that land on the terminals', () => {
    const a = comp('circuit.resistor', { id: 'a', x: 0, y: 0 });
    const b = comp('circuit.resistor', { id: 'b', x: 200, y: 0 });
    const d = doc(a, b);
    const e = makeEdge({ id: 'e', wire: true, arrowEnd: 'none', source: { nodeId: 'a', port: 'e' }, target: { nodeId: 'b', port: 'w' } });
    d.edges.e = e;
    d.order.push('e');
    const code = generateLatex(d).code;
    const start = /\((-?[\d.]+),(-?[\d.]+)\) to\[R\S*\] \((-?[\d.]+),(-?[\d.]+)\)/.exec(code)!;
    expect(code).toContain(`(${start[3]},${start[4]}) --`);
  });
});

describe('physics diagram parts', () => {
  it('compile through the ordinary path emitter, with solids', () => {
    const code = out(makeNode('physics.force', 0, 0, { id: 'f' })).code;
    expect(code).toContain('\\draw[');
    expect(code).toContain('\\fill[');
  });
  it('mirror', () => {
    const a = out(makeNode('physics.incline', 0, 0, { id: 'f' })).code;
    const b = out(makeNode('physics.incline', 0, 0, { id: 'f', flipH: true })).code;
    expect(a).not.toBe(b);
  });
});
