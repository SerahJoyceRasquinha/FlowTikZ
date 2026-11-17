// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { loadEngine } from '../science/math/engine';
import type { ChemSpec, MathSpec } from '../science/types';

/**
 * Black-box tests for "Ctrl+Z / Ctrl+Y work everywhere", driven through real
 * key events on the assembled app: the canvas, the property panel, the text
 * box inside a shape, and each editor dialog. They also pin down the other
 * everyday shortcuts users reach for without thinking.
 */

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
    chartBuilder: null,
    templatesOpen: null,
    fieldSession: null,
    lastCommitSession: null,
    spacePan: false,
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
  // Any React warning during a test is a failure.
  expect(problems).toEqual([]);
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
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
/** Simulates typing into a controlled field (React listens to `input`). */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.setSelectionRange?.(value.length, value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function focus(el: HTMLElement) {
  await act(async () => {
    el.focus();
  });
}
/** Press a key on an element; returns true when the app claimed it. */
async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  let prevented = false;
  await act(async () => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    prevented = ev.defaultPrevented;
  });
  return prevented;
}
const undoKey = (t: EventTarget) => press(t, 'z', { ctrlKey: true, code: 'KeyZ' });
const redoKey = (t: EventTarget) => press(t, 'y', { ctrlKey: true, code: 'KeyY' });
const redoShift = (t: EventTarget) => press(t, 'Z', { ctrlKey: true, shiftKey: true, code: 'KeyZ' });
const byText = (sel: string, text: string) => qa(sel).find((b) => b.textContent?.trim() === text) as HTMLElement;

function addShape(kind = 'process', at = { x: 300, y: 200 }) {
  let id = '';
  act(() => {
    id = s().addNode(kind, at);
  });
  return id;
}

/* ================================================================ canvas */

describe('canvas undo / redo', () => {
  it('Ctrl+Z removes the last change, Ctrl+Y and Ctrl+Shift+Z bring it back', async () => {
    const a = addShape();
    const b = addShape('decision', { x: 300, y: 400 });
    expect(Object.keys(s().doc.nodes)).toEqual([a, b]);
    expect(await undoKey(window)).toBe(true);
    expect(Object.keys(s().doc.nodes)).toEqual([a]);
    await undoKey(window);
    expect(Object.keys(s().doc.nodes)).toEqual([]);
    expect(await redoKey(window)).toBe(true);
    expect(Object.keys(s().doc.nodes)).toEqual([a]);
    expect(await redoShift(window)).toBe(true);
    expect(Object.keys(s().doc.nodes)).toEqual([a, b]);
  });

  it('works with Cmd on a Mac and on a non-Latin keyboard layout', async () => {
    addShape();
    await press(window, 'z', { metaKey: true, code: 'KeyZ' });
    expect(Object.keys(s().doc.nodes)).toEqual([]);
    await press(window, 'н', { ctrlKey: true, code: 'KeyY' });
    expect(Object.keys(s().doc.nodes).length).toBe(1);
  });

  it('undoes keyboard nudges and deletes', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    await press(window, 'ArrowRight');
    const moved = s().doc.nodes[id].x;
    await undoKey(window);
    expect(s().doc.nodes[id].x).toBe(moved - (s().doc.settings.gridSize || 1));
    await press(window, 'Delete');
    expect(s().doc.nodes[id]).toBeUndefined();
    await undoKey(window);
    expect(s().doc.nodes[id]).toBeTruthy();
  });

  it('works while a toolbar button has focus', async () => {
    addShape();
    const btn = q<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    await focus(btn);
    expect(await undoKey(btn)).toBe(true);
    expect(Object.keys(s().doc.nodes)).toEqual([]);
  });
});

/* ======================================================= property panel */

describe('property panel fields', () => {
  it('a burst of typing in the label is one undo step, undone from inside the field', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    await flush();
    const label = q<HTMLTextAreaElement>('.inspector textarea')!;
    await focus(label);
    const pastBefore = s().past.length;
    for (const v of ['S', 'St', 'Sta', 'Star', 'Start']) await type(label, v);
    expect(s().doc.nodes[id].text).toBe('Start');
    expect(s().past.length).toBe(pastBefore + 1);
    expect(await undoKey(label)).toBe(true);
    expect(s().doc.nodes[id].text).toBe('');
    expect(label.value).toBe('');
    expect(await redoKey(label)).toBe(true);
    expect(s().doc.nodes[id].text).toBe('Start');
  });

  it('separate visits to a field are separate steps', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    await flush();
    const label = q<HTMLTextAreaElement>('.inspector textarea')!;
    await focus(label);
    await type(label, 'One');
    await act(async () => label.blur());
    await focus(label);
    await type(label, 'One two');
    await undoKey(label);
    expect(s().doc.nodes[id].text).toBe('One');
    await undoKey(label);
    expect(s().doc.nodes[id].text).toBe('');
  });

  it('a drop-down change is undone with Ctrl+Z while it still has focus', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    await flush();
    const select = qa<HTMLSelectElement>('.inspector select').find((el) => Array.from(el.options).some((o) => o.value === 'dashed'))!;
    expect(select).toBeTruthy();
    await focus(select);
    await choose(select, 'dashed');
    expect(s().doc.nodes[id].style.strokeStyle).toBe('dashed');
    expect(await undoKey(select)).toBe(true);
    expect(s().doc.nodes[id].style.strokeStyle).not.toBe('dashed');
  });

  it('leaves the browser’s own undo to plain text boxes such as the symbol search', async () => {
    addShape();
    const search = q<HTMLInputElement>('.palette-head input')!;
    await focus(search);
    expect(await undoKey(search)).toBe(false);
    expect(Object.keys(s().doc.nodes).length).toBe(1);
  });
});

