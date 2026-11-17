// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import App from '../App';
import { useEditor } from '../state/store';
import { useProject } from '../state/projectStore';
import { emptyDiagram, makeNode } from '../model/defaults';
import { resetIdCounters } from '../model/ids';

/**
 * LaTeX project mode driven through the real UI: the File-menu input, the
 * preview, clicking into the document, drawing in the frame, inserting,
 * the LaTeX tab, undo/redo, the main-file chooser and the error dialog.
 * Any React warning or error fails the test, as in the other UI suites.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const FIX = join(__dirname, 'fixtures', 'project');
const fixture = (name: string) => new File([readFileSync(join(FIX, name))], name, { type: 'application/zip' });

let container: HTMLDivElement;
let root: Root;
const consoleErrors: unknown[][] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  consoleErrors.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => consoleErrors.push(a));
  localStorage.clear();
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
  resetIdCounters();
  useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [], snapshot: null, dirty: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => useProject.getState().close());
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) {
      const st = useProject.getState();
      throw new Error(`waitFor timed out (project ${!!st.project}, importing ${JSON.stringify(st.importing)}, pending ${!!st.pending}, errors ${JSON.stringify(consoleErrors).slice(0, 600)}, html ${container.innerHTML.slice(0, 300)})`);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

async function render() {
  await act(async () => root.render(<App />));
}

/** Chooses a file through the toolbar's real project input. */
async function choose(file: File) {
  const input = await waitFor(() => $<HTMLInputElement>('input[data-input="project"]'));
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

const mainText = () => useProject.getState().mainText() ?? '';

describe('LaTeX project mode (UI)', () => {
  it('opens a project, draws in the document, inserts, undoes and redoes', async () => {
    await render();
    await choose(fixture('overleaf-article.zip'));
    await waitFor(() => $('.tx-preview [data-block-key]'));
    // The preview replaces the drawing board; the side panel shows the files.
    expect($('.canvas-wrap .tx-preview') ?? $('.tx-preview')).toBeTruthy();
    expect(container.textContent).toContain('main.tex');

    const before = mainText();
    const blocks = [...document.querySelectorAll<HTMLElement>('.tx-preview [data-block-key]')];
    const para = blocks.find((b) => !b.matches('h1,h2,h3,h4') && (b.textContent ?? '').length > 20) ?? blocks[1];
    await click(para);
    await click(await waitFor(() => $('[data-action="draw-here"]')));
    await waitFor(() => $('[data-action="frame-insert"]'));

    // Draw something in the frame.
    await act(async () => {
      const d = emptyDiagram();
      d.nodes.nh = makeNode('process', 0, 0, { id: 'nh', text: 'Hello' });
      d.order.push('nh');
      useEditor.setState({ doc: d });
    });
    const caption = $<HTMLInputElement>('input[aria-label="Figure caption"]');
    expect(caption).toBeTruthy();
    await click($('[data-action="frame-insert"]'));
    await waitFor(() => !$('[data-action="frame-insert"]'));

    const after = mainText();
    expect(after).not.toBe(before);
    expect(after).toMatch(/FlowTikZ figure [\w-]+ \(begin\)/);
    expect(after).toMatch(/\\usepackage(\[[^\]]*\])?\{tikz\}/);
    // The drawing shows in the preview, the text after it is still there.
    await waitFor(() => $('.tx-preview svg[data-preview]'));
    expect(container.textContent).toContain('Hello');
    // Only the preamble and the insertion point changed: the tail is intact.
    const tail = before.slice(before.indexOf('\\end{document}'));
    expect(after.endsWith(tail)).toBe(true);

    // The LaTeX tab shows the new code.
    await click($('[data-pj-tab="source"]'));
    await waitFor(() => container.textContent?.includes('FlowTikZ figure'));

    // Ctrl+Z / Ctrl+Y act on the document.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(mainText()).toBe(before);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    });
    expect(mainText()).toBe(after);

    // Removing the figure restores the file exactly.
    const fig = await waitFor(() => $('.tx-preview svg[data-preview]')?.closest('[data-block-key]'));
    await click(fig);
    await click(await waitFor(() => $('.tx-preview [data-action="remove-figure"]')));
    expect(mainText()).toBe(before);
    expect(consoleErrors).toEqual([]);
  }, 30_000);

  it('asks which file is the main one when it is not clear', async () => {
    await render();
    await choose(fixture('multi-main.zip'));
    const ok = await waitFor(() => $<HTMLButtonElement>('[data-action="confirm-main"]'));
    const radio = document.querySelector<HTMLInputElement>('.modal input[type="radio"]');
    if (radio && ok.disabled) await click(radio);
    await click(ok);
    await waitFor(() => $('.tx-preview [data-block-key]'));
    expect(useProject.getState().project).toBeTruthy();
    expect(consoleErrors).toEqual([]);
  }, 30_000);

  it.each([
    ['no-main.zip', /No main LaTeX file/],
    ['no-tex.zip', /no \.tex file/i],
    ['empty.zip', /empty/],
    ['not-a-zip.zip', /zip/i],
    ['truncated.zip', /./],
  ])('refuses %s with a clear message', async (name, msg) => {
    await render();
    await choose(fixture(name));
    const err = await waitFor(() => $('[data-testid="project-error"]'));
    expect(err.textContent).toMatch(msg);
    // Nothing was loaded; the drawing board is still there.
    expect(useProject.getState().project).toBeNull();
    expect($('.tx-preview')).toBeNull();
    expect(consoleErrors).toEqual([]);
  }, 30_000);
});
