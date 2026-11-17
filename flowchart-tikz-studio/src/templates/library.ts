import type { Edge, Node } from '../model/types';
import { makeEdge, makeNode } from '../model/defaults';
import { emptyCircuitSpec, type CircuitSpec, type NaturalSize, type ScienceSpec } from '../science/types';
import { MOLECULE_TEMPLATES, fromBlueprint, moleculeNaturalSize } from '../science/chem/molecule';
import { DEFAULT_FORMULA_FONT, sizeForFont } from '../science/editing';

/**
 * The template library: ready-made flowcharts, formulas, physics laws and
 * circuits, chemical reactions and molecules.
 *
 * A template is data, not a picture. Inserting one adds ordinary objects to
 * the diagram - shapes, connectors, formulas, circuit parts - so every piece
 * stays editable and goes through the same LaTeX generator as hand-made work.
 */

export type TemplateCategory = 'flow' | 'math' | 'physics' | 'chem';

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; blurb: string }[] = [
  { id: 'flow', label: 'Flowcharts', blurb: 'Algorithms, decisions, loops and processes' },
  { id: 'math', label: 'Mathematics', blurb: 'Algebra, calculus, trigonometry, statistics, matrices' },
  { id: 'physics', label: 'Physics', blurb: 'Laws and equations, circuits, mechanics diagrams' },
  { id: 'chem', label: 'Chemistry', blurb: 'Reactions, molecules and chemistry formulas' },
];

interface TemplateBase {
  id: string;
  category: TemplateCategory;
  /** Sub-heading inside the category. */
  group: string;
  name: string;
  /** One plain-language line saying what it is or when it is used. */
  description: string;
  /** Extra words the search box should match. */
  keywords?: string;
}

export type TemplateDef = TemplateBase &
  (
    | { kind: 'diagram'; build: (ctx: BuildCtx) => Fragment }
    | { kind: 'math'; latex: string; display?: boolean }
    | { kind: 'chem'; source: string }
    | { kind: 'molecule'; molecule: string }
  );

export interface Fragment {
  nodes: Node[];
  edges: Edge[];
}

/** Measures typeset TeX in ems; null when the typesetter is not ready. */
export type Measure = (tex: string, display: boolean) => NaturalSize | null;

export interface BuildCtx {
  measure: Measure;
}

/* ================================================================ builders */

/** A rough size for TeX when no typesetter is available (tests, fixtures). */
export function estimateNatural(tex: string): NaturalSize {
  const visible = tex
    .replace(/\\(begin|end)\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_\\&]/g, '');
  const rows = (tex.match(/\\\\/g) ?? []).length + 1;
  const tall = /\\(frac|sum|int|prod|oint|sqrt|binom)/.test(tex) ? 2.2 : 1.3;
  return { w: Math.max(1, visible.length * 0.55), h: Math.max(tall, rows * 1.35) };
}

class Builder {
  nodes: Node[] = [];
  edges: Edge[] = [];
  private serial = 0;
  constructor(private ctx: BuildCtx) {}

  private id(prefix: string) {
    return `${prefix}${++this.serial}`;
  }

  /** A flowchart shape centred on (cx, cy). */
  box(kind: string, cx: number, cy: number, text: string, size: Partial<{ w: number; h: number }> = {}, fill?: string): Node {
    const n = makeNode(kind, 0, 0, { id: this.id('t'), text });
    n.w = size.w ?? n.w;
    n.h = size.h ?? n.h;
    n.x = Math.round(cx - n.w / 2);
    n.y = Math.round(cy - n.h / 2);
    if (fill) n.style = { ...n.style, fill };
    this.nodes.push(n);
    return n;
  }

  /** A connector between two shapes' ports. */
  link(a: Node, pa: string, b: Node, pb: string, opts: Partial<Edge> & { text?: string } = {}): Edge {
    const { text, ...rest } = opts;
    const e = makeEdge({
      id: this.id('c'),
      source: { nodeId: a.id, port: pa as never },
      target: { nodeId: b.id, port: pb as never },
      routing: 'orthogonal',
      ...rest,
    });
    if (text) {
      e.label = { text, pos: 0.5, offset: 0, fontSize: 12, color: '#12161c', background: true };
    }
    this.edges.push(e);
    return e;
  }

  /** A typeset formula centred on (cx, cy). */
  formula(cx: number, cy: number, latex: string, font = DEFAULT_FORMULA_FONT, display = true): Node {
    const nat = this.ctx.measure(latex, display) ?? estimateNatural(latex);
    const size = sizeForFont(nat, font);
    const science: ScienceSpec = { type: 'math', latex, display, natural: nat };
    const n = makeNode('math', 0, 0, { id: this.id('t'), w: size.w, h: size.h, science });
    n.x = Math.round(cx - size.w / 2);
    n.y = Math.round(cy - size.h / 2);
    n.style = { ...n.style, strokeStyle: 'none', fillOpacity: 0, strokeWidth: 1.2 };
    this.nodes.push(n);
    return n;
  }

  /** A circuit part or physics shape centred on (cx, cy). */
  part(kind: string, cx: number, cy: number, spec: Partial<CircuitSpec> | null = {}, patch: Partial<Node> = {}): Node {
    const n = makeNode(kind, 0, 0, { id: this.id('t'), ...patch });
    n.x = Math.round(cx - n.w / 2);
    n.y = Math.round(cy - n.h / 2);
    if (spec) n.science = { ...emptyCircuitSpec(), ...spec };
    if (kind.startsWith('circuit.')) n.style = { ...n.style, strokeWidth: 1.2 };
    this.nodes.push(n);
    return n;
  }

  /** A circuit wire between two terminals. */
  wire(a: Node, pa: string, b: Node, pb: string, patch: Partial<Edge> = {}): Edge {
    const e = makeEdge({
      id: this.id('c'),
      source: { nodeId: a.id, port: pa as never },
      target: { nodeId: b.id, port: pb as never },
      wire: true,
      arrowEnd: 'none',
      strokeWidth: 1.2,
      routing: 'orthogonal',
      ...patch,
    });
    this.edges.push(e);
    return e;
  }

  done(): Fragment {
    return { nodes: this.nodes, edges: this.edges };
  }
}

const START = '#d4f0ea';
const END = '#e6edf4';
const DECIDE = '#fff4d6';
const IO = '#e8f0ff';

/** Start / end terminators in the library's colours. */
const start = (b: Builder, cx: number, cy: number, text = 'Start') => b.box('terminator', cx, cy, text, { w: 130, h: 50 }, START);
const end = (b: Builder, cx: number, cy: number, text = 'End') => b.box('terminator', cx, cy, text, { w: 130, h: 50 }, END);
const step = (b: Builder, cx: number, cy: number, text: string) => b.box('process', cx, cy, text, { w: 170, h: 56 });
const ask = (b: Builder, cx: number, cy: number, text: string) => b.box('decision', cx, cy, text, { w: 170, h: 96 }, DECIDE);
const io = (b: Builder, cx: number, cy: number, text: string) => b.box('io', cx, cy, text, { w: 180, h: 56 }, IO);

/** Connect shapes top to bottom in a straight column. */
function chain(b: Builder, nodes: Node[]) {
  for (let i = 1; i < nodes.length; i++) b.link(nodes[i - 1], 's', nodes[i], 'n', { routing: 'straight' });
}

/* =============================================================== flowcharts */

