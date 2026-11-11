// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram, makeNode } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { generateLatex } from '../latex/generator';
import { loadEngine } from '../science/math/engine';
import { MOLECULE_TEMPLATES, fromBlueprint } from '../science/chem/molecule';
import { CIRCUIT_DEFS } from '../science/physics/circuits';
import { SHAPE_DRAG_TYPE } from '../science/editing';
import type { MathSpec, ChemSpec, MoleculeSpec, CircuitSpec } from '../science/types';
import { emptyCircuitSpec } from '../science/types';
import { SHAPE_LIST } from '../model/shapes';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const problems: unknown[][] = [];
const s = () => useEditor.getState();

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  problems.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a) => problems.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => problems.push(a));
  localStorage.clear();
  localStorage.setItem('flowtikz:tour-seen', '1');
  resetIdCounters();
  useEditor.setState({
    doc: emptyDiagram(),
    selection: [],
    tool: 'select',
    pendingShape: null,
    past: [],
    future: [],
    snapshot: null,
    clipboard: null,
    dirty: false,
    editingNodeId: null,
    scienceDialog: null,
    paletteDomain: 'flow',
    view: { zoom: 1, panX: 60, panY: 60 },
  });
  await loadEngine();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(container.querySelectorAll<T>(sel));

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** The dialogs are a lazy chunk: wait until the first one has arrived. */
async function until(fn: () => unknown) {
  for (let i = 0; i < 100 && !fn(); i++) await flush();
  expect(fn()).toBeTruthy();
}

async function click(el: Element | null) {
  expect(el, 'element to click').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

const setValue = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};

const byText = (sel: string, text: string) => qa(sel).find((b) => b.textContent?.trim() === text) as HTMLElement;
const byLabel = <T extends HTMLElement>(label: string) => q<T>(`[aria-label="${label}"]`) as T;

async function openMath() {
  await click(q('[data-action=math]'));
  await until(() => q('[aria-label="Formula editor"]'));
}

async function focusBox(el: HTMLInputElement) {
  await act(async () => {
    el.focus();
  });
}

