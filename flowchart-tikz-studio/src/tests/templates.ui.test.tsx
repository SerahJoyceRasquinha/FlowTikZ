// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { loadEngine } from '../science/math/engine';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../templates/library';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';

/** Black-box tests of the Templates dialog, the way a user meets it. */

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
    dirty: false,
    templatesOpen: null,
    scienceDialog: null,
    view: { zoom: 1, panX: 60, panY: 60 },
  });
  await loadEngine();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
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
async function click(el: Element | null) {
  expect(el, 'element to click').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
  // The library is a lazy chunk: give it time to arrive when it is opening.
  if (useEditor.getState().templatesOpen) {
    for (let i = 0; i < 100 && !document.querySelector('[aria-label="Template library"]'); i++) await flush();
  }
}
async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}
const dialog = () => q('[aria-label="Template library"]');
const search = () => q<HTMLInputElement>('[aria-label="Search templates"]')!;
const cards = () => qa<HTMLButtonElement>('.tpl-card');

describe('opening the library', () => {
  it('has a clearly labelled Templates button in the toolbar', async () => {
    const btn = q('[data-action="templates"]')!;
    expect(btn.textContent).toContain('Templates');
    expect(btn.getAttribute('title')).toMatch(/flowcharts/i);
    await click(btn);
    expect(dialog()).toBeTruthy();
    expect(document.activeElement).toBe(search());
  });

  it('opens on the right tab from the Physics and Chem menus and the empty canvas', async () => {
    await click(q('[data-action="physics"]'));
    await click(q('[data-action="physics-templates"]'));
    expect(q('[data-tpl-tab="physics"]')!.getAttribute('aria-selected')).toBe('true');
    await click(q('.tpl-foot .btn'));
    expect(dialog()).toBeNull();
    await click(q('[data-action="chemistry"]'));
    await click(q('[data-action="chem-templates"]'));
    expect(q('[data-tpl-tab="chem"]')!.getAttribute('aria-selected')).toBe('true');
    await click(q('[aria-label="Template library"] [aria-label="Close"]'));
    await click(q('[data-action="empty-templates"]'));
    expect(q('[data-tpl-tab="flow"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('shows every category with a count, and a live preview on each card', async () => {
    await click(q('[data-action="templates"]'));
    for (const c of TEMPLATE_CATEGORIES) {
      const tab = q(`[data-tpl-tab="${c.id}"]`)!;
      expect(tab.textContent).toContain(c.label);
      expect(Number(tab.querySelector('.tpl-count')!.textContent)).toBe(TEMPLATES.filter((t) => t.category === c.id).length);
      await click(tab);
      expect(cards().length).toBe(TEMPLATES.filter((t) => t.category === c.id).length);
      // Every card draws something (shapes, formulas or a molecule).
      for (const card of cards()) {
        const svg = card.querySelector('svg.tpl-preview');
        expect(svg, card.dataset.template).toBeTruthy();
        expect(svg!.querySelectorAll('path, text, use, rect, circle, line').length, card.dataset.template).toBeGreaterThan(0);
      }
    }
  });
});

describe('searching', () => {
  it('filters as you type and jumps to the tab that has the match', async () => {
    await click(q('[data-action="templates"]'));
    await type(search(), 'photosynthesis');
    expect(q('[data-tpl-tab="chem"]')!.getAttribute('aria-selected')).toBe('true');
    expect(cards().map((c) => c.dataset.template)).toEqual(['chem-photosynthesis']);
    expect(q('[data-tpl-tab="math"] .tpl-count')!.textContent).toBe('0');
  });

  it('says so when nothing matches, and Esc clears the search before closing', async () => {
    await click(q('[data-action="templates"]'));
    await type(search(), 'qwertyuiop');
    expect(q('.tpl-empty')!.textContent).toContain('No template matches');
    await press(search(), 'Escape');
    expect(search().value).toBe('');
    expect(dialog()).toBeTruthy();
    await press(search(), 'Escape');
    expect(dialog()).toBeNull();
  });

  it('typing in the search box never triggers canvas shortcuts', async () => {
    addProcess();
    await click(q('[data-action="templates"]'));
    await press(search(), 'Delete');
    await press(search(), 'h');
    await press(search(), 'Backspace');
    expect(Object.keys(s().doc.nodes).length).toBe(1);
    expect(s().tool).toBe('select');
  });
});

function addProcess() {
  act(() => {
    s().addNode('process', { x: 200, y: 200 });
  });
}

describe('inserting', () => {
  it('a click inserts the template, selects it, closes the dialog and reports it', async () => {
    await click(q('[data-action="templates"]'));
    await click(q('[data-template="flow-if-else"]'));
    await flush();
    expect(dialog()).toBeNull();
    const nodes = Object.values(s().doc.nodes);
    expect(nodes.map((n) => n.text)).toEqual(expect.arrayContaining(['Start', 'Condition?', 'Do A', 'Do B', 'End']));
    expect(s().selection.length).toBe(nodes.length + Object.keys(s().doc.edges).length);
    expect(q('.status-toast, .toast, [role="status"]')?.textContent ?? s().statusMessage ?? '').toMatch(/Inserted "If \/ else decision"/);
  });

  it('inserts formulas, reactions, molecules and circuits as editable objects', async () => {
    for (const id of ['math-quadratic', 'chem-haber', 'chem-mol-benzene', 'phys-rc']) {
      await click(q('[data-action="templates"]'));
      await type(search(), '');
      const card = q(`[data-template="${id}"]`) ?? (await (async () => {
        const t = TEMPLATES.find((x) => x.id === id)!;
        await click(q(`[data-tpl-tab="${t.category}"]`));
        return q(`[data-template="${id}"]`);
      })());
      await click(card);
      await flush();
    }
    const kinds = Object.values(s().doc.nodes).map((n) => n.science?.type ?? n.kind);
    expect(kinds).toContain('math');
    expect(kinds).toContain('chem');
    expect(kinds).toContain('molecule');
    expect(kinds).toContain('circuit');
    // Double-clicking (Enter) on the formula opens its editor with the template's LaTeX.
    const math = Object.values(s().doc.nodes).find((n) => n.science?.type === 'math')!;
    act(() => s().setSelection([math.id]));
    await press(window, 'Enter');
    for (let i = 0; i < 50 && !q('[aria-label="Formula editor"]'); i++) await flush();
    expect(q('[aria-label="Formula editor"]')).toBeTruthy();
    expect(q('[data-testid="formula-preview"] svg')!.getAttribute('aria-label')).toContain('\\sqrt');
  });

  it('each insert is one step that Ctrl+Z takes out again', async () => {
    await click(q('[data-action="templates"]'));
    await click(q('[data-template="flow-while"]'));
    await flush();
    expect(Object.keys(s().doc.nodes).length).toBeGreaterThan(4);
    await press(window, 'z', { ctrlKey: true, code: 'KeyZ' });
    expect(Object.keys(s().doc.nodes)).toEqual([]);
    await press(window, 'y', { ctrlKey: true, code: 'KeyY' });
    expect(Object.keys(s().doc.nodes).length).toBeGreaterThan(4);
  });

  it('the LaTeX for an inserted template is clean', async () => {
    await click(q('[data-action="templates"]'));
    await click(q('[data-template="flow-login"]'));
    await flush();
    const out = generateLatex(s().doc, { mode: 'standalone', comments: true });
    expect(out.issues).toEqual([]);
    expect(lintLatex(out.code, { standalone: true }).problems).toEqual([]);
    // And the code panel shows it.
    expect(q('[data-tour="code"]')!.textContent).toContain('User');
  });

  it('cards can be reached and chosen with the keyboard', async () => {
    await click(q('[data-action="templates"]'));
    const first = cards()[0];
    await act(async () => first.focus());
    await press(first, 'ArrowRight');
    expect(document.activeElement).toBe(cards()[1]);
    await press(cards()[1], 'Home');
    expect(document.activeElement).toBe(cards()[0]);
    await press(cards()[0], 'End');
    expect(document.activeElement).toBe(cards()[cards().length - 1]);
  });

  it('clicking the dimmed backdrop closes it without inserting', async () => {
    await click(q('[data-action="templates"]'));
    const backdrop = dialog()!.parentElement!;
    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(Object.keys(s().doc.nodes)).toEqual([]);
  });
});
