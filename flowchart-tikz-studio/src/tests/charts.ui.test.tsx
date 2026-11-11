// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { generateLatex } from '../latex/generator';
import { suggestSpec } from '../charts/defaults';
import { sampleSalesTable } from '../charts/parse';

/**
 * The chart feature driven through the real component tree: open the
 * builder, load data, choose fields, insert, then edit in the property panel
 * and watch the generated code follow. A React warning fails the test.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const consoleErrors: unknown[][] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  consoleErrors.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => consoleErrors.push(a));
  localStorage.clear();
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
    chartBuilder: null,
    chartFocus: null,
    view: { zoom: 1, panX: 60, panY: 60 },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = () => act(() => root.render(<App />));
const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T;
const byText = (sel: string, text: string) =>
  [...container.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text) as HTMLElement;
const click = (el: Element) => act(() => (el as HTMLElement).click());
/** React listens for 'change' on selects and 'input' on text fields. */
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
const code = () => q('.code-text').textContent ?? '';
const chartNode = () => Object.values(useEditor.getState().doc.nodes).find((n) => n.kind === 'chart');

function openBuilderWithSample() {
  click(q('[data-action="chart"]'));
  expect(q('.chart-builder')).toBeTruthy();
  click(byText('.chart-builder button', 'Use sample sales data'));
  click(byText('.chart-builder button', 'Next: build the chart →'));
}