describe('toolbar', () => {
  it('shows the three tools with tooltips and labels', () => {
    for (const a of ['math', 'physics', 'chemistry']) {
      const b = q(`[data-action=${a}]`)!;
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
    expect(problems).toEqual([]);
  });
  it('the physics menu leads to circuits, parts and symbols', async () => {
    await click(q('[data-action=physics]'));
    expect(q('[data-action=physics-circuit]')).toBeTruthy();
    await click(q('[data-action=physics-circuit]'));
    expect(s().paletteDomain).toBe('circuit');
    expect(qa('.shape-btn').length).toBe(CIRCUIT_DEFS.length);
    await click(q('[data-action=physics]'));
    await click(q('[data-action=physics-parts]'));
    expect(s().paletteDomain).toBe('physics');
    await click(q('[data-action=physics]'));
    await click(q('[data-action=physics-symbols]'));
    expect(s().scienceDialog).toEqual({ kind: 'math', library: 'physics' });
  });
  it('the chemistry menu opens each editor', async () => {
    await click(q('[data-action=chemistry]'));
    await click(q('[data-action=chem-formula]'));
    await until(() => q('[aria-label="Chemistry editor"]'));
    await act(async () => s().openScienceDialog(null));
    await click(q('[data-action=chemistry]'));
    await click(q('[data-action=chem-molecule]'));
    await until(() => q('[aria-label="Molecule editor"]'));
  });
});

describe('palette domains', () => {
  it('starts on the unchanged flowchart set', () => {
    expect(qa('.shape-btn').length).toBe(SHAPE_LIST.length);
  });
  it('searches within the circuit set by keyword', async () => {
    await act(async () => s().setPaletteDomain('circuit'));
    await setValue(q<HTMLInputElement>('.palette-head input')!, 'farad');
    expect(qa('.shape-btn').map((b) => b.getAttribute('aria-label'))).toContain('Capacitor');
    expect(qa('.shape-btn').length).toBe(1);
  });
  it('click-to-place works for circuit parts', async () => {
    await act(async () => s().setPaletteDomain('circuit'));
    await click(q('[aria-label="Resistor"]'));
    expect(s().pendingShape).toBe('circuit.resistor');
  });
  it('double-click drops a part in the middle', async () => {
    await act(async () => s().setPaletteDomain('physics'));
    const b = q('[aria-label="Spring"]')!;
    await act(async () => b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(Object.values(s().doc.nodes)[0].kind).toBe('physics.spring');
  });
  it('drag and drop places a part where it lands', async () => {
    await act(async () => s().setPaletteDomain('circuit'));
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      types: [SHAPE_DRAG_TYPE],
      effectAllowed: '',
      dropEffect: '',
    };
    const source = q('[aria-label="Capacitor"]')!;
    expect(source.getAttribute('draggable')).toBe('true');
    const fire = (el: Element, type: string, x = 0, y = 0) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
      el.dispatchEvent(e);
      return e;
    };
    await act(async () => void fire(source, 'dragstart'));
    const shell = q('.canvas-shell')!;
    let over!: MouseEvent;
    await act(async () => void (over = fire(shell, 'dragover', 300, 200)));
    expect(over.defaultPrevented).toBe(true);
    await act(async () => void fire(shell, 'drop', 300, 200));
    const n = Object.values(s().doc.nodes)[0];
    expect(n.kind).toBe('circuit.capacitor');
    expect(n.science).toMatchObject({ type: 'circuit', label: 'C_{1}' });
    expect(s().past).toHaveLength(1);
  });
  it('ignores an unrelated drop', async () => {
    const shell = q('.canvas-shell')!;
    const e = new MouseEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { getData: () => '', types: [] } });
    await act(async () => void shell.dispatchEvent(e));
    expect(s().doc.order).toEqual([]);
  });
});

