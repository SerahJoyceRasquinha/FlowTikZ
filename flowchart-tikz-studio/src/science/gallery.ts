import type { Diagram, Edge, Node } from '../model/types';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import { normalizeOrder } from '../model/diagram';
import { CIRCUIT_DEFS } from './physics/circuits';
import { PHYSICS_SHAPE_DEFS } from './physics/diagramShapes';
import { CHEMISTRY_TOKENS, MATH_CATEGORIES, PHYSICS_CATEGORIES } from './math/symbols';
import { emptyCircuitSpec, CircuitSpec, ReactionSpec, ScienceSpec } from './types';
import { MOLECULE_TEMPLATES, fromBlueprint, moleculeNaturalSize } from './chem/molecule';
import { reactionToSource } from './chem/reaction';

/**
 * Representative diagrams used by the unit tests and compiled by pdfLaTeX in
 * `scripts/verify-latex.sh`. They are the proof that the output compiles.
 */

function add(d: Diagram, n: Node): Node {
  d.nodes[n.id] = n;
  d.order.push(n.id);
  return n;
}

let serial = 0;
const nid = () => `n${++serial}`;
const eid = () => `e${++serial}`;

function formula(d: Diagram, x: number, y: number, latex: string, patch: Partial<Node> = {}, display = true): Node {
  const w = Math.max(40, latex.length * 6);
  const science: ScienceSpec = { type: 'math', latex, display, natural: { w: w / 20, h: 2 } };
  const n = makeNode('math', x, y, { id: nid(), w, h: 40, science, ...patch });
  n.style = { ...n.style, strokeStyle: 'none', fillOpacity: 0, ...(patch.style ?? {}) };
  return add(d, n);
}

function chem(d: Diagram, x: number, y: number, source: string, reaction?: ReactionSpec, patch: Partial<Node> = {}): Node {
  const w = Math.max(60, source.length * 9);
  const n = makeNode('chem', x, y, {
    id: nid(),
    w,
    h: 36,
    science: { type: 'chem', source, natural: { w: w / 20, h: 1.8 }, ...(reaction ? { reaction } : {}) },
    ...patch,
  });
  n.style = { ...n.style, strokeStyle: 'none', fillOpacity: 0 };
  return add(d, n);
}