/* ============================================ typing inside a shape */

describe('text typed inside a shape', () => {
  it('Ctrl+Z takes back typing first, then the previous canvas change', async () => {
    const id = addShape();
    act(() => s().setEditingNode(id));
    await flush();
    const box = q<HTMLTextAreaElement>('.text-overlay')!;
    expect(box).toBeTruthy();
    await type(box, 'Hello');
    expect(await undoKey(box)).toBe(true);
    expect(box.value).toBe('');
    expect(await redoKey(box)).toBe(true);
    expect(box.value).toBe('Hello');
    await undoKey(box);
    // Nothing left to take back in the box: it closes and undoes the shape.
    await undoKey(box);
    await flush();
    expect(q('.text-overlay')).toBeNull();
    expect(s().doc.nodes[id]).toBeUndefined();
  });

  it('committed text is one canvas step', async () => {
    const id = addShape();
    act(() => s().setEditingNode(id));
    await flush();
    const box = q<HTMLTextAreaElement>('.text-overlay')!;
    await type(box, 'Decide');
    await press(box, 'Enter', { ctrlKey: true });
    await flush();
    expect(s().doc.nodes[id].text).toBe('Decide');
    await undoKey(window);
    expect(s().doc.nodes[id].text).toBe('');
  });
});

/* ======================================================= formula editor */

describe('formula editor', () => {
  async function open() {
    await click(q('[data-action=math]'));
    await until(() => q('[aria-label="Formula editor"]'));
  }
  const dialog = () => q('[aria-label="Formula editor"]')!;
  const latexOf = () => q('[data-testid="formula-preview"] svg')?.getAttribute('aria-label') ?? '';

  it('undoes and redoes typing, structures and symbols with the keyboard', async () => {
    await open();
    const box = q<HTMLInputElement>('.mx-input')!;
    await focus(box);
    await type(box, 'x');
    await click(q('[data-struct="frac"]'));
    expect(latexOf()).toContain('\\frac');
    expect(await undoKey(dialog())).toBe(true);
    await flush();
    expect(latexOf()).not.toContain('\\frac');
    expect(latexOf()).toContain('x');
    expect(await redoKey(dialog())).toBe(true);
    await flush();
    expect(latexOf()).toContain('\\frac');
    expect(await redoShift(dialog())).toBe(true); // nothing more to redo: still handled, no change
    expect(latexOf()).toContain('\\frac');
  });

  it('Ctrl+Z works from a box, a structure button or the symbol tabs alike', async () => {
    await open();
    const box = q<HTMLInputElement>('.mx-input')!;
    await focus(box);
    await type(box, 'a');
    await type(box, 'ab');
    const structBtn = q<HTMLButtonElement>('[data-struct="sqrt"]')!;
    await focus(structBtn);
    await undoKey(structBtn);
    await flush();
    expect(latexOf()).not.toContain('a');
  });

  it('has history in LaTeX mode too, including inserted symbols', async () => {
    await open();
    await click(byText('.sci-modal button', 'LaTeX'));
    const src = q<HTMLTextAreaElement>('.sci-source')!;
    await focus(src);
    await type(src, 'E=mc^{2}');
    await click(q('.sym-grid button'));
    const withSymbol = src.value;
    expect(withSymbol.length).toBeGreaterThan('E=mc^{2}'.length);
    await undoKey(src);
    expect(q<HTMLTextAreaElement>('.sci-source')!.value).toBe('E=mc^{2}');
    await undoKey(src);
    expect(q<HTMLTextAreaElement>('.sci-source')!.value).toBe('');
    await redoKey(src);
    expect(q<HTMLTextAreaElement>('.sci-source')!.value).toBe('E=mc^{2}');
  });

  it('the Undo / Redo buttons enable and disable with the history', async () => {
    await open();
    const undoBtn = q<HTMLButtonElement>('[data-action="formula-undo"]')!;
    const redoBtn = q<HTMLButtonElement>('[data-action="formula-redo"]')!;
    expect(undoBtn.disabled).toBe(true);
    await click(q('[data-struct="frac"]'));
    expect(q<HTMLButtonElement>('[data-action="formula-undo"]')!.disabled).toBe(false);
    await click(q('[data-action="formula-undo"]'));
    expect(q<HTMLButtonElement>('[data-action="formula-redo"]')!.disabled).toBe(false);
    void redoBtn;
  });

  it('never touches the canvas history while open, and inserting is one canvas step', async () => {
    addShape();
    const pastBefore = s().past.length;
    await open();
    await undoKey(dialog());
    expect(Object.keys(s().doc.nodes).length).toBe(1);
    const box = q<HTMLInputElement>('.mx-input')!;
    await focus(box);
    await type(box, 'y=2');
    await click(q('[data-action="insert-formula"]'));
    await flush();
    expect(s().past.length).toBe(pastBefore + 1);
    const math = Object.values(s().doc.nodes).find((n) => n.science?.type === 'math');
    expect((math?.science as MathSpec).latex).toBe('y=2');
    await undoKey(window);
    expect(Object.values(s().doc.nodes).some((n) => n.science?.type === 'math')).toBe(false);
  });

  it('keeps the symbol search box on the browser’s own undo', async () => {
    await open();
    const search = q<HTMLInputElement>('[aria-label="Search symbols"]')!;
    await focus(search);
    expect(await undoKey(search)).toBe(false);
  });
});