describe('chart builder', () => {
  it('is reachable from the toolbar and from the empty canvas', () => {
    render();
    expect(q('[data-action="chart"]').textContent).toContain('Chart from data');
    click(byText('.empty-card button', 'Chart from Excel / CSV'));
    expect(q('.chart-builder')).toBeTruthy();
    expect(useEditor.getState().chartBuilder).toEqual({ mode: 'new' });
    click(byText('.chart-builder button', 'Cancel'));
    expect(q('.chart-builder')).toBeNull();
  });

  it('loads data, shows a typed preview, then builds and inserts a chart', async () => {
    render();
    click(q('[data-action="chart"]'));
    // Step 2 is locked until there is data.
    expect((byText('.chart-builder .step-btn', '2. Build the chart') as HTMLButtonElement).disabled).toBe(true);
    click(byText('.chart-builder button', 'Use sample sales data'));
    expect(q('.cb-preview-table').textContent).toContain('12 rows · 5 columns');
    expect((q<HTMLSelectElement>('select[aria-label="Type of Sales"]')).value).toBe('number');
    expect((q<HTMLSelectElement>('select[aria-label="Type of Date"]')).value).toBe('date');
    click(byText('.chart-builder button', 'Next: build the chart →'));

    expect(q('.cb-preview svg')).toBeTruthy();
    expect(q('.cb-preview').textContent).toContain('Sum of Sales by Product');
    choose(q<HTMLSelectElement>('select[aria-label="Legend (split into series)"]'), 'Region');
    expect(q('.cb-preview').textContent).toContain('North');

    click(q('[data-action="insert-chart"]'));
    await settle();
    expect(q('.chart-builder')).toBeNull();
    const n = chartNode()!;
    expect(n).toBeTruthy();
    expect(n.chart!.legend).toBe('Region');
    expect(useEditor.getState().selection).toEqual([n.id]);
    expect(code()).toContain('\\begin{axis}');
    expect(code()).toContain('{North}');
    expect(code()).toContain('\\usepackage{pgfplots}');
    expect(q('.issues').textContent).toContain('pgfplots');
    expect(consoleErrors).toEqual([]);
  });

  it('switches chart type in the builder with the picker', () => {
    render();
    openBuilderWithSample();
    click(q('.chart-builder [role="radio"][title^="Pie"]'));
    expect(q('.chart-builder [role="radio"][aria-checked="true"]').textContent).toBe('Pie');
    expect(q('.cb-preview [data-chart-kind="pie"]')).toBeTruthy();
    click(q('.chart-builder [role="radio"][title^="Scatter"]'));
    expect(q('.cb-preview').textContent).toContain('Quantity vs Sales');
    expect(consoleErrors).toEqual([]);
  });

  it('accepts pasted spreadsheet cells', () => {
    render();
    click(q('[data-action="chart"]'));
    click(byText('.chart-builder button', 'Paste from Excel'));
    type(q<HTMLTextAreaElement>('#cb-paste'), 'City\tVisitors\nPune\t120\nMysuru\t80\n');
    click(byText('.chart-builder button', 'Use pasted data'));
    expect(q('.cb-preview-table').textContent).toContain('2 rows · 2 columns');
    click(byText('.chart-builder button', 'Next: build the chart →'));
    expect(q('.cb-preview').textContent).toContain('Sum of Visitors by City');
  });

  it('reports an unreadable file instead of failing silently', async () => {
    render();
    click(q('[data-action="chart"]'));
    const input = q<HTMLInputElement>('input[data-input="chart-data"]');
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2])], 'old.xls');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2]).buffer });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(q('.cb-error').textContent).toMatch(/\.xls/);
  });

  it('closes on Escape, and the canvas ignores keys while it is open', () => {
    render();
    click(q('[data-action="chart"]'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    expect(useEditor.getState().tool).toBe('select');
    act(() => {
      q('.chart-builder').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('.chart-builder')).toBeNull();
  });
});

describe('editing a chart in the property panel', () => {
  function insertSample() {
    let id = '';
    act(() => {
      id = useEditor.getState().insertChart(suggestSpec(sampleSalesTable()), { x: 400, y: 300 });
    });
    return id;
  }

  it('shows the chart pane, and every change reaches the LaTeX at once', async () => {
    render();
    insertSample();
    await settle();
    expect(q('.inspector.wide .chart-pane')).toBeTruthy();
    expect(code()).toContain('title={Sum of Sales by Product}');

    // Title
    const titleInput = [...container.querySelectorAll<HTMLInputElement>('.chart-style input[type="text"]')][0];
    type(titleInput, 'Revenue & units');
    await settle();
    expect(code()).toContain('title={Revenue \\& units}');

    // Aggregation
    choose(q<HTMLSelectElement>('.chart-pane select[aria-label="How to combine Sales"]'), 'avg');
    await settle();
    expect(code()).toContain('ylabel={Average of Sales}');

    // Legend field
    choose(q<HTMLSelectElement>('.chart-pane select[aria-label="Legend (split into series)"]'), 'Region');
    await settle();
    expect(code()).toContain('{South}');

    // Chart type
    click(q('.chart-pane [role="radio"][title^="Bar"]'));
    await settle();
    expect(code()).toContain('xbar');

    // Data labels
    const labels = byText('.chart-pane label', 'Show values on the chart (data labels)').querySelector('input')!;
    click(labels);
    await settle();
    expect(code()).toContain('% Data labels');

    // Colour theme
    const theme = [...container.querySelectorAll('.chart-style label.inline-field')].find((l) => l.textContent?.startsWith('Colour theme'))!;
    choose(theme.querySelector('select')!, 'grey');
    await settle();
    expect(code()).toContain('\\definecolor{fc252525}{HTML}{252525}');
    expect(consoleErrors).toEqual([]);
  });

  it('adds and edits a filter from the panel', async () => {
    render();
    insertSample();
    choose(q<HTMLSelectElement>('.chart-pane select[aria-label="Add a filter"]'), 'Region');
    expect(q('.filter-card').textContent).toContain('Region');
    const north = [...container.querySelectorAll<HTMLLabelElement>('.filter-values label')].find((l) => l.textContent === 'North')!;
    click(north.querySelector('input')!);
    await settle();
    const n = chartNode()!;
    expect(n.chart!.filters[0]).toEqual({ field: 'Region', include: ['South'] });
    // Only South rows remain (Mobile appears first): Laptop/South is 40,000 + 47,000.
    expect(code()).toContain('(1,87000) % Laptop');
    expect(code()).toContain('filtered on Region');
  });

  it('undoes and redoes chart edits one step at a time', () => {
    render();
    const id = insertSample();
    click(q('.chart-pane [role="radio"][title^="Line"]'));
    expect(useEditor.getState().doc.nodes[id].chart!.type).toBe('line');
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc.nodes[id].chart!.type).toBe('column');
    act(() => useEditor.getState().redo());
    expect(useEditor.getState().doc.nodes[id].chart!.type).toBe('line');
    act(() => useEditor.getState().undo());
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc.nodes[id]).toBeUndefined();
  });

  it('copies, pastes and deletes charts like any shape', () => {
    render();
    insertSample();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    });
    const charts = Object.values(useEditor.getState().doc.nodes).filter((n) => n.kind === 'chart');
    expect(charts).toHaveLength(2);
    expect(charts[1].chart).toEqual(charts[0].chart);
    expect(generateLatex(useEditor.getState().doc).code.match(/\\begin\{axis\}/g)).toHaveLength(2);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(Object.values(useEditor.getState().doc.nodes).filter((n) => n.kind === 'chart')).toHaveLength(1);
  });

  it('opens chart settings on Enter instead of a text editor, and has no rotate handle', () => {
    render();
    const id = insertSample();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(useEditor.getState().editingNodeId).toBeNull();
    expect(useEditor.getState().chartFocus?.id).toBe(id);
    expect(q('[data-handle="rotate"]')).toBeNull();
    expect(q('[data-handle="se"]')).toBeTruthy();
  });

  it('opens the full editor from the panel and applies changes to the same chart', async () => {
    render();
    const id = insertSample();
    click(byText('.chart-pane button', 'Open chart editor…'));
    expect(q('.chart-builder')).toBeTruthy();
    expect(q('.cb-build')).toBeTruthy();
    click(q('.chart-builder [role="radio"][title^="Donut"]'));
    click(byText('.chart-builder button', 'Apply changes'));
    await settle();
    expect(useEditor.getState().doc.nodes[id].chart!.type).toBe('donut');
    expect(Object.values(useEditor.getState().doc.nodes)).toHaveLength(1);
  });

  it('draws the chart on the canvas from the same layout', () => {
    render();
    const id = insertSample();
    const g = q(`[data-object-id="${id}"]`);
    expect(g.getAttribute('data-kind')).toBe('chart');
    expect(g.querySelectorAll('[data-series] rect')).toHaveLength(3);
    expect(g.textContent).toContain('Laptop');
    expect(g.textContent).toContain('250,000');
  });

  it('places a field by double-clicking its chip', () => {
    render();
    const id = insertSample();
    const chip = (name: string) =>
      [...container.querySelectorAll('.chart-pane .field-chip')].find((c) => c.querySelector('.chip-name')?.textContent === name)!;
    act(() => chip('Region').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(useEditor.getState().doc.nodes[id].chart!.legend).toBe('Region');
    act(() => chip('Quantity').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(useEditor.getState().doc.nodes[id].chart!.values.map((v) => v.field)).toEqual(['Sales', 'Quantity']);
  });

  it('shares the data table between undo steps instead of copying it', () => {
    render();
    const id = insertSample();
    const table = useEditor.getState().doc.nodes[id].chart!.data;
    for (const t of ['bar', 'line', 'pie'] as const) {
      act(() => useEditor.getState().updateChart(id, (c) => void (c.type = t)));
    }
    const { past, doc } = useEditor.getState();
    expect(doc.nodes[id].chart!.data).toBe(table);
    for (const snap of past.slice(-3)) expect(snap.nodes[id].chart!.data).toBe(table);
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc.nodes[id].chart!.type).toBe('line');
    expect(useEditor.getState().doc.nodes[id].chart!.data.rows).toHaveLength(12);
  });

  it('exports to SVG with the chart drawn and no editor chrome', async () => {
    const { buildSvgString } = await import('../export/svg');
    render();
    const id = insertSample();
    const svg = q<SVGSVGElement>('.canvas-svg');
    const out = buildSvgString(svg, useEditor.getState().doc);
    expect(out).toContain(`data-object-id="${id}"`);
    expect(out).toContain('Laptop');
    expect(out).toContain('#4e79a7');
    expect(out).not.toContain('data-ui');
    expect(out).not.toContain('var(--accent)');
  });
});