const FLOW: TemplateDef[] = [
  {
    id: 'flow-linear', category: 'flow', group: 'Basics', kind: 'diagram',
    name: 'Simple process', description: 'Start → input → process → output → end, the basic sequence.',
    keywords: 'sequence steps linear basic ipo input process output',
    build: (ctx) => {
      const b = new Builder(ctx);
      chain(b, [start(b, 0, 0), io(b, 0, 100, 'Read input'), step(b, 0, 200, 'Process the data'), io(b, 0, 300, 'Display result'), end(b, 0, 400)]);
      return b.done();
    },
  },
  {
    id: 'flow-if-else', category: 'flow', group: 'Basics', kind: 'diagram',
    name: 'If / else decision', description: 'One question with a Yes branch and a No branch that join again.',
    keywords: 'condition branch decision if then else selection',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const q = ask(b, 0, 120, 'Condition?');
      const yes = step(b, -170, 260, 'Do A');
      const no = step(b, 170, 260, 'Do B');
      const e = end(b, 0, 390);
      b.link(s, 's', q, 'n', { routing: 'straight' });
      b.link(q, 'w', yes, 'n', { text: 'Yes' });
      b.link(q, 'e', no, 'n', { text: 'No' });
      b.link(yes, 's', e, 'w');
      b.link(no, 's', e, 'e');
      return b.done();
    },
  },
  {
    id: 'flow-while', category: 'flow', group: 'Loops', kind: 'diagram',
    name: 'While loop', description: 'Repeat the body as long as the condition holds; test first.',
    keywords: 'loop repeat iteration while condition pre-test',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const init = step(b, 0, 100, 'Initialise');
      const q = ask(b, 0, 225, 'Condition\ntrue?');
      const body = step(b, 0, 360, 'Loop body');
      const upd = step(b, 0, 460, 'Update');
      const e = end(b, 260, 225);
      chain(b, [s, init, q]);
      b.link(q, 's', body, 'n', { routing: 'straight', text: 'Yes' });
      b.link(body, 's', upd, 'n', { routing: 'straight' });
      b.link(upd, 'w', q, 'w', { routing: 'orthogonal' });
      b.link(q, 'e', e, 'w', { routing: 'straight', text: 'No' });
      return b.done();
    },
  },
  {
    id: 'flow-for', category: 'flow', group: 'Loops', kind: 'diagram',
    name: 'For loop (counter)', description: 'Run a block for i = 1 to n, then stop.',
    keywords: 'loop counter for i iteration count repeat n times',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const init = step(b, 0, 100, 'i ← 1');
      const q = ask(b, 0, 225, 'i ≤ n?');
      const body = step(b, 0, 360, 'Do the work');
      const inc = step(b, 0, 460, 'i ← i + 1');
      const e = end(b, 260, 225);
      chain(b, [s, init, q]);
      b.link(q, 's', body, 'n', { routing: 'straight', text: 'Yes' });
      b.link(body, 's', inc, 'n', { routing: 'straight' });
      b.link(inc, 'w', q, 'w');
      b.link(q, 'e', e, 'w', { routing: 'straight', text: 'No' });
      return b.done();
    },
  },
  {
    id: 'flow-do-while', category: 'flow', group: 'Loops', kind: 'diagram',
    name: 'Do-while loop', description: 'Run the body once, then repeat while the condition holds.',
    keywords: 'loop repeat until post-test do while',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const body = step(b, 0, 100, 'Loop body');
      const q = ask(b, 0, 230, 'Repeat?');
      const e = end(b, 0, 360);
      chain(b, [s, body, q]);
      b.link(q, 'e', body, 'e', { text: 'Yes' });
      b.link(q, 's', e, 'n', { routing: 'straight', text: 'No' });
      return b.done();
    },
  },
  {
    id: 'flow-switch', category: 'flow', group: 'Basics', kind: 'diagram',
    name: 'Switch / multiple choice', description: 'One value picks one of several cases.',
    keywords: 'switch case menu multiway select options',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const q = ask(b, 0, 120, 'Choice?');
      const c1 = step(b, -230, 270, 'Case 1');
      const c2 = step(b, 0, 270, 'Case 2');
      const c3 = step(b, 230, 270, 'Default');
      const e = end(b, 0, 400);
      b.link(s, 's', q, 'n', { routing: 'straight' });
      b.link(q, 'w', c1, 'n', { text: '1' });
      b.link(q, 's', c2, 'n', { routing: 'straight', text: '2' });
      b.link(q, 'e', c3, 'n', { text: 'other' });
      b.link(c1, 's', e, 'w');
      b.link(c2, 's', e, 'n', { routing: 'straight' });
      b.link(c3, 's', e, 'e');
      return b.done();
    },
  },
  {
    id: 'flow-largest', category: 'flow', group: 'Classic algorithms', kind: 'diagram',
    name: 'Largest of two numbers', description: 'Read a and b, compare them and print the larger one.',
    keywords: 'max maximum compare greater two numbers student',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const r = io(b, 0, 100, 'Read a, b');
      const q = ask(b, 0, 225, 'a > b?');
      const pa = io(b, -190, 360, 'Print a');
      const pb = io(b, 190, 360, 'Print b');
      const e = end(b, 0, 480);
      chain(b, [s, r, q]);
      b.link(q, 'w', pa, 'n', { text: 'Yes' });
      b.link(q, 'e', pb, 'n', { text: 'No' });
      b.link(pa, 's', e, 'w');
      b.link(pb, 's', e, 'e');
      return b.done();
    },
  },
  {
    id: 'flow-even-odd', category: 'flow', group: 'Classic algorithms', kind: 'diagram',
    name: 'Even or odd', description: 'Check whether n is divisible by 2.',
    keywords: 'parity modulo remainder even odd number',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const r = io(b, 0, 100, 'Read n');
      const q = ask(b, 0, 225, 'n mod 2 = 0?');
      const pa = io(b, -190, 360, 'Print "Even"');
      const pb = io(b, 190, 360, 'Print "Odd"');
      const e = end(b, 0, 480);
      chain(b, [s, r, q]);
      b.link(q, 'w', pa, 'n', { text: 'Yes' });
      b.link(q, 'e', pb, 'n', { text: 'No' });
      b.link(pa, 's', e, 'w');
      b.link(pb, 's', e, 'e');
      return b.done();
    },
  },
  {
    id: 'flow-sum-n', category: 'flow', group: 'Classic algorithms', kind: 'diagram',
    name: 'Sum of first n numbers', description: 'Add 1 + 2 + … + n with a loop.',
    keywords: 'sum total accumulate add loop natural numbers',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const r = io(b, 0, 100, 'Read n');
      const init = step(b, 0, 200, 'sum ← 0, i ← 1');
      const q = ask(b, 0, 325, 'i ≤ n?');
      const add = step(b, 0, 460, 'sum ← sum + i');
      const inc = step(b, 0, 560, 'i ← i + 1');
      const out = io(b, 280, 325, 'Print sum');
      const e = end(b, 280, 440);
      chain(b, [s, r, init, q]);
      b.link(q, 's', add, 'n', { routing: 'straight', text: 'Yes' });
      b.link(add, 's', inc, 'n', { routing: 'straight' });
      b.link(inc, 'w', q, 'w');
      b.link(q, 'e', out, 'w', { routing: 'straight', text: 'No' });
      b.link(out, 's', e, 'n', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-factorial', category: 'flow', group: 'Classic algorithms', kind: 'diagram',
    name: 'Factorial of n', description: 'Compute n! = 1 × 2 × … × n.',
    keywords: 'factorial product multiply loop recursion n!',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const r = io(b, 0, 100, 'Read n');
      const init = step(b, 0, 200, 'fact ← 1, i ← 1');
      const q = ask(b, 0, 325, 'i ≤ n?');
      const mul = step(b, 0, 460, 'fact ← fact × i');
      const inc = step(b, 0, 560, 'i ← i + 1');
      const out = io(b, 280, 325, 'Print fact');
      const e = end(b, 280, 440);
      chain(b, [s, r, init, q]);
      b.link(q, 's', mul, 'n', { routing: 'straight', text: 'Yes' });
      b.link(mul, 's', inc, 'n', { routing: 'straight' });
      b.link(inc, 'w', q, 'w');
      b.link(q, 'e', out, 'w', { routing: 'straight', text: 'No' });
      b.link(out, 's', e, 'n', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-binary-search', category: 'flow', group: 'Classic algorithms', kind: 'diagram',
    name: 'Binary search', description: 'Find a key in a sorted list by halving the range.',
    keywords: 'search sorted array divide halve low high mid algorithm',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const init = step(b, 0, 100, 'low ← 0, high ← n − 1');
      const q1 = ask(b, 0, 225, 'low ≤ high?');
      const mid = step(b, 0, 355, 'mid ← (low + high) / 2');
      const q2 = ask(b, 0, 480, 'A[mid] = key?');
      const q3 = ask(b, 0, 630, 'A[mid] < key?');
      const right = step(b, 0, 765, 'low ← mid + 1');
      const left = step(b, -270, 630, 'high ← mid − 1');
      const nf = io(b, 300, 225, 'Not found');
      const found = io(b, 300, 480, 'Found at mid');
      const e1 = end(b, 520, 225);
      const e2 = end(b, 520, 480);
      chain(b, [s, init, q1]);
      b.link(q1, 's', mid, 'n', { routing: 'straight', text: 'Yes' });
      b.link(q1, 'e', nf, 'w', { routing: 'straight', text: 'No' });
      b.link(nf, 'e', e1, 'w', { routing: 'straight' });
      b.link(mid, 's', q2, 'n', { routing: 'straight' });
      b.link(q2, 'e', found, 'w', { routing: 'straight', text: 'Yes' });
      b.link(found, 'e', e2, 'w', { routing: 'straight' });
      b.link(q2, 's', q3, 'n', { routing: 'straight', text: 'No' });
      b.link(q3, 's', right, 'n', { routing: 'straight', text: 'Yes' });
      b.link(q3, 'w', left, 'e', { routing: 'straight', text: 'No' });
      b.link(right, 'w', q1, 'w');
      b.link(left, 'n', q1, 'w');
      return b.done();
    },
  },
  {
    id: 'flow-login', category: 'flow', group: 'Applications', kind: 'diagram',
    name: 'User login', description: 'Enter credentials, check them, then open the dashboard or retry.',
    keywords: 'authentication sign in password username validate retry app',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const enter = io(b, 0, 100, 'Enter username\nand password');
      const db = b.box('database', 260, 225, 'User\ndatabase', { w: 120, h: 80 }, '#eef2ff');
      const q = ask(b, 0, 225, 'Valid?');
      const ok = step(b, 0, 360, 'Open dashboard');
      const err = step(b, -260, 225, 'Show error');
      const e = end(b, 0, 460);
      chain(b, [s, enter, q]);
      b.link(q, 'e', db, 'w', { routing: 'straight', arrowStart: 'stealth', strokeStyle: 'dashed', text: 'check' });
      b.link(q, 's', ok, 'n', { routing: 'straight', text: 'Yes' });
      b.link(q, 'w', err, 'e', { routing: 'straight', text: 'No' });
      b.link(err, 'n', enter, 'w');
      b.link(ok, 's', e, 'n', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-try-catch', category: 'flow', group: 'Applications', kind: 'diagram',
    name: 'Error handling (try / catch)', description: 'Attempt an operation; on failure log the error and recover.',
    keywords: 'exception try catch error failure recover log',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0);
      const t = step(b, 0, 100, 'Try the operation');
      const q = ask(b, 0, 225, 'Error?');
      const log = b.box('document', 260, 225, 'Log the error', { w: 160, h: 64 }, '#fadfd8');
      const rec = step(b, 260, 345, 'Recover / retry');
      const ok = step(b, 0, 360, 'Continue');
      const e = end(b, 0, 460);
      chain(b, [s, t, q]);
      b.link(q, 'e', log, 'w', { routing: 'straight', text: 'Yes' });
      b.link(log, 's', rec, 'n', { routing: 'straight' });
      b.link(rec, 'e', t, 'e');
      b.link(q, 's', ok, 'n', { routing: 'straight', text: 'No' });
      b.link(ok, 's', e, 'n', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-order', category: 'flow', group: 'Applications', kind: 'diagram',
    name: 'Online order', description: 'Place an order, check stock and payment, then ship.',
    keywords: 'ecommerce shop order payment stock shipping business process',
    build: (ctx) => {
      const b = new Builder(ctx);
      const s = start(b, 0, 0, 'Order placed');
      const q1 = ask(b, 0, 125, 'In stock?');
      const back = b.box('document', 270, 125, 'Back-order\nnotice', { w: 150, h: 64 }, '#fadfd8');
      const pay = step(b, 0, 260, 'Take payment');
      const q2 = ask(b, 0, 385, 'Payment OK?');
      const cancel = step(b, 270, 385, 'Cancel order');
      const ship = step(b, 0, 520, 'Pack and ship');
      const db = b.box('database', -260, 520, 'Orders', { w: 110, h: 76 }, '#eef2ff');
      const e = end(b, 0, 625, 'Delivered');
      b.link(s, 's', q1, 'n', { routing: 'straight' });
      b.link(q1, 'e', back, 'w', { routing: 'straight', text: 'No' });
      b.link(q1, 's', pay, 'n', { routing: 'straight', text: 'Yes' });
      b.link(pay, 's', q2, 'n', { routing: 'straight' });
      b.link(q2, 'e', cancel, 'w', { routing: 'straight', text: 'No' });
      b.link(q2, 's', ship, 'n', { routing: 'straight', text: 'Yes' });
      b.link(ship, 'w', db, 'e', { routing: 'straight', strokeStyle: 'dashed', text: 'record' });
      b.link(ship, 's', e, 'n', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-waterfall', category: 'flow', group: 'Processes', kind: 'diagram',
    name: 'Software life cycle (waterfall)', description: 'Requirements → design → build → test → deploy → maintain.',
    keywords: 'sdlc waterfall software engineering phases project',
    build: (ctx) => {
      const b = new Builder(ctx);
      const names = ['Requirements', 'Design', 'Implementation', 'Testing', 'Deployment', 'Maintenance'];
      const fills = ['#dbe8ff', '#e0f2fe', '#dcfce7', '#fef9c3', '#ffedd5', '#fae8ff'];
      const nodes = names.map((t, i) => b.box('process', i * 120, i * 85, t, { w: 160, h: 52 }, fills[i]));
      for (let i = 1; i < nodes.length; i++) b.link(nodes[i - 1], 'e', nodes[i], 'n');
      return b.done();
    },
  },
  {
    id: 'flow-pdca', category: 'flow', group: 'Processes', kind: 'diagram',
    name: 'Plan–Do–Check–Act cycle', description: 'The continuous-improvement loop of four stages.',
    keywords: 'pdca deming cycle quality improvement loop management',
    build: (ctx) => {
      const b = new Builder(ctx);
      const round = (n: Node) => ((n.style = { ...n.style, cornerRadius: 14 }), n);
      const plan = round(b.box('process', 0, 0, 'Plan', { w: 150, h: 60 }, '#dbe8ff'));
      const doo = round(b.box('process', 260, 0, 'Do', { w: 150, h: 60 }, '#dcfce7'));
      const check = round(b.box('process', 260, 170, 'Check', { w: 150, h: 60 }, '#fef9c3'));
      const act = round(b.box('process', 0, 170, 'Act', { w: 150, h: 60 }, '#fadfd8'));
      b.link(plan, 'e', doo, 'w', { routing: 'straight' });
      b.link(doo, 's', check, 'n', { routing: 'straight' });
      b.link(check, 'w', act, 'e', { routing: 'straight' });
      b.link(act, 'n', plan, 's', { routing: 'straight' });
      return b.done();
    },
  },
  {
    id: 'flow-ipo', category: 'flow', group: 'Basics', kind: 'diagram',
    name: 'Input → Process → Output', description: 'The three-box system model, side by side.',
    keywords: 'ipo system model input process output block diagram',
    build: (ctx) => {
      const b = new Builder(ctx);
      const i = io(b, 0, 0, 'Input');
      const p = step(b, 230, 0, 'Process');
      const o = io(b, 460, 0, 'Output');
      b.link(i, 'e', p, 'w', { routing: 'straight' });
      b.link(p, 'e', o, 'w', { routing: 'straight' });
      return b.done();
    },
  },
];

/* ============================================================== mathematics */

const m = (id: string, group: string, name: string, latex: string, description: string, keywords = ''): TemplateDef => ({
  id: `math-${id}`, category: 'math', group, name, description, keywords, kind: 'math', latex,
});

const MATH: TemplateDef[] = [
  // Algebra
  m('quadratic', 'Algebra', 'Quadratic formula', 'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}', 'Roots of ax² + bx + c = 0.', 'roots solve equation'),
  m('quadratic-eq', 'Algebra', 'Quadratic equation', 'ax^{2}+bx+c=0', 'The general quadratic.', 'polynomial'),
  m('square-sum', 'Algebra', 'Square of a sum', '(a+b)^{2}=a^{2}+2ab+b^{2}', 'Expanding (a + b)².', 'identity expand'),
  m('square-diff', 'Algebra', 'Square of a difference', '(a-b)^{2}=a^{2}-2ab+b^{2}', 'Expanding (a − b)².', 'identity expand'),
  m('diff-squares', 'Algebra', 'Difference of squares', 'a^{2}-b^{2}=(a+b)(a-b)', 'Factorising a² − b².', 'identity factor'),
  m('cube-sum', 'Algebra', 'Cube of a sum', '(a+b)^{3}=a^{3}+3a^{2}b+3ab^{2}+b^{3}', 'Expanding (a + b)³.', 'identity expand'),
  m('binomial', 'Algebra', 'Binomial theorem', '(x+y)^{n}=\\sum_{k=0}^{n}\\binom{n}{k}x^{n-k}y^{k}', 'Expansion of (x + y)ⁿ.', 'pascal expansion'),
  m('log-laws', 'Algebra', 'Laws of logarithms', '\\begin{aligned} \\log_{b}(xy)&=\\log_{b}x+\\log_{b}y \\\\ \\log_{b}\\frac{x}{y}&=\\log_{b}x-\\log_{b}y \\\\ \\log_{b}x^{n}&=n\\log_{b}x \\end{aligned}', 'Product, quotient and power rules.', 'log rules'),
  m('exp-laws', 'Algebra', 'Laws of exponents', 'a^{m}a^{n}=a^{m+n},\\quad \\frac{a^{m}}{a^{n}}=a^{m-n},\\quad (a^{m})^{n}=a^{mn}', 'Index laws.', 'powers indices'),
  m('change-base', 'Algebra', 'Change of base', '\\log_{b}x=\\frac{\\ln x}{\\ln b}', 'Logarithm in any base.', 'log'),
  m('abs', 'Algebra', 'Absolute value', '|x|=\\begin{cases} x & x\\geq 0 \\\\ -x & x<0 \\end{cases}', 'Piecewise definition.', 'modulus cases piecewise'),
  m('ap-term', 'Algebra', 'Arithmetic progression', 'a_{n}=a_{1}+(n-1)d,\\qquad S_{n}=\\frac{n}{2}\\left(2a_{1}+(n-1)d\\right)', 'nth term and sum of an AP.', 'sequence series arithmetic'),
  m('gp-term', 'Algebra', 'Geometric progression', 'a_{n}=a_{1}r^{n-1},\\qquad S_{n}=a_{1}\\frac{1-r^{n}}{1-r}', 'nth term and sum of a GP.', 'sequence series geometric'),
  m('system', 'Algebra', 'System of two equations', '\\begin{cases} a_{1}x+b_{1}y=c_{1} \\\\ a_{2}x+b_{2}y=c_{2} \\end{cases}', 'Two linear equations in x and y.', 'simultaneous linear'),
  // Calculus
  m('derivative-def', 'Calculus', 'Derivative (definition)', "f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}", 'Derivative as a limit.', 'differentiation first principles'),
  m('power-rule', 'Calculus', 'Power rule', '\\frac{\\mathrm{d}}{\\mathrm{d}x}x^{n}=nx^{n-1}', 'Differentiating xⁿ.', 'differentiation'),
  m('product-rule', 'Calculus', 'Product rule', "(uv)'=u'v+uv'", 'Derivative of a product.', 'differentiation'),
  m('quotient-rule', 'Calculus', 'Quotient rule', "\\left(\\frac{u}{v}\\right)'=\\frac{u'v-uv'}{v^{2}}", 'Derivative of a quotient.', 'differentiation'),
  m('chain-rule', 'Calculus', 'Chain rule', '\\frac{\\mathrm{d}y}{\\mathrm{d}x}=\\frac{\\mathrm{d}y}{\\mathrm{d}u}\\cdot\\frac{\\mathrm{d}u}{\\mathrm{d}x}', 'Derivative of a composition.', 'differentiation composite'),
  m('power-integral', 'Calculus', 'Integral of xⁿ', '\\int x^{n}\\,\\mathrm{d}x=\\frac{x^{n+1}}{n+1}+C', 'Antiderivative, n ≠ −1.', 'integration'),
  m('by-parts', 'Calculus', 'Integration by parts', '\\int u\\,\\mathrm{d}v=uv-\\int v\\,\\mathrm{d}u', 'Integrating a product.', 'integration'),
  m('ftc', 'Calculus', 'Fundamental theorem', '\\int_{a}^{b}f(x)\\,\\mathrm{d}x=F(b)-F(a)', 'Definite integral from an antiderivative.', 'integration definite'),
  m('taylor', 'Calculus', 'Taylor series', "f(x)=\\sum_{n=0}^{\\infty}\\frac{f^{(n)}(a)}{n!}(x-a)^{n}", 'Expansion about x = a.', 'series expansion'),
  m('maclaurin-exp', 'Calculus', 'Series for eˣ', 'e^{x}=\\sum_{n=0}^{\\infty}\\frac{x^{n}}{n!}=1+x+\\frac{x^{2}}{2!}+\\cdots', 'Maclaurin series of the exponential.', 'series exponential'),
  m('lhopital', 'Calculus', "L'Hôpital's rule", "\\lim_{x\\to a}\\frac{f(x)}{g(x)}=\\lim_{x\\to a}\\frac{f'(x)}{g'(x)}", 'Limits of the form 0/0 or ∞/∞.', 'limit'),
  m('sinx-x', 'Calculus', 'Standard limit', '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1', 'A limit used everywhere.', 'limit trig'),
  m('gaussian', 'Calculus', 'Gaussian integral', '\\int_{-\\infty}^{\\infty}e^{-x^{2}}\\,\\mathrm{d}x=\\sqrt{\\pi}', 'Area under e^(−x²).', 'integration normal'),
  m('partial', 'Calculus', 'Partial derivatives', '\\frac{\\partial^{2} f}{\\partial x\\,\\partial y}=\\frac{\\partial^{2} f}{\\partial y\\,\\partial x}', 'Equality of mixed partials.', 'multivariable'),
  // Trigonometry
  m('pyth-id', 'Trigonometry', 'Pythagorean identity', '\\sin^{2}\\theta+\\cos^{2}\\theta=1', 'The basic identity.', 'trig identity'),
  m('sin-sum', 'Trigonometry', 'Sine of a sum', '\\sin(\\alpha\\pm\\beta)=\\sin\\alpha\\cos\\beta\\pm\\cos\\alpha\\sin\\beta', 'Compound angle formula.', 'addition'),
  m('cos-sum', 'Trigonometry', 'Cosine of a sum', '\\cos(\\alpha\\pm\\beta)=\\cos\\alpha\\cos\\beta\\mp\\sin\\alpha\\sin\\beta', 'Compound angle formula.', 'addition'),
  m('double-angle', 'Trigonometry', 'Double angle', '\\sin 2\\theta=2\\sin\\theta\\cos\\theta,\\quad \\cos 2\\theta=\\cos^{2}\\theta-\\sin^{2}\\theta', 'Double-angle formulas.', ''),
  m('tan', 'Trigonometry', 'Tangent', '\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}', 'Tangent from sine and cosine.', ''),
  m('law-sines', 'Trigonometry', 'Law of sines', '\\frac{a}{\\sin A}=\\frac{b}{\\sin B}=\\frac{c}{\\sin C}', 'Sides and opposite angles of a triangle.', 'sine rule triangle'),
  m('law-cosines', 'Trigonometry', 'Law of cosines', 'c^{2}=a^{2}+b^{2}-2ab\\cos C', 'Generalised Pythagoras.', 'cosine rule triangle'),
  m('euler-formula', 'Trigonometry', "Euler's formula", 'e^{i\\theta}=\\cos\\theta+i\\sin\\theta', 'Complex exponential.', 'complex'),
  m('euler-identity', 'Trigonometry', "Euler's identity", 'e^{i\\pi}+1=0', 'Five constants in one line.', 'complex'),
  // Geometry
  m('pythagoras', 'Geometry', 'Pythagoras theorem', 'a^{2}+b^{2}=c^{2}', 'Right-angled triangle.', 'right triangle hypotenuse'),
  m('circle-area', 'Geometry', 'Circle: area and circumference', 'A=\\pi r^{2},\\qquad C=2\\pi r', 'Area and perimeter of a circle.', ''),
  m('distance', 'Geometry', 'Distance between points', 'd=\\sqrt{(x_{2}-x_{1})^{2}+(y_{2}-y_{1})^{2}}', 'Length of a segment.', 'coordinate'),
  m('slope', 'Geometry', 'Slope and line', 'm=\\frac{y_{2}-y_{1}}{x_{2}-x_{1}},\\qquad y=mx+c', 'Gradient and equation of a line.', 'gradient straight line'),
  m('circle-eq', 'Geometry', 'Equation of a circle', '(x-h)^{2}+(y-k)^{2}=r^{2}', 'Centre (h, k), radius r.', 'coordinate'),
  m('sphere', 'Geometry', 'Sphere', 'V=\\frac{4}{3}\\pi r^{3},\\qquad A=4\\pi r^{2}', 'Volume and surface area.', 'solid volume'),
  m('heron', 'Geometry', "Heron's formula", 'A=\\sqrt{s(s-a)(s-b)(s-c)},\\quad s=\\frac{a+b+c}{2}', 'Triangle area from its sides.', 'triangle area'),
  // Statistics
  m('mean', 'Statistics & probability', 'Mean', '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_{i}', 'Arithmetic average.', 'average'),
  m('variance', 'Statistics & probability', 'Variance', '\\sigma^{2}=\\frac{1}{n}\\sum_{i=1}^{n}(x_{i}-\\mu)^{2}', 'Spread about the mean.', ''),
  m('std', 'Statistics & probability', 'Sample standard deviation', 's=\\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}(x_{i}-\\bar{x})^{2}}', 'Spread of a sample.', 'sd'),
  m('normal', 'Statistics & probability', 'Normal distribution', 'f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}', 'Bell curve density.', 'gaussian pdf'),
  m('zscore', 'Statistics & probability', 'z-score', 'z=\\frac{x-\\mu}{\\sigma}', 'Standardised value.', 'standard score'),
  m('bayes', 'Statistics & probability', "Bayes' theorem", 'P(A\\mid B)=\\frac{P(B\\mid A)\\,P(A)}{P(B)}', 'Reverse a conditional probability.', 'conditional'),
  m('conditional', 'Statistics & probability', 'Conditional probability', 'P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}', 'Probability of A given B.', ''),
  m('binomial-dist', 'Statistics & probability', 'Binomial distribution', 'P(X=k)=\\binom{n}{k}p^{k}(1-p)^{n-k}', 'k successes in n trials.', 'bernoulli'),
  m('ncr', 'Statistics & probability', 'Combinations and permutations', '\\binom{n}{r}=\\frac{n!}{r!\\,(n-r)!},\\qquad {}^{n}P_{r}=\\frac{n!}{(n-r)!}', 'Counting selections.', 'ncr npr choose'),
  m('expectation', 'Statistics & probability', 'Expected value', 'E[X]=\\sum_{i}x_{i}\\,p_{i}', 'Long-run average of X.', 'expectation'),
  m('correlation', 'Statistics & probability', 'Correlation coefficient', 'r=\\frac{\\sum(x_{i}-\\bar{x})(y_{i}-\\bar{y})}{\\sqrt{\\sum(x_{i}-\\bar{x})^{2}\\sum(y_{i}-\\bar{y})^{2}}}', "Pearson's r.", 'pearson regression'),
  // Linear algebra
  m('matrix2', 'Linear algebra', '2 × 2 matrix', 'A=\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'A general 2 × 2 matrix.', 'matrix'),
  m('identity3', 'Linear algebra', 'Identity matrix', 'I=\\begin{bmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{bmatrix}', '3 × 3 identity.', 'matrix'),
  m('det2', 'Linear algebra', 'Determinant (2 × 2)', '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}=ad-bc', 'Determinant of a 2 × 2 matrix.', 'det'),
  m('inverse2', 'Linear algebra', 'Inverse (2 × 2)', 'A^{-1}=\\frac{1}{ad-bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}', 'Inverse of a 2 × 2 matrix.', 'matrix inverse'),
  m('matmul', 'Linear algebra', 'Matrix product', '(AB)_{ij}=\\sum_{k=1}^{n}a_{ik}b_{kj}', 'Entry of a product.', 'multiplication'),
  m('eigen', 'Linear algebra', 'Eigenvalue equation', 'A\\mathbf{v}=\\lambda\\mathbf{v},\\qquad \\det(A-\\lambda I)=0', 'Eigenvectors and the characteristic equation.', 'eigenvector'),
  m('dot', 'Linear algebra', 'Dot product', '\\mathbf{a}\\cdot\\mathbf{b}=|\\mathbf{a}|\\,|\\mathbf{b}|\\cos\\theta=\\sum_{i}a_{i}b_{i}', 'Scalar product of two vectors.', 'scalar vector'),
  m('cross', 'Linear algebra', 'Cross product', '\\mathbf{a}\\times\\mathbf{b}=\\begin{vmatrix} \\mathbf{i} & \\mathbf{j} & \\mathbf{k} \\\\ a_{1} & a_{2} & a_{3} \\\\ b_{1} & b_{2} & b_{3} \\end{vmatrix}', 'Vector product as a determinant.', 'vector'),
  m('linear-system', 'Linear algebra', 'Matrix form Ax = b', '\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}\\begin{pmatrix} x_{1} \\\\ x_{2} \\end{pmatrix}=\\begin{pmatrix} b_{1} \\\\ b_{2} \\end{pmatrix}', 'A linear system as matrices.', 'equations'),
  // Series & number
  m('sum-n', 'Series & numbers', 'Sum of 1 to n', '\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}', 'Triangular numbers.', 'gauss'),
  m('sum-squares', 'Series & numbers', 'Sum of squares', '\\sum_{k=1}^{n}k^{2}=\\frac{n(n+1)(2n+1)}{6}', 'Square pyramidal numbers.', ''),
  m('geometric-inf', 'Series & numbers', 'Infinite geometric series', '\\sum_{n=0}^{\\infty}ar^{n}=\\frac{a}{1-r},\\quad |r|<1', 'Sum of a convergent GP.', ''),
  m('basel', 'Series & numbers', 'Basel problem', '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}=\\frac{\\pi^{2}}{6}', "Euler's famous sum.", 'zeta'),
  m('fourier', 'Series & numbers', 'Fourier series', 'f(x)=\\frac{a_{0}}{2}+\\sum_{n=1}^{\\infty}\\left(a_{n}\\cos nx+b_{n}\\sin nx\\right)', 'Periodic function as sines and cosines.', 'signal'),
  m('complex-polar', 'Series & numbers', 'Complex number forms', 'z=a+bi=r(\\cos\\theta+i\\sin\\theta)=re^{i\\theta}', 'Rectangular, trigonometric and exponential form.', 'polar'),
  m('demoivre', 'Series & numbers', "De Moivre's theorem", '(\\cos\\theta+i\\sin\\theta)^{n}=\\cos n\\theta+i\\sin n\\theta', 'Powers of a complex number.', 'complex'),
  m('sets', 'Series & numbers', 'Set notation', 'A\\cup B=\\{x : x\\in A\\lor x\\in B\\},\\quad A\\cap B=\\{x : x\\in A\\land x\\in B\\}', 'Union and intersection.', 'logic sets'),
];

/* ================================================================== physics */

const p = (id: string, group: string, name: string, latex: string, description: string, keywords = ''): TemplateDef => ({
  id: `phys-${id}`, category: 'physics', group, name, description, keywords, kind: 'math', latex,
});

const PHYSICS_FORMULAS: TemplateDef[] = [
  // Mechanics
  p('newton2', 'Mechanics', "Newton's second law", '\\vec{F}=m\\vec{a}', 'Force equals mass times acceleration.', 'force'),
  p('suvat', 'Mechanics', 'Equations of motion', '\\begin{aligned} v&=u+at \\\\ s&=ut+\\frac{1}{2}at^{2} \\\\ v^{2}&=u^{2}+2as \\end{aligned}', 'Constant acceleration (SUVAT).', 'kinematics suvat'),
  p('momentum', 'Mechanics', 'Momentum and impulse', '\\vec{p}=m\\vec{v},\\qquad \\vec{J}=\\vec{F}\\,\\Delta t=\\Delta\\vec{p}', 'Linear momentum and impulse.', ''),
  p('ke-pe', 'Mechanics', 'Kinetic and potential energy', 'E_{k}=\\frac{1}{2}mv^{2},\\qquad E_{p}=mgh', 'Energy of motion and height.', 'energy'),
  p('work', 'Mechanics', 'Work and power', 'W=Fd\\cos\\theta,\\qquad P=\\frac{W}{t}', 'Work done by a force, rate of doing work.', ''),
  p('gravitation', 'Mechanics', 'Universal gravitation', 'F=G\\frac{m_{1}m_{2}}{r^{2}}', "Newton's law of gravitation.", 'gravity'),
  p('centripetal', 'Mechanics', 'Centripetal force', 'F=\\frac{mv^{2}}{r}=m\\omega^{2}r', 'Circular motion.', 'circular'),
  p('torque', 'Mechanics', 'Torque', '\\vec{\\tau}=\\vec{r}\\times\\vec{F},\\qquad \\tau=rF\\sin\\theta', 'Turning effect of a force.', 'moment'),
  p('hooke', 'Mechanics', "Hooke's law", 'F=-kx', 'Restoring force of a spring.', 'spring'),
  p('pendulum-period', 'Mechanics', 'Pendulum period', 'T=2\\pi\\sqrt{\\frac{L}{g}}', 'Small-angle simple pendulum.', 'shm oscillation'),
  p('spring-period', 'Mechanics', 'Mass–spring period', 'T=2\\pi\\sqrt{\\frac{m}{k}}', 'Simple harmonic oscillator.', 'shm oscillation'),
  p('shm', 'Mechanics', 'Simple harmonic motion', 'x(t)=A\\cos(\\omega t+\\varphi)', 'Displacement of an oscillator.', 'oscillation'),
  p('friction', 'Mechanics', 'Friction', 'f\\leq\\mu N', 'Friction is at most μ times the normal force.', ''),
  p('pressure', 'Mechanics', 'Pressure and density', 'P=\\frac{F}{A},\\qquad \\rho=\\frac{m}{V},\\qquad P=\\rho gh', 'Pressure, density, hydrostatic pressure.', 'fluid'),
  // Electricity & magnetism
  p('ohm', 'Electricity & magnetism', "Ohm's law", 'V=IR', 'Voltage, current and resistance.', 'resistance current voltage'),
  p('power-elec', 'Electricity & magnetism', 'Electrical power', 'P=VI=I^{2}R=\\frac{V^{2}}{R}', 'Power in a resistor.', ''),
  p('series-parallel', 'Electricity & magnetism', 'Resistors in series and parallel', 'R_{s}=R_{1}+R_{2}+\\cdots,\\qquad \\frac{1}{R_{p}}=\\frac{1}{R_{1}}+\\frac{1}{R_{2}}+\\cdots', 'Equivalent resistance.', 'combination'),
  p('coulomb', 'Electricity & magnetism', "Coulomb's law", 'F=\\frac{1}{4\\pi\\varepsilon_{0}}\\frac{q_{1}q_{2}}{r^{2}}', 'Force between two charges.', 'electrostatics'),
  p('efield', 'Electricity & magnetism', 'Electric field', '\\vec{E}=\\frac{\\vec{F}}{q},\\qquad V=\\frac{W}{q}', 'Field strength and potential.', ''),
  p('capacitor', 'Electricity & magnetism', 'Capacitance', 'Q=CV,\\qquad E=\\frac{1}{2}CV^{2}', 'Charge and stored energy.', ''),
  p('rc-charging', 'Electricity & magnetism', 'RC charging', 'V_{C}(t)=V_{0}\\left(1-e^{-t/RC}\\right),\\qquad \\tau=RC', 'Capacitor charging through a resistor.', 'time constant'),
  p('lorentz', 'Electricity & magnetism', 'Lorentz force', '\\vec{F}=q\\left(\\vec{E}+\\vec{v}\\times\\vec{B}\\right)', 'Force on a moving charge.', 'magnetic'),
  p('wire-force', 'Electricity & magnetism', 'Force on a current', 'F=BIL\\sin\\theta', 'Force on a conductor in a field.', 'magnetic motor'),
  p('faraday', 'Electricity & magnetism', "Faraday's law", '\\mathcal{E}=-N\\frac{\\mathrm{d}\\Phi_{B}}{\\mathrm{d}t}', 'Induced EMF.', 'induction emf'),
  p('maxwell', 'Electricity & magnetism', "Maxwell's equations", '\\begin{aligned} \\nabla\\cdot\\vec{E}&=\\frac{\\rho}{\\varepsilon_{0}} \\\\ \\nabla\\cdot\\vec{B}&=0 \\\\ \\nabla\\times\\vec{E}&=-\\frac{\\partial\\vec{B}}{\\partial t} \\\\ \\nabla\\times\\vec{B}&=\\mu_{0}\\vec{J}+\\mu_{0}\\varepsilon_{0}\\frac{\\partial\\vec{E}}{\\partial t} \\end{aligned}', 'The four laws of electromagnetism.', 'electromagnetism'),
  // Waves & optics
  p('wave-speed', 'Waves & optics', 'Wave equation (speed)', 'v=f\\lambda', 'Speed, frequency and wavelength.', 'frequency wavelength'),
  p('wave-pde', 'Waves & optics', 'Wave equation', '\\frac{\\partial^{2}y}{\\partial t^{2}}=v^{2}\\frac{\\partial^{2}y}{\\partial x^{2}}', 'One-dimensional wave PDE.', 'pde'),
  p('snell', 'Waves & optics', "Snell's law", 'n_{1}\\sin\\theta_{1}=n_{2}\\sin\\theta_{2}', 'Refraction at a boundary.', 'refraction'),
  p('lens-equation', 'Waves & optics', 'Thin lens equation', '\\frac{1}{f}=\\frac{1}{v}-\\frac{1}{u},\\qquad m=\\frac{v}{u}', 'Focal length, distances and magnification.', 'mirror magnification'),
  p('doppler', 'Waves & optics', 'Doppler effect', "f'=f\\,\\frac{v\\pm v_{o}}{v\\mp v_{s}}", 'Frequency shift from motion.', 'sound'),
  p('double-slit', 'Waves & optics', 'Double-slit fringes', 'd\\sin\\theta=m\\lambda,\\qquad \\Delta y=\\frac{\\lambda D}{d}', 'Interference maxima and fringe spacing.', 'young interference'),
  // Thermodynamics
  p('ideal-gas', 'Thermodynamics', 'Ideal gas law', 'PV=nRT', 'Pressure, volume and temperature of a gas.', 'gas'),
  p('first-law', 'Thermodynamics', 'First law', '\\Delta U=Q-W', 'Energy conservation for heat and work.', 'internal energy'),
  p('heat', 'Thermodynamics', 'Specific heat', 'Q=mc\\,\\Delta T', 'Heat to change temperature.', 'calorimetry'),
  p('carnot', 'Thermodynamics', 'Carnot efficiency', '\\eta=1-\\frac{T_{C}}{T_{H}}', 'Maximum heat-engine efficiency.', 'engine'),
  p('entropy', 'Thermodynamics', 'Entropy', '\\mathrm{d}S=\\frac{\\delta Q_{\\text{rev}}}{T}', 'Change in entropy.', 'second law'),
  p('stefan', 'Thermodynamics', 'Stefan–Boltzmann law', 'P=\\varepsilon\\sigma AT^{4}', 'Power radiated by a body.', 'radiation'),
  // Modern physics
  p('emc2', 'Modern physics', 'Mass–energy', 'E=mc^{2}', "Einstein's mass–energy equivalence.", 'relativity einstein'),
  p('photon', 'Modern physics', 'Photon energy', 'E=hf=\\frac{hc}{\\lambda}', 'Energy of a quantum of light.', 'planck'),
  p('photoelectric', 'Modern physics', 'Photoelectric effect', 'hf=\\phi+E_{k,\\max}', "Einstein's photoelectric equation.", 'work function'),
  p('debroglie', 'Modern physics', 'de Broglie wavelength', '\\lambda=\\frac{h}{p}=\\frac{h}{mv}', 'Wavelength of a particle.', 'matter wave'),
  p('schrodinger', 'Modern physics', 'Schrödinger equation', 'i\\hbar\\frac{\\partial}{\\partial t}\\Psi=-\\frac{\\hbar^{2}}{2m}\\nabla^{2}\\Psi+V\\Psi', 'Time-dependent, one particle.', 'quantum'),
  p('heisenberg', 'Modern physics', 'Uncertainty principle', '\\Delta x\\,\\Delta p\\geq\\frac{\\hbar}{2}', "Heisenberg's limit.", 'quantum'),
  p('lorentz-factor', 'Modern physics', 'Lorentz factor', '\\gamma=\\frac{1}{\\sqrt{1-v^{2}/c^{2}}},\\qquad \\Delta t=\\gamma\\,\\Delta t_{0}', 'Time dilation in special relativity.', 'relativity'),
  p('decay', 'Modern physics', 'Radioactive decay', 'N(t)=N_{0}e^{-\\lambda t},\\qquad t_{1/2}=\\frac{\\ln 2}{\\lambda}', 'Exponential decay and half-life.', 'half life nuclear'),
];

const PHYSICS_DIAGRAMS: TemplateDef[] = [
  {
    id: 'phys-series-circuit', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'Series circuit', description: 'Battery, switch, resistor and lamp in one loop.',
    keywords: 'loop simple circuit series battery lamp switch',
    build: (ctx) => {
      const b = new Builder(ctx);
      const bat = b.part('circuit.battery', -40, 100, { label: 'E' }, { rotation: 90 });
      const sw = b.part('circuit.switch-closed', 80, 0, { label: 'S' });
      const r = b.part('circuit.resistor', 240, 0, { label: 'R', value: '100\\,\\Omega' });
      const lamp = b.part('circuit.lamp', 360, 100, { label: 'L' }, { rotation: 90 });
      b.wire(bat, 'w', sw, 'w');
      b.wire(sw, 'e', r, 'w');
      b.wire(r, 'e', lamp, 'w');
      b.wire(lamp, 'e', bat, 'e');
      return b.done();
    },
  },
  {
    id: 'phys-parallel', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'Parallel resistors', description: 'Two resistors sharing the same source.',
    keywords: 'parallel branch resistors circuit',
    build: (ctx) => {
      const b = new Builder(ctx);
      const v = b.part('circuit.dc-source', -60, 100, { label: 'V' }, { rotation: 90 });
      const j1 = b.part('circuit.junction', 120, 0, {});
      const j2 = b.part('circuit.junction', 120, 200, {});
      const r1 = b.part('circuit.resistor', 120, 100, { label: 'R_{1}' }, { rotation: 90 });
      const r2 = b.part('circuit.resistor', 280, 100, { label: 'R_{2}' }, { rotation: 90 });
      b.wire(v, 'w', j1, 'w');
      b.wire(j1, 's', r1, 'w');
      b.wire(j1, 'e', r2, 'w');
      b.wire(r1, 'e', j2, 'n');
      b.wire(r2, 'e', j2, 'e');
      b.wire(j2, 'w', v, 'e');
      return b.done();
    },
  },
  {
    id: 'phys-rc', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'RC circuit', description: 'A source charging a capacitor through a resistor.',
    keywords: 'rc capacitor resistor charging time constant filter',
    build: (ctx) => {
      const b = new Builder(ctx);
      const v = b.part('circuit.dc-source', -50, 80, { label: 'V_{s}' }, { rotation: 90 });
      const r = b.part('circuit.resistor', 90, 0, { label: 'R', current: 'i', currentDir: 'forward' });
      const c = b.part('circuit.capacitor', 230, 80, { label: 'C', voltage: 'v_{C}' }, { rotation: 90 });
      const g = b.part('circuit.ground', 230, 200, {});
      b.wire(v, 'w', r, 'w');
      b.wire(r, 'e', c, 'w');
      b.wire(c, 'e', g, 'n');
      b.wire(v, 'e', g, 'n');
      return b.done();
    },
  },
  {
    id: 'phys-divider', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'Voltage divider', description: 'Two resistors splitting a voltage; output across R₂.',
    keywords: 'potential divider resistor output vout',
    build: (ctx) => {
      const b = new Builder(ctx);
      const v = b.part('circuit.dc-source', -60, 120, { label: 'V_{in}' }, { rotation: 90 });
      const r1 = b.part('circuit.resistor', 120, 60, { label: 'R_{1}' }, { rotation: 90 });
      const r2 = b.part('circuit.resistor', 120, 180, { label: 'R_{2}' }, { rotation: 90 });
      const mid = b.part('circuit.junction', 120, 120, {});
      const out = b.part('circuit.terminal', 240, 120, {});
      const g = b.part('circuit.ground', 120, 270, {});
      b.wire(v, 'w', r1, 'w');
      b.wire(r1, 'e', mid, 'n');
      b.wire(mid, 's', r2, 'w');
      b.wire(mid, 'e', out, 'w');
      b.wire(r2, 'e', g, 'n');
      b.wire(v, 'e', g, 'n');
      b.formula(390, 120, 'V_{out}=V_{in}\\frac{R_{2}}{R_{1}+R_{2}}', 16);
      return b.done();
    },
  },
  {
    id: 'phys-led', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'LED with resistor', description: 'An LED protected by a current-limiting resistor.',
    keywords: 'led diode resistor current limiting',
    build: (ctx) => {
      const b = new Builder(ctx);
      const v = b.part('circuit.dc-source', -50, 80, { label: '5\\,\\mathrm{V}' }, { rotation: 90 });
      const r = b.part('circuit.resistor', 90, 0, { label: 'R', value: '220\\,\\Omega' });
      const d = b.part('circuit.led', 230, 80, { label: 'D' }, { rotation: 90 });
      b.wire(v, 'w', r, 'w');
      b.wire(r, 'e', d, 'w');
      b.wire(d, 'e', v, 'e');
      return b.done();
    },
  },
  {
    id: 'phys-meters', category: 'physics', group: 'Circuits', kind: 'diagram',
    name: 'Measuring V and I', description: 'Ammeter in series and voltmeter in parallel with a resistor.',
    keywords: 'ammeter voltmeter measure current voltage meter',
    build: (ctx) => {
      const b = new Builder(ctx);
      const v = b.part('circuit.battery', -60, 110, { label: 'E' }, { rotation: 90 });
      const a = b.part('circuit.ammeter', 90, 0, {});
      const j1 = b.part('circuit.junction', 220, 0, {});
      const j2 = b.part('circuit.junction', 220, 220, {});
      const r = b.part('circuit.resistor', 220, 110, { label: 'R' }, { rotation: 90 });
      const vm = b.part('circuit.voltmeter', 360, 110, {}, { rotation: 90 });
      b.wire(v, 'w', a, 'w');
      b.wire(a, 'e', j1, 'w');
      b.wire(j1, 's', r, 'w');
      b.wire(j1, 'e', vm, 'w');
      b.wire(r, 'e', j2, 'n');
      b.wire(vm, 'e', j2, 'e');
      b.wire(j2, 'w', v, 'e');
      return b.done();
    },
  },
  {
    id: 'phys-free-body', category: 'physics', group: 'Mechanics diagrams', kind: 'diagram',
    name: 'Free-body diagram', description: 'A block on a surface with weight, normal, push and friction.',
    keywords: 'free body forces block weight normal friction fbd',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.surface', 0, 60, null, { w: 300 });
      b.part('physics.block', 0, 20, null);
      const red = { stroke: '#dc2626' };
      const blue = { stroke: '#2563eb' };
      const up = b.part('physics.force', 0, -65, null, { rotation: -90 });
      up.style = { ...up.style, ...blue };
      const down = b.part('physics.force', 0, 105, null, { rotation: 90 });
      down.style = { ...down.style, ...red };
      const push = b.part('physics.force', 95, 20, null);
      push.style = { ...push.style, ...blue };
      const fr = b.part('physics.force', -95, 20, null, { rotation: 180 });
      fr.style = { ...fr.style, ...red };
      b.formula(30, -110, '\\vec{N}', 18);
      b.formula(35, 150, 'm\\vec{g}', 18);
      b.formula(160, -2, '\\vec{F}', 18);
      b.formula(-160, -2, '\\vec{f}', 18);
      return b.done();
    },
  },
  {
    id: 'phys-incline', category: 'physics', group: 'Mechanics diagrams', kind: 'diagram',
    name: 'Block on an incline', description: 'A mass on a ramp with its weight and the components.',
    keywords: 'inclined plane ramp slope block gravity component',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.incline', 0, 0, null, { w: 240, h: 120 });
      // The slope rises 120 over 240: 26.57 degrees. The block sits on it.
      b.part('physics.block', 1, -23, null, { w: 56, h: 40, rotation: -26.57 });
      const w = b.part('physics.force', 1, 22, null, { rotation: 90, w: 90 });
      w.style = { ...w.style, stroke: '#dc2626' };
      const n = b.part('physics.force', -19, -63, null, { rotation: -116.57, w: 70 });
      n.style = { ...n.style, stroke: '#2563eb' };
      b.formula(28, 62, 'm\\vec{g}', 16);
      b.formula(-48, -98, '\\vec{N}', 16);
      b.formula(-84, 46, '\\theta', 16);
      return b.done();
    },
  },
  {
    id: 'phys-spring-mass', category: 'physics', group: 'Mechanics diagrams', kind: 'diagram',
    name: 'Mass on a spring', description: 'A wall, a spring and a block on a smooth floor.',
    keywords: 'spring mass oscillator shm hooke wall',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.surface', -10, -5, null, { w: 110, h: 20, rotation: -90 });
      b.part('physics.surface', 110, 60, null, { w: 260 });
      b.part('physics.spring', 75, 25, null, { w: 150 });
      const blk = b.part('physics.block', 185, 25, null, { w: 70, h: 50 });
      blk.text = 'm';
      b.formula(75, -10, 'k', 16);
      return b.done();
    },
  },
  {
    id: 'phys-pendulum', category: 'physics', group: 'Mechanics diagrams', kind: 'diagram',
    name: 'Simple pendulum', description: 'A bob on a string with its length and period.',
    keywords: 'pendulum bob string swing period',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.pendulum', 0, 0, null);
      b.formula(110, 0, 'T=2\\pi\\sqrt{\\frac{L}{g}}', 16);
      return b.done();
    },
  },
  {
    id: 'phys-lens', category: 'physics', group: 'Optics diagrams', kind: 'diagram',
    name: 'Convex lens', description: 'A converging lens on the principal axis with its focal points.',
    keywords: 'lens optics focal ray converging',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.lens-convex', 0, 0, null);
      const axis = b.part('physics.ray', 0, 0, null, { w: 360 });
      axis.style = { ...axis.style, strokeStyle: 'dashed', stroke: '#64748b' };
      axis.flipH = undefined;
      // A ray parallel to the axis bends through the far focal point.
      b.part('physics.ray', -100, -45, null, { w: 200 });
      b.part('physics.ray', 75, -7.5, null, { w: 168, rotation: 26.57 });
      b.formula(-90, 22, 'F', 16);
      b.formula(90, 22, "F'", 16);
      return b.done();
    },
  },
  {
    id: 'phys-charges', category: 'physics', group: 'Fields', kind: 'diagram',
    name: 'Two point charges', description: 'A positive and a negative charge with the force between them.',
    keywords: 'coulomb charges electric dipole force',
    build: (ctx) => {
      const b = new Builder(ctx);
      b.part('physics.charge-plus', 0, 0, null);
      b.part('physics.charge-minus', 240, 0, null);
      const f1 = b.part('physics.force', 75, 0, null, { w: 80 });
      f1.style = { ...f1.style, stroke: '#2563eb' };
      const f2 = b.part('physics.force', 165, 0, null, { w: 80, rotation: 180 });
      f2.style = { ...f2.style, stroke: '#2563eb' };
      b.formula(120, -45, 'F=k\\frac{q_{1}q_{2}}{r^{2}}', 16);
      return b.done();
    },
  },
];