/* ===================================================== chemistry editor */

describe('chemistry editor', () => {
  async function open(tab: 'formula' | 'reaction' = 'formula') {
    act(() => s().openScienceDialog({ kind: 'chem', tab }));
    await until(() => q('[aria-label="Chemistry editor"]'));
  }
  const src = () => q<HTMLTextAreaElement>('[aria-label="Chemical formula"]')!;

  it('undoes element buttons and typing', async () => {
    await open();
    await type(src(), 'H2');
    await click(byText('.element-btn', 'O'));
    expect(src().value).toBe('H2O');
    expect(await undoKey(q('[aria-label="Chemistry editor"]')!)).toBe(true);
    expect(src().value).toBe('H2');
    await undoKey(src());
    expect(src().value).toBe('');
    await redoKey(src());
    await redoKey(src());
    expect(src().value).toBe('H2O');
  });

  it('undoes reaction edits: added terms, typed formulas and arrows', async () => {
    await open('reaction');
    const first = q<HTMLInputElement>('[aria-label="Reactant 1 formula"]')!;
    await type(first, 'H2');
    await click(byText('.rx-list button', '+ add'));
    expect(q('[aria-label="Reactant 2 formula"]')).toBeTruthy();
    const dlg = q('[aria-label="Chemistry editor"]')!;
    await undoKey(dlg);
    expect(q('[aria-label="Reactant 2 formula"]')).toBeNull();
    await undoKey(dlg);
    expect(q<HTMLInputElement>('[aria-label="Reactant 1 formula"]')!.value).toBe('');
    await choose(q<HTMLSelectElement>('[aria-label="Step 1 arrow type"]')!, '<=>');
    await undoKey(dlg);
    expect(q<HTMLSelectElement>('[aria-label="Step 1 arrow type"]')!.value).toBe('->');
  });

  it('inserting is one canvas step', async () => {
    await open();
    await type(src(), 'CO2');
    await click(q('[data-action="insert-chem"]'));
    await flush();
    const n = Object.values(s().doc.nodes).find((x) => x.science?.type === 'chem');
    expect((n?.science as ChemSpec).source).toBe('CO2');
    await undoKey(window);
    expect(Object.keys(s().doc.nodes)).toEqual([]);
  });
});

/* ====================================================== molecule editor */

describe('molecule editor', () => {
  it('undoes and redoes a common molecule and a cleared sheet', async () => {
    act(() => s().openScienceDialog({ kind: 'molecule' }));
    await until(() => q('[aria-label="Molecule editor"]'));
    const tpl = qa<HTMLButtonElement>('.sci-modal button').find((b) => /benzene/i.test(b.textContent ?? '') || /benzene/i.test(b.title));
    expect(tpl, 'benzene button').toBeTruthy();
    await click(tpl!);
    const atoms = () => qa('.sci-modal svg circle, .sci-modal svg text').length;
    const filled = atoms();
    const dlg = q('[aria-label="Molecule editor"]')!;
    expect(await undoKey(dlg)).toBe(true);
    expect(q<HTMLButtonElement>('[data-action="molecule-redo"]')!.disabled).toBe(false);
    expect(await redoKey(dlg)).toBe(true);
    expect(atoms()).toBe(filled);
    expect(q<HTMLButtonElement>('[data-action="molecule-undo"]')!.disabled).toBe(false);
  });
});