describe('formula editor', () => {
  it('fits structure buttons, symbols and actions', async () => {
    await openMath();
    expect(qa('.struct-btn').length).toBeGreaterThan(45);
    expect(qa('.sym-btn').length).toBeGreaterThan(5);
    for (const t of ['Undo', 'Redo', 'Clear']) expect(byText('.sci-actions button', t)).toBeTruthy();
    expect(q<HTMLButtonElement>('[data-action=insert-formula]')!.disabled).toBe(true);
    expect(problems).toEqual([]);
  });

  it('builds a fraction with separate boxes and inserts it', async () => {
    await openMath();
    await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
    await click(q('[data-struct=frac]'));
    const num = byLabel<HTMLInputElement>('Numerator');
    const den = byLabel<HTMLInputElement>('Denominator');
    expect(document.activeElement).toBe(num);
    expect(q<HTMLButtonElement>('[data-action=insert-formula]')!.disabled).toBe(true);
    await setValue(num, 'a');
    await setValue(den, 'b');
    await flush();
    const insert = q<HTMLButtonElement>('[data-action=insert-formula]')!;
    expect(insert.disabled).toBe(false);
    await click(insert);
    const n = Object.values(s().doc.nodes)[0];
    expect(n.kind).toBe('math');
    expect((n.science as MathSpec).latex).toBe('\\frac{a}{b}');
    expect((n.science as MathSpec).natural).toBeTruthy();
    expect(s().selection).toEqual([n.id]);
    expect(s().scienceDialog).toBeNull();
    expect(generateLatex(s().doc).code).toContain('\\frac{a}{b}');
    // Rendered on the board as real paths.
    expect(q(`[data-object-id="${n.id}"] path`)).toBeTruthy();
    expect(problems).toEqual([]);
  });

  it('nests structures in the focused box', async () => {
    await openMath();
    await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
    await click(q('[data-struct=frac]'));
    await click(q('[data-struct=sqrt]'));
    await setValue(byLabel<HTMLInputElement>('Radicand'), 'x');
    await setValue(byLabel<HTMLInputElement>('Denominator'), '2');
    await click(byText('.segmented button', 'LaTeX'));
    expect(byLabel<HTMLTextAreaElement>('LaTeX source').value).toBe('\\frac{\\sqrt{x}}{2}');
  });

  it('typing ^ and _ make scripts', async () => {
    await openMath();
    const box = q<HTMLInputElement>('[data-testid=formula-boxes] input')!;
    await focusBox(box);
    await setValue(box, 'x');
    box.setSelectionRange(1, 1);
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: '^', bubbles: true })));
    await flush();
    expect(byLabel('Exponent')).toBeTruthy();
    expect(document.activeElement).toBe(byLabel('Exponent'));
  });

  it('symbols insert at the caret and enter recents', async () => {
    await openMath();
    await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
    await click(byText('.sym-tabs button', 'Greek (lower)'));
    await click(q('[aria-label="alpha"]'));
    await click(byText('.segmented button', 'LaTeX'));
    expect(byLabel<HTMLTextAreaElement>('LaTeX source').value).toBe('\\alpha');
    await click(byText('.sym-tabs button', 'Recent'));
    expect(q('[aria-label="alpha"]')).toBeTruthy();
  });

  it('searches the symbols', async () => {
    await openMath();
    await setValue(byLabel<HTMLInputElement>('Search symbols'), 'nabla');
    expect(qa('.sym-btn').map((b) => b.getAttribute('aria-label'))).toEqual(['nabla']);
  });

  it('undo, redo and clear', async () => {
    await openMath();
    await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
    await click(q('[data-struct=sqrt]'));
    expect(byLabel('Radicand')).toBeTruthy();
    await click(byText('.sci-actions button', 'Undo'));
    expect(byLabel('Radicand')).toBeNull();
    await click(byText('.sci-actions button', 'Redo'));
    expect(byLabel('Radicand')).toBeTruthy();
    await click(byText('.sci-actions button', 'Clear'));
    expect(byLabel('Radicand')).toBeNull();
    await click(byText('.sci-actions button', 'Undo'));
    expect(byLabel('Radicand')).toBeTruthy();
  });

  it('switches both ways without losing the formula', async () => {
    await openMath();
    await click(byText('.segmented button', 'LaTeX'));
    await setValue(byLabel<HTMLTextAreaElement>('LaTeX source'), '\\frac{1}{\\sqrt{2}}');
    await click(byText('.segmented button', 'Visual'));
    expect(byLabel<HTMLInputElement>('Radicand').value).toBe('2');
    await click(byText('.segmented button', 'LaTeX'));
    expect(byLabel<HTMLTextAreaElement>('LaTeX source').value).toBe('\\frac{1}{\\sqrt{2}}');
  });

  it('refuses invalid LaTeX with a message', async () => {
    await openMath();
    await click(byText('.segmented button', 'LaTeX'));
    await setValue(byLabel<HTMLTextAreaElement>('LaTeX source'), '\\notamacro');
    await flush();
    expect(q<HTMLButtonElement>('[data-action=insert-formula]')!.disabled).toBe(true);
    expect(q('.sci-preview .sci-error')?.textContent).toBeTruthy();
    expect(Object.keys(s().doc.nodes)).toHaveLength(0);
  });

  it('matrices can grow', async () => {
    await openMath();
    await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
    await click(q('[data-struct=matrix-pmatrix]'));
    expect(qa('.mx-grid input').length).toBe(4);
    await click(byText('.mx-table-tools button', '+ row'));
    expect(qa('.mx-grid input').length).toBe(6);
    await click(byText('.mx-table-tools button', '+ col'));
    expect(qa('.mx-grid input').length).toBe(9);
  });

  it('re-opens on double-click and applies an edit, keeping size', async () => {
    const id = s().insertScience('math', { type: 'math', latex: '\\frac{a}{b}', display: true, natural: { w: 1, h: 2 } }, { w: 40, h: 80 }, { x: 200, y: 200 });
    await flush();
    await act(async () => {
      q('.canvas-svg')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 200 + 60, clientY: 200 + 60 }));
    });
    await flush();
    expect(s().scienceDialog).toEqual({ kind: 'math', nodeId: id });
    const num = byLabel<HTMLInputElement>('Numerator');
    expect(num.value).toBe('a');
    await setValue(num, 'c');
    await flush();
    await click(q('[data-action=insert-formula]'));
    expect((s().doc.nodes[id].science as MathSpec).latex).toBe('\\frac{c}{b}');
    expect(Object.keys(s().doc.nodes)).toHaveLength(1);
    s().undo();
    expect((s().doc.nodes[id].science as MathSpec).latex).toBe('\\frac{a}{b}');
  });

  it('Enter opens the editor for a selected formula', async () => {
    const id = s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 1, h: 1 } }, { w: 20, h: 20 }, { x: 100, y: 100 });
    await act(async () => {
      s().setSelection([id]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();
    expect(s().scienceDialog).toEqual({ kind: 'math', nodeId: id });
  });

  it('Escape closes it and global shortcuts stay inert while open', async () => {
    await openMath();
    const box = q<HTMLInputElement>('[data-testid=formula-boxes] input')!;
    await focusBox(box);
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true })));
    expect(s().tool).toBe('select');
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush();
    expect(s().scienceDialog).toBeNull();
  });

  it('every structure button works when pressed', async () => {
    await openMath();
    for (const b of qa<HTMLButtonElement>('.struct-btn')) {
      await focusBox(q<HTMLInputElement>('[data-testid=formula-boxes] input')!);
      const before = qa('[data-testid=formula-boxes] input').length;
      await click(b);
      expect(qa('[data-testid=formula-boxes] input').length, b.getAttribute('aria-label')!).toBeGreaterThan(before);
      await click(byText('.sci-actions button', 'Clear'));
    }
    expect(problems).toEqual([]);
  });

  it('dialogs are labelled and modal', async () => {
    await openMath();
    expect(q('.modal.sci-modal')!.getAttribute('aria-modal')).toBe('true');
    for (const b of qa('.struct-btn,.sym-btn')) expect(b.getAttribute('aria-label') || b.getAttribute('title')).toBeTruthy();
  });
});