export const MATH_SAMPLES = [
  'a+b=c',
  '\\frac{a}{b}',
  '\\frac{\\frac{1}{x}+\\frac{1}{y}}{\\frac{1}{z}}',
  'x^{2}+y_{1}^{3}',
  '\\sqrt{x+1}+\\sqrt[3]{y}',
  '\\int_{0}^{\\infty} e^{-x^{2}}\\,\\mathrm{d}x=\\frac{\\sqrt{\\pi}}{2}',
  '\\oint_{C}\\vec{E}\\cdot\\mathrm{d}\\vec{l}',
  '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}=\\frac{\\pi^{2}}{6}',
  '\\prod_{i=1}^{n} x_{i}',
  '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  '\\begin{bmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{bmatrix}',
  '\\begin{vmatrix} x & y \\\\ z & w \\end{vmatrix}',
  'f(x)=\\begin{cases} x^{2} & x\\geq 0 \\\\ -x & x<0 \\end{cases}',
  '\\begin{aligned} a &= b+c \\\\ d &= e+f \\end{aligned}',
  '\\begin{gathered} a=b \\\\ c=d \\end{gathered}',
  '\\left( \\frac{a}{b} \\right)^{2}+\\left[ x \\right]+\\left\\{ y \\right\\}',
  '\\left| x \\right|+\\left\\| v \\right\\|+\\left\\lfloor z \\right\\rfloor+\\left\\lceil w \\right\\rceil',
  '\\overline{AB}+\\underline{CD}+\\vec{v}+\\hat{x}+\\bar{y}+\\dot{z}+\\ddot{w}+\\tilde{u}',
  '\\overbrace{a+b}+\\underbrace{c+d}',
  '\\sum\\limits_{k=0}^{n}\\binom{n}{k}=2^{n}',
  '\\int\\limits_{a}^{b} f',
  '\\forall x\\in\\mathbb{R},\\ \\exists y:\\ x\\leq y\\Rightarrow\\neg(x>y)',
  '\\textcolor[RGB]{220,38,38}{x^{2}}+\\textcolor{blue}{y}',
  '\\text{speed}=\\frac{\\text{distance}}{\\text{time}}',
  '\\cancel{x}+\\mathbf{v}+\\mathcal{L}+\\mathfrak{g}+\\boldsymbol{\\alpha}',
  '\\overset{a}{b}+\\underset{c}{d}',
];

export const CHEM_SAMPLES = [
  'H2O', 'CO2', 'H2SO4', 'Ca(OH)2', 'NH4+', 'SO4^2-', 'Fe^3+',
  '^{14}_{6}C', '^{238}_{92}U',
  'CuSO4 . 5 H2O',
  '2H2 + O2 -> 2H2O',
  'N2(g) + 3H2(g) <=> 2NH3(g)',
  'CaCO3(s) ->[$\\Delta$] CaO(s) + CO2 ^',
  '2SO2 + O2 ->[V2O5][450 °C] 2SO3',
  'A ->[k_1] B ->[k_2] C',
  'AgNO3(aq) + NaCl(aq) -> AgCl v + NaNO3(aq)',
  'CH3COOH <=>> CH3COO- + H+',
  'A <<=> B',
  'A <-> B',
];

export function mathGallery(): Diagram {
  const d = emptyDiagram('Mathematics');
  MATH_SAMPLES.forEach((tex, i) => formula(d, 0, i * 70, tex));
  // Styling: colour, scale, rotation, bold, background and border.
  formula(d, 520, 0, 'E=mc^{2}', { textStyle: { ...makeNode('math', 0, 0).textStyle, color: '#dc2626' } });
  formula(d, 520, 80, '\\frac{a}{b}', { rotation: 30 });
  formula(d, 520, 160, 'x+y', { textStyle: { ...makeNode('math', 0, 0).textStyle, bold: true } });
  formula(d, 520, 240, 'x', { w: 90, h: 60, style: { ...makeNode('math', 0, 0).style, fill: '#fef3c7', fillOpacity: 0.7, stroke: '#d97706', strokeStyle: 'solid', opacity: 0.8 } });
  formula(d, 520, 320, '\\sum_{i} i', {}, false);
  normalizeOrder(d);
  return d;
}

function component(d: Diagram, kind: string, x: number, y: number, spec: Partial<CircuitSpec> = {}, patch: Partial<Node> = {}): Node {
  const n = makeNode(kind, x, y, { id: nid(), science: { ...emptyCircuitSpec(), ...spec }, ...patch });
  n.style = { ...n.style, strokeWidth: 1.2, ...(patch.style ?? {}) };
  return add(d, n);
}

export function wire(d: Diagram, a: Node, pa: string, b: Node, pb: string, patch: Partial<Edge> = {}): Edge {
  const e = makeEdge({
    id: eid(),
    source: { nodeId: a.id, port: pa },
    target: { nodeId: b.id, port: pb },
    wire: true,
    arrowEnd: 'none',
    strokeWidth: 1.2,
    routing: 'orthogonal',
    ...patch,
  });
  d.edges[e.id] = e;
  d.order.push(e.id);
  return e;
}

export function allComponents(): Diagram {
  const d = emptyDiagram('All components');
  CIRCUIT_DEFS.forEach((def, i) => {
    component(d, def.id, (i % 6) * 170, Math.floor(i / 6) * 130, {
      label: def.designator ? `${def.designator}_{${i}}` : '',
      value: def.mode === 'bipole' && i % 3 === 0 ? '10\\,\\mathrm{k\\Omega}' : '',
    });
  });
  normalizeOrder(d);
  return d;
}

/** A closed loop, an op-amp stage, rotated and flipped parts, styled wires. */
export function circuitGallery(): Diagram {
  const d = emptyDiagram('Circuits');
  const v = component(d, 'circuit.dc-source', -50, 80, { label: 'V_s', value: '12\\,\\mathrm{V}' }, { rotation: 90 });
  const r1 = component(d, 'circuit.resistor', 40, 0, { label: 'R_1', value: '1\\,\\mathrm{k\\Omega}', current: 'I', currentDir: 'forward' });
  const c1 = component(d, 'circuit.capacitor', 190, 80, { label: 'C_1', voltage: 'v_c', value: '10\\,\\mu\\mathrm{F}' }, { rotation: 90 });
  const gnd = component(d, 'circuit.ground', 225, 200);
  wire(d, v, 'w', r1, 'w');
  wire(d, r1, 'e', c1, 'w');
  wire(d, c1, 'e', gnd, 'n');
  wire(d, v, 'e', gnd, 'n');

  const op = component(d, 'circuit.opamp', 520, 40, { label: 'U_1' });
  const rin = component(d, 'circuit.resistor', 360, 42, { label: 'R_{in}' });
  const rf = component(d, 'circuit.resistor', 540, -40, { label: 'R_f' });
  const dot = component(d, 'circuit.junction', 495, 60);
  wire(d, rin, 'e', dot, 'w');
  wire(d, dot, 'e', op, 'minus');
  wire(d, dot, 'n', rf, 'w', { routing: 'orthogonal' });
  wire(d, rf, 'e', op, 'out');
  const t = component(d, 'circuit.terminal', 330, 57);
  wire(d, t, 'e', rin, 'w');

  const q = component(d, 'circuit.npn', 800, 40, { label: 'Q_1' });
  const qf = component(d, 'circuit.pnp', 900, 40, {}, { flipH: true });
  const diodeFlipped = component(d, 'circuit.diode', 740, 180, { label: 'D_1' }, { flipH: true });
  const zener = component(d, 'circuit.zener', 880, 180, { label: 'D_2' }, { flipV: true });
  const led = component(d, 'circuit.led', 740, 260, {}, { style: { ...makeNode('process', 0, 0).style, stroke: '#2563eb', strokeWidth: 2 } });
  const rot = component(d, 'circuit.resistor', 900, 260, { label: 'R_9' }, { rotation: 45, h: 60, w: 160 });
  const big = component(d, 'circuit.dc-source', 0, 320, { label: 'E' }, { style: { ...makeNode('process', 0, 0).style, fill: '#fde68a', stroke: '#92400e' }, h: 60, w: 160 });
  const pot = component(d, 'circuit.potentiometer', 220, 320, { label: 'P_1' });
  const wiperEnd = component(d, 'circuit.terminal', 265, 260);
  wire(d, pot, 'wiper', wiperEnd, 's');
  wire(d, big, 'e', pot, 'w', { stroke: '#dc2626', strokeWidth: 2.4, strokeStyle: 'dashed', routing: 'straight' });
  const xf = component(d, 'circuit.transformer', 420, 300, { label: 'T_1' });
  const a1 = component(d, 'circuit.terminal', 360, 295);
  wire(d, a1, 'e', xf, 'a1');
  void q; void qf; void diodeFlipped; void zener; void led; void rot;

  // One polarised, fully labelled part in every orientation.
  [0, 90, 180, 270].forEach((rotation, i) => {
    component(d, 'circuit.diode', i * 190, 480, { label: 'D', voltage: 'v', current: 'i' }, { rotation });
    component(d, 'circuit.diode', i * 190, 640, { label: 'D', value: 'x', current: 'i', currentDir: 'backward' }, { rotation, flipH: true });
  });
  // Node parts rotated and mirrored, wired to terminals on every anchor.
  const rq = component(d, 'circuit.npn', 800, 480, { label: 'Q' }, { rotation: 90 });
  const rop = component(d, 'circuit.opamp', 900, 460, {}, { flipH: true });
  const rx = component(d, 'circuit.transformer', 1100, 460, {}, { rotation: 90 });
  for (const [n, port, at] of [[rq, 'B', [800, 460]], [rq, 'C', [760, 520]], [rq, 'E', [860, 520]], [rop, 'plus', [1040, 540]], [rop, 'out', [880, 440]]] as const) {
    const t2 = component(d, 'circuit.terminal', at[0], at[1]);
    wire(d, n, port, t2, 's', { routing: 'straight' });
  }
  void rx;
  normalizeOrder(d);
  return d;
}

export function physicsGallery(): Diagram {
  const d = emptyDiagram('Physics');
  PHYSICS_SHAPE_DEFS.forEach((def, i) => {
    const n = makeNode(def.id, (i % 5) * 240, Math.floor(i / 5) * 200, { id: nid() });
    if (i % 4 === 1) n.flipH = true;
    if (i % 4 === 2) n.rotation = 20;
    if (def.noOutline) n.style.fillOpacity = 0;
    add(d, n);
  });
  // A worked mechanics sketch: a block on a ramp with labelled forces.
  const ramp = makeNode('physics.incline', 0, 900, { id: nid() });
  add(d, ramp);
  const block = makeNode('physics.block', 90, 860, { id: nid(), w: 60, h: 40, rotation: 26.5 });
  add(d, block);
  const f = makeNode('physics.force', 150, 840, { id: nid(), rotation: -63.5, style: { ...block.style, stroke: '#dc2626' } });
  add(d, f);
  formula(d, 250, 800, '\\vec{F}=m\\vec{g}\\sin\\theta');
  normalizeOrder(d);
  return d;
}

export const SAMPLE_REACTION: ReactionSpec = {
  reactants: [
    { coefficient: '2', formula: 'H2', state: 'g' },
    { coefficient: '', formula: 'O2', state: 'g' },
  ],
  stages: [{ arrow: '->', above: 'Pt', below: '$\\Delta$', products: [{ coefficient: '2', formula: 'H2O', state: 'l' }] }],
};

export function chemGallery(): Diagram {
  const d = emptyDiagram('Chemistry');
  CHEM_SAMPLES.forEach((s, i) => chem(d, 0, i * 60, s));
  chem(d, 420, 0, reactionToSource(SAMPLE_REACTION), SAMPLE_REACTION);
  const bold = chem(d, 420, 80, 'H2O');
  bold.textStyle.bold = true;
  const rotated = chem(d, 420, 160, 'SO4^2-');
  rotated.rotation = 20;
  normalizeOrder(d);
  return d;
}

function molecule(d: Diagram, spec: Extract<ScienceSpec, { type: 'molecule' }>, x: number, y: number, scale = 1, patch: Partial<Node> = {}): Node {
  const nat = moleculeNaturalSize(spec);
  const n = makeNode('molecule', x, y, { id: nid(), w: nat.w * scale, h: nat.h * scale, science: spec, ...patch });
  n.style = { ...n.style, fillOpacity: 0, strokeWidth: 1.2, ...(patch.style ?? {}) };
  return add(d, n);
}

export function moleculeGallery(): Diagram {
  const d = emptyDiagram('Molecules');
  MOLECULE_TEMPLATES.forEach((t, i) => molecule(d, fromBlueprint(t.blueprint), (i % 5) * 180, Math.floor(i / 5) * 170));

  // Triple bond, stereo bonds, charges, lone pairs, radicals, a colour, a branch.
  const annotated = fromBlueprint({
    atoms: [[0, 0, ''], [0.87, -0.5, 'N'], [1.74, 0, 'O'], [0.87, -1.5, 'Cl'], [-0.87, -0.5, 'F'], [-0.87, 0.5, 'Br'], [0, 1, '']],
    bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1, 'wedge'], [0, 4, 1, 'dash'], [0, 5], [0, 6, 3]],
  });
  annotated.atoms[1].charge = 1;
  annotated.atoms[2].charge = -2;
  annotated.atoms[2].lonePairs = [0, 90];
  annotated.atoms[3].radicals = [90];
  annotated.atoms[4].color = '#dc2626';
  molecule(d, annotated, 0, 520);

  // Two separate fragments in one object.
  const ions = fromBlueprint({ atoms: [[0, 0, 'Na'], [3, 0, 'Cl']], bonds: [] });
  ions.atoms[0].charge = 1;
  ions.atoms[1].charge = -1;
  molecule(d, ions, 300, 520);

  // Fused rings: two closures through one graph.
  const fused = fromBlueprint({
    atoms: [[0.87, 0.5, ''], [0.87, -0.5, ''], [0, -1, ''], [-0.87, -0.5, ''], [-0.87, 0.5, ''], [0, 1, ''], [1.74, -1, ''], [2.6, -0.5, ''], [2.6, 0.5, ''], [1.74, 1, '']],
    bonds: [[0, 1], [1, 2, 2], [2, 3], [3, 4, 2], [4, 5], [5, 0, 2], [1, 6], [6, 7, 2], [7, 8], [8, 9, 2], [9, 0]],
  });
  molecule(d, fused, 520, 520);

  // Node-level styling: scaled, rotated, coloured bonds and labels, opacity.
  const eth = fromBlueprint(MOLECULE_TEMPLATES.find((t) => t.id === 'ethanol')!.blueprint);
  molecule(d, eth, 0, 760, 1.6, {
    rotation: 25,
    textStyle: { ...makeNode('molecule', 0, 0).textStyle, color: '#2563eb' },
    style: { ...makeNode('molecule', 0, 0).style, stroke: '#16a34a', strokeWidth: 2, opacity: 0.8 },
  });
  normalizeOrder(d);
  return d;
}