/* ======================================================== chart builder */

describe('chart builder', () => {
  it('undoes chart type changes with the keyboard and the buttons', async () => {
    await click(q('[data-action="chart"]'));
    await click(byText('.chart-builder button', 'Use sample sales data'));
    await click(byText('.chart-builder button', 'Next: build the chart →'));
    const checked = () => q('.chart-builder [role="radio"][aria-checked="true"]')?.textContent;
    const original = checked();
    const other = qa<HTMLButtonElement>('.chart-builder [role="radio"]').find((b) => b.getAttribute('aria-checked') !== 'true' && /Line/.test(b.textContent ?? ''))!;
    await click(other);
    expect(checked()).toContain('Line');
    const dlg = q('[aria-label="Chart from data"]')!;
    expect(await undoKey(dlg)).toBe(true);
    expect(checked()).toBe(original);
    expect(await redoKey(dlg)).toBe(true);
    expect(checked()).toContain('Line');
    await click(q('[data-action="chart-undo"]'));
    expect(checked()).toBe(original);
    // The canvas is untouched until Insert.
    expect(Object.keys(s().doc.nodes)).toEqual([]);
  });
});

/* =================================================== everyday shortcuts */

describe('everyday shortcuts', () => {
  it('Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+D / Ctrl+A on shapes', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    await press(window, 'c', { ctrlKey: true });
    await press(window, 'v', { ctrlKey: true });
    expect(Object.keys(s().doc.nodes).length).toBe(2);
    await press(window, 'd', { ctrlKey: true });
    expect(Object.keys(s().doc.nodes).length).toBe(3);
    await press(window, 'a', { ctrlKey: true });
    expect(s().selection.length).toBe(3);
    await press(window, 'x', { ctrlKey: true });
    expect(Object.keys(s().doc.nodes).length).toBe(0);
    await undoKey(window);
    expect(Object.keys(s().doc.nodes).length).toBe(3);
  });

  it('Ctrl+C and Ctrl+A act on the LaTeX text when it has focus', async () => {
    const id = addShape();
    act(() => s().setSelection([id]));
    const panel = q('[data-tour="code"]')!;
    const inside = (panel.querySelector('button, pre, code, [tabindex]') as HTMLElement) ?? panel;
    expect(await press(inside, 'a', { ctrlKey: true })).toBe(false);
    expect(s().selection).toEqual([id]);
    await press(inside, 'x', { ctrlKey: true });
    expect(s().doc.nodes[id]).toBeTruthy();
  });

  it('Ctrl+O opens a saved diagram; Ctrl+S saves', async () => {
    const input = q<HTMLInputElement>('input[data-input="open"]')!;
    const spy = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    expect(await press(window, 'o', { ctrlKey: true })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const url = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await press(window, 's', { ctrlKey: true })).toBe(true);
    expect(anchor).toHaveBeenCalled();
    void url;
  });

  it('Ctrl+] and Ctrl+[ change the layer order; with Shift, all the way', async () => {
    const a = addShape('process', { x: 100, y: 100 });
    const b = addShape('process', { x: 120, y: 120 });
    const c = addShape('process', { x: 140, y: 140 });
    const order = () => s().doc.order.filter((id) => s().doc.nodes[id]);
    act(() => s().setSelection([a]));
    await press(window, ']', { ctrlKey: true, code: 'BracketRight' });
    expect(order()).toEqual([b, a, c]);
    await press(window, '}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' });
    expect(order()).toEqual([b, c, a]);
    await press(window, '[', { ctrlKey: true, code: 'BracketLeft' });
    expect(order()).toEqual([b, a, c]);
    await press(window, '{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' });
    expect(order()).toEqual([a, b, c]);
  });

  it('holding Space over the board pans with any tool, then lets go', async () => {
    const board = q<HTMLElement>('.canvas-shell')!;
    await focus(board);
    expect(await press(board, ' ', { code: 'Space' })).toBe(true);
    expect(s().spacePan).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    });
    expect(s().spacePan).toBe(false);
  });

  it('Space in a text field types a space, not a pan', async () => {
    const search = q<HTMLInputElement>('.palette-head input')!;
    await focus(search);
    expect(await press(search, ' ', { code: 'Space' })).toBe(false);
    expect(s().spacePan).toBe(false);
  });

  it('? opens the help, which lists the shortcuts in groups', async () => {
    await press(window, '?');
    await flush();
    const groups = qa('.shortcut-group').map((h) => h.textContent);
    expect(groups).toEqual(['Editing', 'Tools', 'Canvas & view', 'Files', 'In the editors', 'Browser']);
    expect(q('.help-modal')?.textContent).toContain('Zoom the whole page');
  });
});