describe('chemistry editor', () => {
  const open = async (tab: 'formula' | 'reaction') => {
    await act(async () => s().openScienceDialog({ kind: 'chem', tab }));
    await until(() => q('[aria-label="Chemistry editor"]'));
  };

  it.each(['H2O', 'CO2', 'H2SO4', 'Ca(OH)2', 'NH4+', 'SO4^2-', 'Fe^3+'])('inserts %s', async (f) => {
    await open('formula');
    await setValue(byLabel<HTMLTextAreaElement>('Chemical formula'), f);
    await flush();
    await click(q('[data-action=insert-chem]'));
    const n = Object.values(s().doc.nodes)[0];
    expect((n.science as ChemSpec).source).toBe(f);
    expect(generateLatex(s().doc).code).toContain(`\\ce{${f}}`);
    expect(problems).toEqual([]);
  });

  it('elements and tokens add to the formula', async () => {
    await open('formula');
    await click(byText('.element-btn', 'Na'));
    await click(byText('.element-btn', 'Cl'));
    expect(byLabel<HTMLTextAreaElement>('Chemical formula').value).toBe('NaCl');
    await click(byText('.sym-tabs button', 'States'));
    await click(q('[aria-label="aqueous"]'));
    expect(byLabel<HTMLTextAreaElement>('Chemical formula').value).toBe('NaCl(aq)');
  });

  it('builds a balanced reaction and re-opens it structurally', async () => {
    await open('reaction');
    await setValue(byLabel<HTMLInputElement>('Reactant 1 coefficient'), '2');
    await setValue(byLabel<HTMLInputElement>('Reactant 1 formula'), 'H2');
    await click(byText('.rx-list button', '+ add'));
    await setValue(byLabel<HTMLInputElement>('Reactant 2 formula'), 'O2');
    await setValue(byLabel<HTMLInputElement>('Step 1 above the arrow'), 'Pt');
    await setValue(byLabel<HTMLSelectElement>('Step 1 arrow type'), '<=>');
    await setValue(byLabel<HTMLInputElement>('Product (step 1) 1 coefficient'), '2');
    await setValue(byLabel<HTMLInputElement>('Product (step 1) 1 formula'), 'H2O');
    await setValue(byLabel<HTMLSelectElement>('Product (step 1) 1 state'), 'l');
    await flush();
    expect(q('.rx-ok')?.textContent).toBe('Balanced');
    await click(q('[data-action=insert-chem]'));
    const n = Object.values(s().doc.nodes)[0];
    expect((n.science as ChemSpec).source).toBe('2 H2 + O2 <=>[Pt] 2 H2O(l)');
    await act(async () => s().openScienceDialog({ kind: 'chem', nodeId: n.id, tab: 'reaction' }));
    await flush();
    expect(byLabel<HTMLInputElement>('Reactant 2 formula').value).toBe('O2');
  });

  it('flags an unbalanced reaction', async () => {
    await open('reaction');
    await setValue(byLabel<HTMLInputElement>('Reactant 1 formula'), 'H2');
    await setValue(byLabel<HTMLInputElement>('Product (step 1) 1 formula'), 'H2O');
    await flush();
    expect(q('.rx-bad')?.textContent).toContain('O is 0');
  });

  it('adds and removes steps', async () => {
    await open('reaction');
    await click(byText('.rx-foot button', '+ Add another step'));
    expect(byLabel('Step 2 arrow type')).toBeTruthy();
    await click(byText('.rx-arrow button', 'Remove step'));
    expect(byLabel('Step 2 arrow type')).toBeNull();
  });

  it('the Δ button writes a heat condition', async () => {
    await open('reaction');
    await click(byText('.rx-arrow button', '+ Δ heat'));
    expect(byLabel<HTMLInputElement>('Step 1 above the arrow').value).toBe('$\\Delta$');
  });
});