/** Every symbol button in every library, as compiled LaTeX. */
export function symbolGallery(): Diagram {
  const d = emptyDiagram('Every symbol');
  let i = 0;
  for (const c of [...MATH_CATEGORIES, ...PHYSICS_CATEGORIES]) {
    for (const s of c.symbols) {
      const tex = s.tex === '^\\circ' ? '90^\\circ' : s.tex;
      formula(d, (i % 12) * 90, Math.floor(i / 12) * 60, tex);
      i++;
    }
  }
  for (const c of CHEMISTRY_TOKENS) {
    if (c.id === 'compounds' || c.id === 'states') {
      for (const s of c.symbols) {
        chem(d, (i % 12) * 90, Math.floor(i / 12) * 60, s.tex.trim());
        i++;
      }
    } else {
      for (const s of c.symbols) {
        const src = c.id === 'notation' ? `Fe${s.tex}` : `A${s.tex}B`;
        chem(d, (i % 12) * 90, Math.floor(i / 12) * 60, src);
        i++;
      }
    }
  }
  normalizeOrder(d);
  return d;
}

export function mixedGallery(): Diagram {
  const d = emptyDiagram('Everything together');
  const p = add(d, makeNode('process', 0, 0, { id: nid(), text: 'Plain flowchart box' }));
  const q = add(d, makeNode('decision', 0, 140, { id: nid(), text: 'Math $x$ in text?' }));
  const e = makeEdge({ id: eid(), source: { nodeId: p.id, port: 's' }, target: { nodeId: q.id, port: 'n' } });
  d.edges[e.id] = e;
  d.order.push(e.id);
  formula(d, 240, 20, '\\frac{a}{b}');
  chem(d, 240, 100, 'H2O');
  component(d, 'circuit.resistor', 240, 170, { label: 'R' });
  molecule(d, fromBlueprint(MOLECULE_TEMPLATES[0].blueprint), 420, 20);
  normalizeOrder(d);
  return d;
}