/* ================================================================ chemistry */

const r = (id: string, group: string, name: string, source: string, description: string, keywords = ''): TemplateDef => ({
  id: `chem-${id}`, category: 'chem', group, name, description, keywords, kind: 'chem', source,
});
const cf = (id: string, name: string, latex: string, description: string, keywords = ''): TemplateDef => ({
  id: `chem-${id}`, category: 'chem', group: 'Chemistry formulas', name, description, keywords, kind: 'math', latex,
});
const mol = (id: string, description: string): TemplateDef => {
  const t = MOLECULE_TEMPLATES.find((x) => x.id === id);
  return {
    id: `chem-mol-${id}`, category: 'chem', group: 'Molecules', name: t?.name ?? id, description, keywords: t?.keywords ?? '', kind: 'molecule', molecule: id,
  };
};

const CHEMISTRY: TemplateDef[] = [
  r('water', 'Common reactions', 'Formation of water', '2H2 + O2 -> 2H2O', 'Hydrogen burns in oxygen.', 'synthesis combination'),
  r('photosynthesis', 'Common reactions', 'Photosynthesis', '6CO2 + 6H2O ->[light][chlorophyll] C6H12O6 + 6O2', 'Plants make glucose from CO₂ and water.', 'biology glucose plants'),
  r('respiration', 'Common reactions', 'Respiration', 'C6H12O6 + 6O2 -> 6CO2 + 6H2O', 'Cells release energy from glucose.', 'biology glucose aerobic'),
  r('methane', 'Common reactions', 'Combustion of methane', 'CH4 + 2O2 -> CO2 + 2H2O', 'Natural gas burning.', 'burning fuel'),
  r('ethanol-burn', 'Common reactions', 'Combustion of ethanol', 'C2H5OH + 3O2 -> 2CO2 + 3H2O', 'Alcohol burning.', 'burning fuel'),
  r('neutral', 'Acids & bases', 'Neutralisation', 'HCl + NaOH -> NaCl + H2O', 'Acid + base gives salt + water.', 'acid base salt'),
  r('metal-acid', 'Acids & bases', 'Metal and acid', 'Zn + 2HCl -> ZnCl2 + H2 ^', 'A metal releases hydrogen from an acid.', 'hydrogen gas'),
  r('carbonate-acid', 'Acids & bases', 'Carbonate and acid', 'CaCO3 + 2HCl -> CaCl2 + H2O + CO2 ^', 'Fizzing of limestone in acid.', 'carbon dioxide'),
  r('water-ion', 'Acids & bases', 'Self-ionisation of water', 'H2O <=> H+ + OH-', 'Water in equilibrium with its ions.', 'equilibrium kw'),
  r('acetic', 'Acids & bases', 'Weak acid dissociation', 'CH3COOH <=> CH3COO- + H+', 'Acetic acid partly ionises.', 'equilibrium ka'),
  r('haber', 'Industrial processes', 'Haber process', 'N2 + 3H2 <=>[Fe][450 °C] 2NH3', 'Making ammonia from nitrogen and hydrogen.', 'ammonia equilibrium catalyst'),
  r('contact', 'Industrial processes', 'Contact process', '2SO2 + O2 <=>[V2O5] 2SO3', 'Step in making sulfuric acid.', 'sulfuric acid catalyst'),
  r('limestone', 'Industrial processes', 'Thermal decomposition', 'CaCO3 ->[$\\Delta$] CaO + CO2 ^', 'Heating limestone gives lime.', 'heat decomposition'),
  r('electrolysis', 'Industrial processes', 'Electrolysis of water', '2H2O ->[electrolysis] 2H2 ^ + O2 ^', 'Splitting water with electricity.', 'electrochemistry'),
  r('rusting', 'Redox', 'Rusting of iron', '4Fe + 3O2 + 6H2O -> 4Fe(OH)3', 'Iron corroding in moist air.', 'corrosion oxidation'),
  r('copper-half', 'Redox', 'Reduction half-equation', 'Cu^2+ + 2e- -> Cu', 'Copper ions gain electrons.', 'electrode reduction'),
  r('displacement', 'Redox', 'Displacement', 'Zn + CuSO4 -> ZnSO4 + Cu', 'A more reactive metal displaces a less reactive one.', 'reactivity series'),
  r('precipitate', 'Redox', 'Precipitation', 'AgNO3(aq) + NaCl(aq) -> AgCl v + NaNO3(aq)', 'An insoluble solid forms.', 'precipitate silver chloride'),
  r('ester', 'Organic', 'Esterification', 'CH3COOH + C2H5OH <=>[H2SO4] CH3COOC2H5 + H2O', 'Acid + alcohol gives an ester.', 'ester organic'),
  r('fermentation', 'Organic', 'Fermentation', 'C6H12O6 ->[yeast] 2C2H5OH + 2CO2', 'Yeast turns sugar into ethanol.', 'ethanol yeast'),
  r('alpha', 'Nuclear', 'Alpha decay', '^{238}_{92}U -> ^{234}_{90}Th + ^{4}_{2}He', 'A nucleus emits an alpha particle.', 'radioactive uranium'),
  r('beta', 'Nuclear', 'Beta decay', '^{14}_{6}C -> ^{14}_{7}N + ^{0}_{-1}e', 'Carbon-14 decays to nitrogen.', 'radioactive carbon dating'),
  cf('ph', 'pH', '\\mathrm{pH}=-\\log_{10}[\\mathrm{H^{+}}]', 'Acidity from hydrogen-ion concentration.', 'acid'),
  cf('moles', 'Amount of substance', 'n=\\frac{m}{M},\\qquad c=\\frac{n}{V}', 'Moles from mass; concentration.', 'mole molar mass molarity'),
  cf('dilution', 'Dilution', 'C_{1}V_{1}=C_{2}V_{2}', 'Concentration before and after diluting.', 'concentration'),
  cf('kc', 'Equilibrium constant', 'K_{c}=\\frac{[\\mathrm{C}]^{c}[\\mathrm{D}]^{d}}{[\\mathrm{A}]^{a}[\\mathrm{B}]^{b}}', 'For aA + bB ⇌ cC + dD.', 'equilibrium'),
  cf('rate', 'Rate law', '\\text{rate}=k[\\mathrm{A}]^{m}[\\mathrm{B}]^{n}', 'Reaction rate and orders.', 'kinetics'),
  cf('arrhenius', 'Arrhenius equation', 'k=Ae^{-E_{a}/RT}', 'Temperature dependence of rate.', 'kinetics activation energy'),
  cf('gibbs', 'Gibbs free energy', '\\Delta G=\\Delta H-T\\Delta S', 'Spontaneity of a reaction.', 'thermodynamics'),
  cf('nernst', 'Nernst equation', 'E=E^{\\circ}-\\frac{RT}{nF}\\ln Q', 'Cell potential away from standard conditions.', 'electrochemistry'),
  cf('henderson', 'Henderson–Hasselbalch', '\\mathrm{pH}=\\mathrm{p}K_{a}+\\log_{10}\\frac{[\\mathrm{A^{-}}]}{[\\mathrm{HA}]}', 'pH of a buffer.', 'buffer'),
  cf('beer', 'Beer–Lambert law', 'A=\\varepsilon lc', 'Absorbance and concentration.', 'spectroscopy'),
  cf('half-life', 'First-order half-life', 't_{1/2}=\\frac{\\ln 2}{k}', 'Half-life of a first-order reaction.', 'kinetics'),
  mol('water', 'H₂O: a bent molecule with two O–H bonds.'),
  mol('carbon-dioxide', 'CO₂: linear, with two C=O double bonds.'),
  mol('ammonia', 'NH₃: nitrogen bonded to three hydrogens.'),
  mol('methane', 'CH₄: the simplest alkane.'),
  mol('ethene', 'C₂H₄: an alkene with a C=C double bond.'),
  mol('ethyne', 'C₂H₂: an alkyne with a C≡C triple bond.'),
  mol('ethanol', 'C₂H₅OH: the everyday alcohol.'),
  mol('acetic-acid', 'CH₃COOH: the acid in vinegar.'),
  mol('benzene', 'C₆H₆ drawn as a Kekulé ring.'),
  mol('benzene-circle', 'Benzene with a delocalised ring.'),
  mol('cyclohexane', 'C₆H₁₂: a six-membered saturated ring.'),
];

