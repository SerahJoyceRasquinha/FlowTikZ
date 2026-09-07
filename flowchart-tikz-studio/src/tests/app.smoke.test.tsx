// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram, makeNode } from '../model/defaults';
import { sampleDiagram } from '../model/sample';
import { resetIdCounters } from '../model/ids';

/**
 * End-to-end smoke test of the real pipeline:
 * canvas interaction -> diagram model -> renderer + LaTeX panel.
 *
 * It also fails the build if React logs a warning or an error, which covers
 * the "no console errors during normal operation" acceptance criterion.
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
  vi.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(args));
  vi.spyOn(console, 'warn').mockImplementation((...args) => consoleErrors.push(args));
  localStorage.clear();
  resetIdCounters();
  useEditor.setState({
    doc: emptyDiagram(),
    selection: [],
    past: [],
    future: [],
    snapshot: null,
    clipboard: null,
    dirty: false,
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

describe('application shell', () => {
  it('mounts both panels with no React errors', () => {
    render();
    expect(container.querySelector('.canvas-svg')).toBeTruthy();
    expect(container.querySelector('.code-panel')).toBeTruthy();
    expect(container.querySelector('.palette')).toBeTruthy();
    expect(container.querySelector('.inspector')).toBeTruthy();
    expect(consoleErrors).toEqual([]);
  });

  it('shows an empty state until a shape exists', () => {
    render();
    expect(container.querySelector('.empty-state')).toBeTruthy();
    act(() => void useEditor.getState().addNode('process', { x: 200, y: 200 }));
    expect(container.querySelector('.empty-state')).toBeNull();
  });

  it('renders a placed shape on the canvas and its code on the left', () => {
    render();
    let id = '';
    act(() => {
      id = useEditor.getState().addNode('decision', { x: 200, y: 200 });
    });
    act(() => {
      useEditor.getState().commit((d) => void (d.nodes[id].text = 'Approved?'));
    });

    const group = container.querySelector(`[data-object-id="${id}"]`);
    expect(group).toBeTruthy();
    expect(group!.querySelector('path')).toBeTruthy();
    expect(group!.textContent).toContain('Approved?');

    const code = container.querySelector('.code-text')!.textContent!;
    expect(code).toContain('\\documentclass');
    expect(code).toContain('shape=diamond');
    expect(code).toContain('Approved?');
    expect(consoleErrors).toEqual([]);
  });

  it('regenerates the code when a property changes', () => {
    render();
    let id = '';
    act(() => {
      id = useEditor.getState().addNode('process', { x: 200, y: 200 });
    });
    const before = container.querySelector('.code-text')!.textContent!;
    act(() => useEditor.getState().updateNodeStyle([id], { fill: '#ff8800' }));
    const after = container.querySelector('.code-text')!.textContent!;
    expect(after).not.toBe(before);
    expect(after).toContain('definecolor{fcFF8800}');
    expect(after).toContain('fill=fcFF8800');
  });

  it('draws a connector between two shapes and keeps it attached', () => {
    render();
    let a = '';
    let b = '';
    act(() => {
      a = useEditor.getState().addNode('process', { x: 200, y: 150 });
      b = useEditor.getState().addNode('process', { x: 200, y: 450 });
    });
    let e = '';
    act(() => {
      e = useEditor.getState().addEdge({
        source: { nodeId: a, port: 's' },
        target: { nodeId: b, port: 'n' },
        routing: 'straight',
      });
    });

    const pathBefore = container
      .querySelector(`[data-object-id="${e}"] path:not([data-hit])`)!
      .getAttribute('d');

    act(() => {
      useEditor.getState().commit((d) => void (d.nodes[a].x += 120));
    });

    const pathAfter = container
      .querySelector(`[data-object-id="${e}"] path:not([data-hit])`)!
      .getAttribute('d');

    expect(pathAfter).not.toBe(pathBefore);
    expect(container.querySelector('.code-text')!.textContent).toContain('fcedge');
    expect(consoleErrors).toEqual([]);
  });

  it('highlights the generated lines for the selected object', () => {
    render();
    let id = '';
    act(() => {
      id = useEditor.getState().addNode('process', { x: 200, y: 200 });
    });
    act(() => useEditor.getState().setSelection([id]));
    expect(container.querySelectorAll('.code-line.traced').length).toBeGreaterThan(0);
    act(() => useEditor.getState().clearSelection());
    expect(container.querySelectorAll('.code-line.traced').length).toBe(0);
  });

  it('switches between standalone and snippet output', () => {
    render();
    act(() => void useEditor.getState().addNode('process', { x: 200, y: 200 }));
    act(() => useEditor.getState().setOutputMode('snippet'));
    const code = container.querySelector('.code-text')!.textContent!;
    expect(code).not.toContain('\\documentclass');
    expect(code).toContain('\\begin{tikzpicture}');
  });

  it('opens the text editor overlay on demand', () => {
    render();
    let id = '';
    act(() => {
      id = useEditor.getState().addNode('process', { x: 200, y: 200 });
    });
    act(() => useEditor.getState().setEditingNode(id));
    const overlay = container.querySelector('textarea.text-overlay');
    expect(overlay).toBeTruthy();
  });

  it('renders every palette symbol as a thumbnail', () => {
    render();
    const thumbs = container.querySelectorAll('.shape-btn svg');
    expect(thumbs.length).toBeGreaterThan(20);
    for (const t of thumbs) {
      expect(t.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
    }
  });

  it('mirrors the diagram into local storage for recovery', async () => {
    render();
    act(() => void useEditor.getState().addNode('process', { x: 200, y: 200 }));
    await new Promise((r) => setTimeout(r, 900));
    const saved = localStorage.getItem('flowchart-tikz-studio:autosave');
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!).diagram.order.length).toBe(1);
  });

  it('renders a diagram with many objects without errors', () => {
    render();
    act(() => {
      useEditor.getState().loadDocument(sampleDiagram(), { markSaved: true });
    });
    act(() => {
      useEditor.getState().commit((d) => {
        for (let i = 0; i < 80; i++) {
          const id = `n${i + 100}`;
          d.nodes[id] = makeNode('process', (i % 10) * 180, Math.floor(i / 10) * 120, {
            id,
            text: `Step ${i}`,
          });
          d.order.push(id);
        }
      });
    });
    expect(container.querySelectorAll('[data-object-id]').length).toBeGreaterThan(80);
    expect(consoleErrors).toEqual([]);
  });

  it('skips a corrupt shape instead of blanking the canvas', () => {
    render();
    act(() => {
      useEditor.getState().commit((d) => {
        const good = makeNode('process', 100, 100, { id: 'ngood', text: 'fine' });
        d.nodes.ngood = good;
        d.nodes.nbad = { id: 'nbad', kind: 'process', x: 0, y: 0, w: 10, h: 10 } as never;
        d.order.push('ngood', 'nbad');
      });
    });
    expect(container.querySelector('[data-object-id="ngood"]')).toBeTruthy();
    expect(container.querySelector('.canvas-svg')).toBeTruthy();
    const code = container.querySelector('.code-text')!.textContent!;
    expect(code).toContain('fine');
  });
});