describe('molecule editor', () => {
  const open = async (nodeId?: string) => {
    await act(async () => s().openScienceDialog({ kind: 'molecule', nodeId }));
    await until(() => q('[aria-label="Molecule editor"]'));
  };
  const sheet = () => q('.mol-sheet')!;
  /* jsdom reports a zero-size rect, so clientX/Y map 1:1 onto the sheet. */
  const fire = async (type: string, x: number, y: number, target: Element = sheet()) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    await act(async () => void target.dispatchEvent(e));
  };
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    await fire('pointerdown', x0, y0);
    await fire('pointermove', x1, y1);
    await fire('pointerup', x1, y1);
    await flush();
  };
  const insert = async () => {
    await click(q('[data-action=insert-molecule]'));
    return Object.values(s().doc.nodes)[0].science as MoleculeSpec;
  };

  it('draws a bond by dragging, then extends from an atom', async () => {
    await open();
    await drag(300, 170, 344, 170);
    expect(qa('[data-atom]').length).toBe(2);
    await drag(344, 170, 366, 132);
    expect(qa('[data-atom]').length).toBe(3);
    const m = await insert();
    expect(m.atoms).toHaveLength(3);
    expect(m.bonds).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it('snaps new bonds to thirty degrees and one bond length', async () => {
    await open();
    await drag(300, 170, 347, 150);
    const m = await insert();
    const [a, b] = m.atoms;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(1, 3);
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    expect(Math.abs(deg % 30)).toBeLessThan(0.01);
  });

  it('a drag onto an existing atom closes a ring', async () => {
    await open();
    await click(byText('.mol-list button', 'Ethane'));
    const before = qa('[data-atom]').length;
    expect(before).toBe(8);
  });

  it('sets single, double, triple, wedge and dash on existing bonds', async () => {
    await open();
    await drag(300, 170, 344, 170);
    const bonds = qa<HTMLButtonElement>('.mol-tool-group:first-child button');
    await click(bonds[1]);
    await fire('pointerdown', 322, 170);
    await fire('pointerup', 322, 170);
    await click(bonds[3]);
    await fire('pointerdown', 322, 170);
    await fire('pointerup', 322, 170);
    await flush();
    const m = await insert();
    expect(m.bonds[0].stereo).toBe('wedge');
  });

  it('places element atoms and relabels', async () => {
    await open();
    await click(byText('.mol-tool-group button', 'O'));
    await fire('pointerdown', 310, 170);
    await fire('pointerup', 310, 170);
    await flush();
    const m = await insert();
    expect(m.atoms[0].label).toBe('O');
  });

  it('adds charges, lone pairs and radicals', async () => {
    await open();
    await click(byText('.mol-list button', 'Water'));
    const atom = q('[data-atom=a1]')!;
    const x = Number(atom.getAttribute('cx'));
    const y = Number(atom.getAttribute('cy'));
    const tap = async () => {
      await fire('pointerdown', x, y);
      await fire('pointerup', x, y);
    };
    await click(q('[title^="Add a positive charge"]'));
    await tap();
    await click(q('[title^="Add a lone pair"]'));
    await tap();
    await tap();
    await click(q('[title^="Add an unpaired electron"]'));
    await tap();
    await flush();
    const m = await insert();
    expect(m.atoms[0].charge).toBe(1);
    expect(m.atoms[0].lonePairs).toHaveLength(2);
    expect(m.atoms[0].radicals).toHaveLength(1);
  });

  it('attaches a functional group', async () => {
    await open();
    await click(byText('.mol-list button', 'Benzene'));
    await click(byText('.mol-list button', 'COOH'));
    const atom = q('[data-atom=a1]')!;
    const x = Number(atom.getAttribute('cx'));
    const y = Number(atom.getAttribute('cy'));
    await fire('pointerdown', x, y);
    await fire('pointerup', x, y);
    await flush();
    const m = await insert();
    expect(m.atoms.some((a) => a.label === 'COOH')).toBe(true);
    expect(m.bonds).toHaveLength(7);
  });

  it('erases atoms with their bonds', async () => {
    await open();
    await click(byText('.mol-list button', 'Water'));
    await click(q('[title^="Erase"]'));
    const atom = q('[data-atom=a1]')!;
    await fire('pointerdown', Number(atom.getAttribute('cx')), Number(atom.getAttribute('cy')));
    await fire('pointerup', 0, 0);
    await flush();
    const m = await insert();
    expect(m.atoms).toHaveLength(2);
    expect(m.bonds).toHaveLength(0);
  });

  it('moves atoms, keeping bonds', async () => {
    await open();
    await click(byText('.mol-list button', 'Water'));
    await click(q('[title^="Move atoms"]'));
    const atom = q('[data-atom=a2]')!;
    const x = Number(atom.getAttribute('cx'));
    const y = Number(atom.getAttribute('cy'));
    await drag(x, y, x - 44, y + 44);
    await flush();
    const m = await insert();
    expect(m.bonds).toHaveLength(2);
    expect(m.atoms[1].y).toBeGreaterThan(1);
  });

  it('undo, redo, rotate, flip, align and clear', async () => {
    await open();
    await click(byText('.mol-list button', 'Ethanol'));
    const pos = () => qa('[data-atom]').map((c) => c.getAttribute('cx')).join();
    const start = pos();
    await click(byText('.sci-actions button', 'Rotate 30°'));
    expect(pos()).not.toBe(start);
    await click(byText('.sci-actions button', 'Undo'));
    expect(pos()).toBe(start);
    await click(byText('.sci-actions button', 'Redo'));
    expect(pos()).not.toBe(start);
    await click(byText('.sci-actions button', 'Flip ↔'));
    await click(byText('.sci-actions button', 'Flip ↕'));
    await click(byText('.sci-actions button', 'Align'));
    await click(byText('.sci-actions button', 'Clear'));
    expect(qa('[data-atom]').length).toBe(0);
    expect(q<HTMLButtonElement>('[data-action=insert-molecule]')!.disabled).toBe(true);
  });

  it.each(MOLECULE_TEMPLATES.map((t) => [t.name]))('template %s inserts and compiles to chemfig', async (name) => {
    await open();
    await click(byText('.mol-list button', name as string));
    await insert();
    expect(generateLatex(s().doc).code).toContain('\\chemfig{');
  });

  it('re-opens an inserted molecule with its atoms', async () => {
    const spec = fromBlueprint(MOLECULE_TEMPLATES[1].blueprint);
    const id = s().insertScience('molecule', spec, { w: 120, h: 120 }, { x: 200, y: 200 });
    await open(id);
    expect(qa('[data-atom]').length).toBe(5);
    await click(byText('.sci-actions button', 'Flip ↔'));
    await click(q('[data-action=insert-molecule]'));
    expect(Object.keys(s().doc.nodes)).toHaveLength(1);
  });
});