export const TEMPLATES: TemplateDef[] = [...FLOW, ...MATH, ...PHYSICS_FORMULAS, ...PHYSICS_DIAGRAMS, ...CHEMISTRY];

export const TEMPLATE_BY_ID: Record<string, TemplateDef> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** Templates of one category, grouped in order of first appearance. */
export function groupedTemplates(category: TemplateCategory, query = ''): { group: string; items: TemplateDef[] }[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (t: TemplateDef) => {
    if (words.length === 0) return true;
    const hay = `${t.name} ${t.description} ${t.group} ${t.keywords ?? ''} ${'latex' in t ? t.latex : ''} ${'source' in t ? t.source : ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const out = new Map<string, TemplateDef[]>();
  for (const t of TEMPLATES) {
    if (t.category !== category || !hit(t)) continue;
    out.set(t.group, [...(out.get(t.group) ?? []), t]);
  }
  return [...out.entries()].map(([group, items]) => ({ group, items }));
}

/** Search every category at once. */
export function searchTemplates(query: string): TemplateDef[] {
  return TEMPLATE_CATEGORIES.flatMap((c) => groupedTemplates(c.id, query).flatMap((g) => g.items));
}

/**
 * The objects a template stands for, in its own coordinates. `measure` sizes
 * typeset content; without it a rough estimate is used.
 */
export function buildTemplate(t: TemplateDef, measure: Measure = () => null, chemTex: (s: string) => string = (s) => `\\ce{${s}}`): Fragment {
  const ctx: BuildCtx = { measure };
  switch (t.kind) {
    case 'diagram':
      return t.build(ctx);
    case 'math': {
      const b = new Builder(ctx);
      b.formula(0, 0, t.latex, DEFAULT_FORMULA_FONT, t.display ?? true);
      return b.done();
    }
    case 'chem': {
      const nat = measure(chemTex(t.source), true) ?? estimateNatural(t.source);
      const size = sizeForFont(nat, DEFAULT_FORMULA_FONT);
      const n = makeNode('chem', 0, 0, { id: 't1', w: size.w, h: size.h, science: { type: 'chem', source: t.source, natural: nat } });
      n.x = Math.round(-size.w / 2);
      n.y = Math.round(-size.h / 2);
      n.style = { ...n.style, strokeStyle: 'none', fillOpacity: 0, strokeWidth: 1.2 };
      return { nodes: [n], edges: [] };
    }
    case 'molecule': {
      const def = MOLECULE_TEMPLATES.find((x) => x.id === t.molecule);
      if (!def) return { nodes: [], edges: [] };
      const spec = fromBlueprint(def.blueprint);
      const nat = moleculeNaturalSize(spec);
      const n = makeNode('molecule', 0, 0, { id: 't1', w: nat.w, h: nat.h, science: spec });
      n.x = Math.round(-nat.w / 2);
      n.y = Math.round(-nat.h / 2);
      n.style = { ...n.style, strokeStyle: 'solid', fillOpacity: 0, strokeWidth: 1.2 };
      return { nodes: [n], edges: [] };
    }
  }
}