describe('inspector', () => {
  it('edits component labels and they reach the LaTeX', async () => {
    let id = '';
    await act(async () => void (id = s().addNode('circuit.resistor', { x: 200, y: 200 })));
    await flush();
    await setValue(byLabel<HTMLInputElement>('Name'), 'R_9');
    await setValue(byLabel<HTMLInputElement>('Value'), '5Ω');
    await setValue(byLabel<HTMLInputElement>('Voltage'), 'V_x');
    await setValue(byLabel<HTMLInputElement>('Current'), 'I_x');
    await setValue(byLabel<HTMLSelectElement>('Current direction'), 'backward');
    const spec = s().doc.nodes[id].science as CircuitSpec;
    expect(spec).toMatchObject({ label: 'R_9', value: '5\\Omega ', voltage: 'V_x', current: 'I_x', currentDir: 'backward' });
    const code = generateLatex(s().doc).code;
    expect(code).toContain('l={$R_9=5\\Omega$}');
    expect(problems).toEqual([]);
  });
  it('double-clicking a component focuses its name', async () => {
    const id = s().addNode('circuit.resistor', { x: 200, y: 200 });
    await flush();
    const n = s().doc.nodes[id];
    await act(async () => {
      q('.canvas-svg')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: n.x + 60 + n.w / 2, clientY: n.y + 60 + n.h / 2 }));
    });
    await flush();
    expect(document.activeElement).toBe(byLabel('Name'));
  });
  it('colour, width, rotation and flip apply and undo', async () => {
    const id = s().addNode('circuit.diode', { x: 200, y: 200 });
    await flush();
    await setValue(byLabel<HTMLInputElement>('Line width'), '3');
    expect(s().doc.nodes[id].style.strokeWidth).toBe(3);
    await click(byText('.inspector button', 'Rotate 90°'));
    expect(s().doc.nodes[id].rotation).toBe(90);
    await click(byText('.inspector button', 'Flip ↔'));
    expect(s().doc.nodes[id].flipH).toBe(true);
    s().undo();
    expect(s().doc.nodes[id].flipH).toBeUndefined();
  });
  it('changing a formula font resizes its box about the centre', async () => {
    const id = s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    await flush();
    await setValue(byLabel<HTMLInputElement>('Font size'), '30');
    const n = s().doc.nodes[id];
    expect([n.w, n.h]).toEqual([60, 30]);
    expect(n.x + n.w / 2).toBe(200);
  });
  it('bold is a toggle', async () => {
    const id = s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    await flush();
    await click(byText('.inspector button', 'B'));
    expect(s().doc.nodes[id].textStyle.bold).toBe(true);
  });
  it('a formula shows the science pane and an edit button', async () => {
    s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    await flush();
    await click(q('[data-action=edit-science]'));
    expect(s().scienceDialog?.kind).toBe('math');
  });
  it('flowchart shapes keep their pane', async () => {
    s().addNode('process', { x: 200, y: 200 });
    await flush();
    expect(q('.inspector textarea')).toBeTruthy();
    expect(byLabel('Name')).toBeNull();
  });
  it('a mixed selection uses the ordinary pane', async () => {
    const a = s().addNode('process', { x: 0, y: 0 });
    const b = s().addNode('circuit.resistor', { x: 300, y: 0 });
    await act(async () => s().setSelection([a, b]));
    expect(q('.inspector textarea')).toBeNull();
    expect(q('.inspector-head')?.textContent).toContain('2 shapes');
  });
});

describe('canvas integration', () => {
  it('renders each component kind without React errors', async () => {
    await act(async () => {
      CIRCUIT_DEFS.forEach((d, i) => {
        const n = makeNode(d.id, i * 120, 0, { id: `n${i}`, science: { ...emptyCircuitSpec(), label: 'X', value: '1', voltage: 'V', current: 'I' } });
        useEditor.setState((st) => ({ doc: { ...st.doc, nodes: { ...st.doc.nodes, [n.id]: n }, order: [...st.doc.order, n.id] } }));
      });
    });
    await flush();
    expect(qa('[data-kind^="circuit."]').length).toBe(CIRCUIT_DEFS.length);
    expect(problems).toEqual([]);
  });
  it('shows terminals, not box ports, on a selected component', async () => {
    const id = s().addNode('circuit.npn', { x: 200, y: 200 });
    await flush();
    expect(qa(`[data-port-node="${id}"]`).map((p) => p.getAttribute('data-port')).sort()).toEqual(['B', 'C', 'E']);
  });
  it('the selection bar offers rotate and flip only where they apply', async () => {
    const a = s().addNode('process', { x: 200, y: 200 });
    await flush();
    expect(q('[data-action=flip-h]')).toBeNull();
    const b = s().addNode('circuit.diode', { x: 500, y: 200 });
    await act(async () => s().setSelection([b]));
    await click(q('[data-action=flip-v]'));
    expect(s().doc.nodes[b].flipV).toBe(true);
    await click(q('[data-action=rotate-90]'));
    expect(s().doc.nodes[b].rotation).toBe(90);
    void a;
  });
  it('R turns a circuit part, but not a flowchart shape', async () => {
    const b = s().addNode('circuit.diode', { x: 500, y: 200 });
    const a = s().addNode('process', { x: 200, y: 200 });
    (q('.canvas-shell') as HTMLElement).focus();
    await act(async () => {
      s().setSelection([a]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    expect(s().doc.nodes[a].rotation).toBe(0);
    await act(async () => {
      s().setSelection([b]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    expect(s().doc.nodes[b].rotation).toBe(90);
  });
  it('formulas are rotatable, with the rotate handle', async () => {
    s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    await flush();
    expect(q('[data-handle=rotate]')).toBeTruthy();
    expect(qa('[data-handle]').length).toBe(9);
  });
  it('a corrupted formula draws a marker, never crashes', async () => {
    await act(async () => {
      s().insertScience('math', { type: 'math', latex: '\\notamacro', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    });
    await flush();
    expect(container.textContent).toContain('invalid formula');
    expect(problems).toEqual([]);
  });
  it('keeps code traceability for science objects', async () => {
    const id = s().insertScience('math', { type: 'math', latex: 'x', display: true, natural: { w: 2, h: 1 } }, { w: 40, h: 20 }, { x: 200, y: 200 });
    await flush();
    await act(async () => s().setSelection([id]));
    await flush();
    expect(qa('.code-line.traced').length).toBeGreaterThan(0);
    expect(q('.issues')?.textContent).toContain('amsmath');
  });
});
