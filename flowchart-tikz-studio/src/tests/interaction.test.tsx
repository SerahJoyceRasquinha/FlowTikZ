// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { SHAPE_SHORTCUTS, shortcutLabel, shortcutForShape } from '../model/shortcuts';
import { SHAPE_LIST } from '../model/shapes';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';
import {
  PORT_GAP,
  HANDLE_SIZE,
  ROTATE_OFFSET,
  handlePositions,
} from '../canvas/SelectionLayer';

/**
 * Interaction-level tests.
 *
 * The unit suites prove the geometry and the shortcut table in isolation.
 * These drive the assembled application the way a pointer and a keyboard do -
 * real events, on the real component tree - because the things most likely to
 * break here are the wiring between them: which surface owns a keystroke,
 * which element receives a click, and whether a gesture leaves the model in
 * the state the user asked for.
 *
 * As with the smoke suite, a single React warning fails the test.
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
    boardFocused: false,
    guides: [],
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

/* --------------------------------------------------------------- helpers */

/** jsdom has no PointerEvent; React dispatches on the event's type name. */
function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  Object.defineProperty(e, 'isPrimary', { value: true });
  return e;
}

function key(k: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }),
    );
  });
}

const svg = () => container.querySelector('.canvas-svg') as SVGSVGElement;
const shell = () => container.querySelector('.canvas-shell') as HTMLElement;

/**
 * Pointer moves are coalesced into animation frames, so a test has to let a
 * frame pass before reading the result - exactly as the browser would.
 */
async function frame() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 24));
  });
}

/**
 * The canvas maps client coordinates through pan and zoom. jsdom reports a
 * zero-origin rect, so with the default viewport a world point is simply the
 * client point plus the pan.
 */
function clientFor(world: { x: number; y: number }) {
  const v = useEditor.getState().view;
  return { clientX: world.x * v.zoom + v.panX, clientY: world.y * v.zoom + v.panY };
}

function down(world: { x: number; y: number }, init: MouseEventInit = {}, target?: Element) {
  act(() => {
    (target ?? svg()).dispatchEvent(
      pointerEvent('pointerdown', { button: 0, ...clientFor(world), ...init }),
    );
  });
}

async function move(world: { x: number; y: number }, init: MouseEventInit = {}) {
  act(() => {
    svg().dispatchEvent(pointerEvent('pointermove', { ...clientFor(world), ...init }));
  });
  await frame();
}

function up(world: { x: number; y: number }, init: MouseEventInit = {}) {
  act(() => {
    svg().dispatchEvent(
      pointerEvent('pointerup', { button: 0, ...clientFor(world), ...init }),
    );
  });
}

function addShape(kind: string, at: { x: number; y: number }) {
  let id = '';
  act(() => {
    id = useEditor.getState().addNode(kind, at);
  });
  return id;
}

/* ------------------------------------------------- keyboard shape shortcuts */

describe('keyboard shape shortcuts', () => {
  it('arms a shape from its letter when the board has focus', () => {
    render();
    expect(useEditor.getState().pendingShape).toBeNull();
    key('r');
    expect(useEditor.getState().pendingShape).toBe('rectangle');
    expect(useEditor.getState().tool).toBe('shape');
  });

  it('treats the letter as a toggle, exactly like clicking the palette', () => {
    render();
    key('r');
    expect(useEditor.getState().pendingShape).toBe('rectangle');
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
    expect(useEditor.getState().tool).toBe('select');
  });

  it('accepts upper case as the same shortcut', () => {
    render();
    key('D');
    expect(useEditor.getState().pendingShape).toBe('decision');
  });

  it('separates the shift tier from the plain tier', () => {
    render();
    key('m');
    expect(useEditor.getState().pendingShape).toBe('manual-input');
    key('M', { shiftKey: true });
    expect(useEditor.getState().pendingShape).toBe('manual-operation');
  });

  it('resolves every binding in the table to its own shape', () => {
    render();
    for (const s of SHAPE_SHORTCUTS) {
      act(() => useEditor.getState().armShape(null));
      key(s.letter, { shiftKey: s.shift });
      expect(
        useEditor.getState().pendingShape,
        `${s.letter}${s.shift ? ' (shift)' : ''} should arm ${s.kind}`,
      ).toBe(s.kind);
    }
  });

  it('places the armed shape where the canvas is clicked, once', () => {
    render();
    key('r');
    down({ x: 300, y: 200 });
    up({ x: 300, y: 200 });
    const d = useEditor.getState().doc;
    const nodes = Object.values(d.nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('rectangle');
    // One press, one shape - a held key cannot rain shapes onto the canvas.
    expect(useEditor.getState().tool).toBe('select');
  });

  it('ignores the auto-repeat of a held key', () => {
    render();
    key('r');
    expect(useEditor.getState().pendingShape).toBe('rectangle');
    key('r', { repeat: true });
    // A repeat must not toggle it back off.
    expect(useEditor.getState().pendingShape).toBe('rectangle');
  });

  it('leaves browser and system chords alone', () => {
    render();
    key('r', { ctrlKey: true }); // reload
    expect(useEditor.getState().pendingShape).toBeNull();
    key('r', { metaKey: true });
    expect(useEditor.getState().pendingShape).toBeNull();
    key('r', { altKey: true });
    expect(useEditor.getState().pendingShape).toBeNull();
  });

  it('keeps the tool letters working and unclaimed by any shape', () => {
    render();
    key('h');
    expect(useEditor.getState().tool).toBe('pan');
    key('c');
    expect(useEditor.getState().tool).toBe('connect');
    key('v');
    expect(useEditor.getState().tool).toBe('select');
    expect(useEditor.getState().pendingShape).toBeNull();
  });
});

/* --------------------------------------------------- shortcut focus scoping */

describe('shortcut focus restrictions', () => {
  it('does nothing while a text field has focus', () => {
    render();
    const input = container.querySelector(
      '.palette-head input',
    ) as HTMLInputElement;
    input.focus();
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
  });

  it('does nothing while the shape text overlay is open', () => {
    render();
    const id = addShape('process', { x: 200, y: 200 });
    act(() => useEditor.getState().setEditingNode(id));
    const ta = container.querySelector('textarea.text-overlay') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    ta.focus();
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
  });

  it('does nothing while the code panel search box has focus', () => {
    render();
    const searchBtn = [...container.querySelectorAll('.code-actions .btn')].find(
      (b) => b.textContent === 'Search',
    ) as HTMLButtonElement;
    act(() => searchBtn.click());
    const input = container.querySelector('.search-row input') as HTMLInputElement;
    input.focus();
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
  });

  it('does nothing while another control, such as a toolbar button, has focus', () => {
    render();
    const btn = container.querySelector('.toolbar .btn') as HTMLButtonElement;
    btn.focus();
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
  });

  it('works again once the board takes focus back', () => {
    render();
    const btn = container.querySelector('.toolbar .btn') as HTMLButtonElement;
    btn.focus();
    key('r');
    expect(useEditor.getState().pendingShape).toBeNull();
    act(() => shell().focus());
    key('r');
    expect(useEditor.getState().pendingShape).toBe('rectangle');
  });

  it('still runs the editing shortcuts that were never board-scoped', () => {
    render();
    const id = addShape('process', { x: 200, y: 200 });
    const btn = container.querySelector('.toolbar .btn') as HTMLButtonElement;
    btn.focus();
    act(() => useEditor.getState().setSelection([id]));
    key('Delete');
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(0);
    key('z', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(1);
  });
});

/* ---------------------------------------------------------- existing keys */

describe('existing keyboard shortcuts still work', () => {
  it('undoes and redoes', () => {
    render();
    addShape('process', { x: 200, y: 200 });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(1);
    key('z', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(0);
    key('y', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(1);
    // Ctrl+Shift+Z is the second spelling of redo, so it is a no-op here.
    key('z', { ctrlKey: true });
    key('z', { ctrlKey: true, shiftKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(1);
  });

  it('selects all, copies, pastes and duplicates', () => {
    render();
    addShape('process', { x: 200, y: 200 });
    key('a', { ctrlKey: true });
    expect(useEditor.getState().selection).toHaveLength(1);
    key('c', { ctrlKey: true });
    key('v', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(2);
    key('d', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(3);
  });

  it('nudges with the arrow keys', () => {
    render();
    const id = addShape('process', { x: 200, y: 200 });
    act(() => useEditor.getState().setSelection([id]));
    const before = useEditor.getState().doc.nodes[id].x;
    key('ArrowRight');
    const step = useEditor.getState().doc.settings.gridSize;
    expect(useEditor.getState().doc.nodes[id].x).toBe(before + step);
    key('ArrowLeft', { shiftKey: true });
    expect(useEditor.getState().doc.nodes[id].x).toBe(before + step - 10);
  });

  it('opens text editing with Enter and cancels with Escape', () => {
    render();
    const id = addShape('process', { x: 200, y: 200 });
    act(() => useEditor.getState().setSelection([id]));
    key('Enter');
    expect(useEditor.getState().editingNodeId).toBe(id);
    key('Escape');
    expect(useEditor.getState().editingNodeId).toBeNull();
    expect(useEditor.getState().selection).toHaveLength(0);
  });

  it('opens the help dialog on ?', () => {
    render();
    key('?');
    expect(container.querySelector('.modal')).toBeTruthy();
  });

  it('registers exactly one key listener however often the app re-renders', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      ...rest: unknown[]
    ) => {
      if (type === 'keydown') added.push(type);
      return (origAdd as (...a: unknown[]) => unknown)(type, ...rest);
    }) as never);
    vi.spyOn(window, 'removeEventListener').mockImplementation(((
      type: string,
      ...rest: unknown[]
    ) => {
      if (type === 'keydown') removed.push(type);
      return (origRemove as (...a: unknown[]) => unknown)(type, ...rest);
    }) as never);

    render();
    const afterMount = added.length;
    // Plenty of state churn: the listener must not be torn down and re-added.
    for (let i = 0; i < 6; i++) addShape('process', { x: 100 + i * 20, y: 100 });
    act(() => useEditor.getState().setSelection([]));
    expect(added.length).toBe(afterMount);
    expect(removed.length).toBe(0);
  });
});

/* ------------------------------------------------------ drawing-board focus */

describe('drawing board focus state', () => {
  it('is a real focus target and shows a ring when focused', () => {
    render();
    expect(shell().getAttribute('tabindex')).toBe('0');
    act(() => shell().blur());
    act(() => useEditor.getState().setBoardFocused(false));
    expect(shell().className).not.toContain('is-focused');
    act(() => shell().focus());
    expect(shell().className).toContain('is-focused');
    expect(useEditor.getState().boardFocused).toBe(true);
  });

  it('activates when empty canvas is clicked', () => {
    render();
    act(() => shell().blur());
    down({ x: 900, y: 900 });
    up({ x: 900, y: 900 });
    expect(document.activeElement).toBe(shell());
    expect(useEditor.getState().boardFocused).toBe(true);
  });

  it('activates when an object on the canvas is clicked', () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => shell().blur());
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    up({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(useEditor.getState().boardFocused).toBe(true);
    expect(useEditor.getState().selection).toEqual([id]);
  });

  it('releases when another major area takes focus', () => {
    render();
    act(() => shell().focus());
    expect(useEditor.getState().boardFocused).toBe(true);
    const input = container.querySelector('.palette-head input') as HTMLInputElement;
    act(() => input.focus());
    expect(useEditor.getState().boardFocused).toBe(false);
    expect(shell().className).not.toContain('is-focused');
  });

  it('never records focus changes in the undo history', () => {
    render();
    addShape('process', { x: 200, y: 200 });
    const depth = useEditor.getState().past.length;
    act(() => shell().blur());
    act(() => shell().focus());
    act(() => shell().blur());
    expect(useEditor.getState().past.length).toBe(depth);
  });
});

/* ------------------------------------------------------------ shape palette */

describe('shape palette', () => {
  it('shows a shortcut badge on every shape, matching the shared table', () => {
    render();
    const buttons = [...container.querySelectorAll('.shape-btn')];
    expect(buttons.length).toBe(SHAPE_LIST.length);
    for (const def of SHAPE_LIST) {
      const btn = buttons.find((b) =>
        b.getAttribute('aria-label')?.startsWith(def.label),
      ) as HTMLElement;
      expect(btn, `no palette button for ${def.id}`).toBeTruthy();
      const badge = btn.querySelector('.shape-key');
      const sc = shortcutForShape(def.id)!;
      expect(badge?.textContent, `badge for ${def.id}`).toBe(shortcutLabel(sc));
      // The same binding, spelled for assistive technology.
      expect(btn.getAttribute('aria-keyshortcuts')).toBe(
        sc.shift ? `Shift+${sc.letter}` : sc.letter,
      );
      expect(btn.getAttribute('aria-label')).toContain('press');
    }
  });

  it('keeps the shape preview and name alongside the badge', () => {
    render();
    for (const btn of container.querySelectorAll('.shape-btn')) {
      expect(btn.querySelector('svg')).toBeTruthy();
      expect(btn.querySelector('.shape-name')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('marks the armed shape, whether armed by click or by key', () => {
    render();
    const btn = [...container.querySelectorAll('.shape-btn')].find((b) =>
      b.getAttribute('aria-label')?.startsWith('Rectangle'),
    ) as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    act(() => btn.click());
    expect(useEditor.getState().pendingShape).toBe('rectangle');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.className).toContain('on');
    // The keystroke drives the identical state, so the UI agrees either way.
    act(() => btn.click());
    key('r');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

/* -------------------------------------------------------------- hover state */

describe('hover detection', () => {
  /** The hover ring: editor chrome tracing the shape's own outline. */
  const ringsOn = (id: string) => {
    const group = container.querySelector(`[data-object-id="${id}"]`)!;
    return [...group.querySelectorAll('path[data-ui]')].filter(
      (p) => p.getAttribute('stroke') === 'var(--accent)',
    );
  };

  it('highlights a shape from anywhere inside it, not only on its border', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];

    // Dead centre, nowhere near the outline.
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(ringsOn(id)).toHaveLength(1);

    // A quarter of the way in, and on the border itself: all the same shape.
    await move({ x: n.x + n.w / 4, y: n.y + n.h / 4 });
    expect(ringsOn(id)).toHaveLength(1);
    await move({ x: n.x, y: n.y + n.h / 2 });
    expect(ringsOn(id)).toHaveLength(1);

    // Clear of the shape: the highlight goes away.
    await move({ x: n.x - 60, y: n.y - 60 });
    expect(ringsOn(id)).toHaveLength(0);
  });

  it('does not highlight a diamond from the corner of its bounding box', async () => {
    render();
    const id = addShape('decision', { x: 400, y: 400 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    await move({ x: n.x + 2, y: n.y + 2 });
    expect(ringsOn(id)).toHaveLength(0);
    // The middle of the same shape does highlight.
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(ringsOn(id)).toHaveLength(1);
  });

  it('keeps hovering the shape when the pointer is over its text', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() =>
      useEditor.getState().commit((d) => void (d.nodes[id].text = 'Hello there')),
    );
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    const group = container.querySelector(`[data-object-id="${id}"]`)!;
    expect(group.textContent).toContain('Hello there');
    expect(ringsOn(id)).toHaveLength(1);
  });

  it('tells the hovered state apart from the selected state', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    const centre = { x: n.x + n.w / 2, y: n.y + n.h / 2 };

    // Hovered: an outline tracing the shape, and no handles anywhere.
    await move(centre);
    expect(ringsOn(id)).toHaveLength(1);
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(0);

    // Selected: a box with handles, and the hover outline stands down so the
    // two states never pile up on the same shape.
    act(() => useEditor.getState().setSelection([id]));
    await move(centre);
    expect(container.querySelectorAll('[data-handle]').length).toBeGreaterThan(0);
    expect(ringsOn(id)).toHaveLength(0);
  });

  it('hovers without selecting anything', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(useEditor.getState().selection).toEqual([]);
    expect(useEditor.getState().past).toHaveLength(1); // only the creation
  });

  it('gives every shape kind a hittable interior on the canvas', async () => {
    render();
    for (const def of SHAPE_LIST) {
      act(() => useEditor.getState().clearCanvas());
      const id = addShape(def.id, { x: 400, y: 300 });
      act(() => useEditor.getState().clearSelection());
      const n = useEditor.getState().doc.nodes[id];
      await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
      down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
      up({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
      expect(
        useEditor.getState().selection,
        `${def.id} should select from its centre`,
      ).toEqual([id]);
    }
  });
});

/* ------------------------------------------------- selection and dragging */

describe('selection and dragging', () => {
  it('selects the shape under the pointer and deselects on empty canvas', () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + 10, y: n.y + 10 });
    up({ x: n.x + 10, y: n.y + 10 });
    expect(useEditor.getState().selection).toEqual([id]);
    down({ x: 1200, y: 1200 });
    up({ x: 1200, y: 1200 });
    expect(useEditor.getState().selection).toEqual([]);
  });

  it('drags from the shape body and records one undo step for the gesture', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const before = { ...useEditor.getState().doc.nodes[id] };
    const depth = useEditor.getState().past.length;

    const start = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
    down(start);
    await move({ x: start.x + 40, y: start.y + 30 });
    await move({ x: start.x + 80, y: start.y + 60 });
    up({ x: start.x + 80, y: start.y + 60 });

    const after = useEditor.getState().doc.nodes[id];
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    // Many pointer events, one history entry.
    expect(useEditor.getState().past.length).toBe(depth + 1);
    expect(useEditor.getState().selection).toEqual([id]);

    key('z', { ctrlKey: true });
    expect(useEditor.getState().doc.nodes[id].x).toBe(before.x);
  });

  it('follows a slow drag made of small steps instead of sticking to the grid', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const before = { ...useEditor.getState().doc.nodes[id] };
    // Placement snaps to the grid, so the shape starts exactly on it - the
    // worst case for snapping applied to each increment rather than to the
    // gesture as a whole.
    const grid = useEditor.getState().doc.settings.gridSize;
    expect(before.x % grid).toBe(0);

    const start = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
    down(start);
    // Forty three-pixel steps: every one of them smaller than the snap
    // tolerance. The shape must still travel the full distance.
    for (let i = 1; i <= 40; i++) {
      await move({ x: start.x + i * 3, y: start.y });
    }
    up({ x: start.x + 120, y: start.y });

    const after = useEditor.getState().doc.nodes[id];
    expect(after.x - before.x).toBeGreaterThanOrEqual(114);
    expect(after.x - before.x).toBeLessThanOrEqual(126);
  });

  it('keeps the shape under the pointer through a drag that reverses', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const before = { ...useEditor.getState().doc.nodes[id] };
    const start = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
    down(start);
    await move({ x: start.x + 200, y: start.y + 150 });
    await move({ x: start.x + 60, y: start.y + 40 });
    // Back to where it began: the shape comes back with it.
    await move(start);
    up(start);
    const after = useEditor.getState().doc.nodes[id];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('holds the alignment guides steady rather than rewriting them every frame', async () => {
    render();
    addShape('process', { x: 300, y: 200 });
    const b = addShape('process', { x: 305, y: 500 });
    const nb = useEditor.getState().doc.nodes[b];
    const start = { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 };
    down(start);
    // Line the two shapes up, so a guide is showing.
    await move({ x: start.x - 5, y: start.y });
    const guides = useEditor.getState().guides;
    expect(guides.length).toBeGreaterThan(0);
    // Further frames at the same alignment must reuse it rather than writing
    // an identical array to the store and re-rendering the canvas for nothing.
    await move({ x: start.x - 5, y: start.y });
    await move({ x: start.x - 5, y: start.y });
    expect(useEditor.getState().guides).toBe(guides);
    up({ x: start.x - 5, y: start.y });
    // And they are cleared when the gesture ends.
    expect(useEditor.getState().guides).toEqual([]);
  });

  it('records nothing when a drag changes nothing', () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const n = useEditor.getState().doc.nodes[id];
    const depth = useEditor.getState().past.length;
    const p = { x: n.x + 5, y: n.y + 5 };
    down(p);
    up(p);
    expect(useEditor.getState().past.length).toBe(depth);
  });

  it('marquee-selects across empty canvas', async () => {
    render();
    const a = addShape('process', { x: 250, y: 250 });
    const b = addShape('process', { x: 250, y: 420 });
    act(() => useEditor.getState().clearSelection());
    down({ x: 60, y: 60 });
    await move({ x: 700, y: 700 });
    up({ x: 700, y: 700 });
    expect(useEditor.getState().selection.sort()).toEqual([a, b].sort());
  });
});

/* ------------------------------------- resize handles vs connection points */

describe('resize handles and connection points are separate systems', () => {
  it('draws resize handles on the boundary and connection points outside it', () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const n = useEditor.getState().doc.nodes[id];

    const handles = [...container.querySelectorAll('[data-handle]')].filter(
      (h) => h.getAttribute('data-handle') !== 'rotate',
    );
    expect(handles).toHaveLength(8);
    const ports = [...container.querySelectorAll('[data-port]')];
    expect(ports.length).toBeGreaterThanOrEqual(4);

    // Resize handles are squares sitting on the selection box.
    for (const h of handles) {
      expect(h.tagName.toLowerCase()).toBe('rect');
    }
    // Connection points are circles, and every one of them is outside the box.
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    for (const p of ports) {
      expect(p.tagName.toLowerCase()).toBe('circle');
      const cx = Number(p.getAttribute('cx'));
      const cy = Number(p.getAttribute('cy'));
      const outside =
        cx < box.x - 0.5 ||
        cx > box.x + box.w + 0.5 ||
        cy < box.y - 0.5 ||
        cy > box.y + box.h + 0.5;
      expect(outside, `port at ${cx},${cy} should sit outside the outline`).toBe(
        true,
      );
    }
  });

  it('keeps a clear gap between every handle and every connection point', () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const n = useEditor.getState().doc.nodes[id];
    const hs = Object.values(handlePositions({ x: n.x, y: n.y, w: n.w, h: n.h }));
    const ports = [...container.querySelectorAll('[data-port]')].map((p) => ({
      x: Number(p.getAttribute('cx')),
      y: Number(p.getAttribute('cy')),
    }));
    // The nearest a handle and a port may come is the gap less half a handle.
    const floor = PORT_GAP - HANDLE_SIZE / 2 - 0.01;
    for (const h of hs) {
      for (const p of ports) {
        expect(
          Math.hypot(h.x - p.x, h.y - p.y),
          'a connection point is overlapping a resize handle',
        ).toBeGreaterThan(floor);
      }
    }
  });

  it('keeps the rotate handle clear of the connection points too', () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const rotate = container.querySelector('[data-handle="rotate"]')!;
    const r = {
      x: Number(rotate.getAttribute('cx')),
      y: Number(rotate.getAttribute('cy')),
    };
    const ports = [...container.querySelectorAll('[data-port]')].map((p) => ({
      x: Number(p.getAttribute('cx')),
      y: Number(p.getAttribute('cy')),
    }));
    // It sits beyond the north connection point, not squeezed between that
    // point and the north resize handle.
    for (const p of ports) {
      expect(Math.hypot(r.x - p.x, r.y - p.y)).toBeGreaterThan(
        ROTATE_OFFSET - PORT_GAP - 1,
      );
    }
    const n = useEditor.getState().doc.nodes[id];
    expect(n.y - r.y).toBeCloseTo(ROTATE_OFFSET, 5);
  });

  it('moves the connection points with the shape when it is resized', async () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const readPorts = () =>
      [...container.querySelectorAll('[data-port]')].map((p) => ({
        id: p.getAttribute('data-port'),
        x: Number(p.getAttribute('cx')),
        y: Number(p.getAttribute('cy')),
      }));
    const before = readPorts();

    const n = useEditor.getState().doc.nodes[id];
    const handle = container.querySelector('[data-handle="se"]')!;
    down({ x: n.x + n.w, y: n.y + n.h }, {}, handle);
    await move({ x: n.x + n.w + 120, y: n.y + n.h + 80 });
    up({ x: n.x + n.w + 120, y: n.y + n.h + 80 });

    const grown = useEditor.getState().doc.nodes[id];
    expect(grown.w).toBeGreaterThan(n.w);
    expect(grown.h).toBeGreaterThan(n.h);

    const after = readPorts();
    const eBefore = before.find((p) => p.id === 'e')!;
    const eAfter = after.find((p) => p.id === 'e')!;
    expect(eAfter.x).toBeGreaterThan(eBefore.x);
    // Still outside the new outline, by the same clearance.
    expect(eAfter.x).toBeGreaterThan(grown.x + grown.w);
  });

  it('never inverts a shape when a handle is dragged past the far edge', async () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const n = useEditor.getState().doc.nodes[id];
    const handle = container.querySelector('[data-handle="se"]')!;
    down({ x: n.x + n.w, y: n.y + n.h }, {}, handle);
    await move({ x: n.x - 400, y: n.y - 400 });
    up({ x: n.x - 400, y: n.y - 400 });
    const after = useEditor.getState().doc.nodes[id];
    expect(after.w).toBeGreaterThan(0);
    expect(after.h).toBeGreaterThan(0);
    expect(after.w).toBeGreaterThanOrEqual(12);
    expect(after.h).toBeGreaterThanOrEqual(12);
  });

  it('starts a resize only from a handle, never from the shape body', async () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    await move({ x: n.x + n.w / 2 + 90, y: n.y + n.h / 2 + 90 });
    up({ x: n.x + n.w / 2 + 90, y: n.y + n.h / 2 + 90 });
    const after = useEditor.getState().doc.nodes[id];
    // The body drags; it does not resize.
    expect(after.w).toBe(n.w);
    expect(after.h).toBe(n.h);
    expect(after.x).not.toBe(n.x);
  });

  it('offers fewer, uncrowded connection points on a very small shape', () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() =>
      useEditor.getState().commit((d) => {
        d.nodes[id].w = 20;
        d.nodes[id].h = 16;
      }),
    );
    act(() => useEditor.getState().setSelection([id]));
    const ports = [...container.querySelectorAll('[data-port]')].map((p) =>
      p.getAttribute('data-port'),
    );
    expect(ports.sort()).toEqual(['e', 'n', 's', 'w']);
  });
});

/* ------------------------------------------------------ connector creation */

describe('connector creation', () => {
  function twoShapes() {
    const a = addShape('process', { x: 300, y: 200 });
    const b = addShape('process', { x: 300, y: 520 });
    return { a, b };
  }

  it('drags from a connection point onto another shape and binds both ends', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));

    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    expect(port).toBeTruthy();
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);

    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });

    const edges = Object.values(useEditor.getState().doc.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0].source.nodeId).toBe(a);
    expect(edges[0].source.port).toBe('s');
    expect(edges[0].target.nodeId).toBe(b);
    expect(consoleErrors).toEqual([]);
  });

  it('snaps to the connection point the pointer is closest to', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);

    // Aim at the target's north connection point, which sits PORT_GAP above it.
    const nb = useEditor.getState().doc.nodes[b];
    const target = { x: nb.x + nb.w / 2, y: nb.y - PORT_GAP };
    await move(target);
    // It should be lit before the button is released.
    expect(
      container.querySelector('circle[fill="url(#port-glow)"]'),
      'the target connection point should be highlighted before release',
    ).toBeTruthy();
    up(target);

    const edge = Object.values(useEditor.getState().doc.edges)[0];
    expect(edge.target.nodeId).toBe(b);
    expect(edge.target.port).toBe('n');
  });

  it('shows the target shape’s connection points while connecting', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    expect(
      container.querySelector(`[data-port-host="${b}"]`),
      'the shape being aimed at should offer its connection points',
    ).toBeTruthy();
    up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
  });

  it('leaves the endpoint floating when dropped on empty canvas', async () => {
    render();
    const a = addShape('process', { x: 300, y: 200 });
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="e"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w, y: na.y + na.h / 2 }, {}, port);
    await move({ x: 900, y: 900 });
    up({ x: 900, y: 900 });
    const edge = Object.values(useEditor.getState().doc.edges)[0];
    expect(edge.source.nodeId).toBe(a);
    expect(edge.target.nodeId).toBeUndefined();
    expect(edge.target.point).toBeTruthy();
  });

  it('keeps the connector attached when either shape moves', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });

    const e = Object.keys(useEditor.getState().doc.edges)[0];
    const pathOf = () =>
      container
        .querySelector(`[data-object-id="${e}"] path:not([data-hit])`)!
        .getAttribute('d');
    const before = pathOf();
    act(() => useEditor.getState().commit((d) => void (d.nodes[a].x += 140)));
    expect(pathOf()).not.toBe(before);
    // Still bound to both shapes, not orphaned.
    const edge = useEditor.getState().doc.edges[e];
    expect(edge.source.nodeId).toBe(a);
    expect(edge.target.nodeId).toBe(b);
  });

  it('undoes and redoes a connector drawn with the pointer', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    expect(Object.keys(useEditor.getState().doc.edges)).toHaveLength(1);

    key('z', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.edges)).toHaveLength(0);
    key('y', { ctrlKey: true });
    expect(Object.keys(useEditor.getState().doc.edges)).toHaveLength(1);
  });

  it('survives the source shape disappearing mid-gesture', async () => {
    render();
    const { a, b } = twoShapes();
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
    // Something removes the shape while the connector is being drawn.
    act(() => useEditor.getState().commit((d) => void delete d.nodes[a]));
    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
    expect(() => up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 })).not.toThrow();
    expect(Object.keys(useEditor.getState().doc.edges)).toHaveLength(0);
    expect(consoleErrors).toEqual([]);
  });

  it('connects every shape kind to every other without error', async () => {
    render();
    // A representative sweep: one of each geometry family as source and as
    // target, which is where the port maths differs.
    const kinds = ['process', 'decision', 'connector', 'document', 'database', 'text'];
    for (const from of kinds) {
      for (const to of kinds) {
        act(() => useEditor.getState().clearCanvas());
        const a = addShape(from, { x: 300, y: 200 });
        const b = addShape(to, { x: 300, y: 560 });
        act(() => useEditor.getState().setSelection([a]));
        const port = container.querySelector(
          `[data-port="s"][data-port-node="${a}"]`,
        ) as Element;
        expect(port, `${from} should offer a south connection point`).toBeTruthy();
        const na = useEditor.getState().doc.nodes[a];
        down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
        const nb = useEditor.getState().doc.nodes[b];
        await move({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
        up({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 });
        const edges = Object.values(useEditor.getState().doc.edges);
        expect(edges, `${from} -> ${to}`).toHaveLength(1);
        expect(edges[0].target.nodeId).toBe(b);
      }
    }
    expect(consoleErrors).toEqual([]);
  });
});

/* --------------------------------------------------------- error handling */

describe('awkward moments do not throw', () => {
  it('survives the dragged shape being deleted mid-gesture', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    await move({ x: n.x + n.w / 2 + 50, y: n.y + n.h / 2 });
    act(() => useEditor.getState().deleteSelection());
    await move({ x: n.x + n.w / 2 + 120, y: n.y + n.h / 2 + 40 });
    expect(() => up({ x: n.x + n.w / 2 + 120, y: n.y + n.h / 2 + 40 })).not.toThrow();
    expect(consoleErrors).toEqual([]);
  });

  it('survives a tool change during a drag', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    await move({ x: n.x + n.w / 2 + 40, y: n.y + n.h / 2 });
    // A letter shortcut arrives mid-gesture.
    key('c');
    key('r');
    await move({ x: n.x + n.w / 2 + 80, y: n.y + n.h / 2 });
    expect(() => up({ x: n.x + n.w / 2 + 80, y: n.y + n.h / 2 })).not.toThrow();
    expect(consoleErrors).toEqual([]);
    expect(useEditor.getState().doc.nodes[id]).toBeTruthy();
  });

  it('survives undo landing in the middle of a resize', async () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const n = useEditor.getState().doc.nodes[id];
    const handle = container.querySelector('[data-handle="se"]')!;
    down({ x: n.x + n.w, y: n.y + n.h }, {}, handle);
    await move({ x: n.x + n.w + 60, y: n.y + n.h + 40 });
    key('z', { ctrlKey: true });
    await move({ x: n.x + n.w + 120, y: n.y + n.h + 80 });
    expect(() => up({ x: n.x + n.w + 120, y: n.y + n.h + 80 })).not.toThrow();
    expect(consoleErrors).toEqual([]);
  });

  it('survives Escape landing in the middle of a gesture', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    const n = useEditor.getState().doc.nodes[id];
    down({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    await move({ x: n.x + n.w / 2 + 40, y: n.y + n.h / 2 });
    key('Escape');
    await move({ x: n.x + n.w / 2 + 90, y: n.y + n.h / 2 });
    expect(() => up({ x: n.x + n.w / 2 + 90, y: n.y + n.h / 2 })).not.toThrow();
    expect(consoleErrors).toEqual([]);
  });

  it('lets go of the hover when the pointer moves off the shape', async () => {
    render();
    const id = addShape('process', { x: 300, y: 300 });
    act(() => useEditor.getState().clearSelection());
    const n = useEditor.getState().doc.nodes[id];
    const lit = () =>
      [
        ...container
          .querySelector(`[data-object-id="${id}"]`)!
          .querySelectorAll('path[data-ui]'),
      ].filter((p) => p.getAttribute('stroke') === 'var(--accent)').length;

    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(lit()).toBe(1);
    // Far away, then back: nothing is left stuck in the hovered state.
    await move({ x: n.x + 2000, y: n.y + 2000 });
    expect(lit()).toBe(0);
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    expect(lit()).toBe(1);
    expect(consoleErrors).toEqual([]);
  });

  it('ignores a resize gesture when the selection is only locked shapes', async () => {
    render();
    const id = addShape('rectangle', { x: 400, y: 300 });
    act(() => useEditor.getState().setSelection([id]));
    const handle = container.querySelector('[data-handle="se"]')!;
    act(() => useEditor.getState().toggleLock());
    const n = useEditor.getState().doc.nodes[id];
    expect(n.locked).toBe(true);
    down({ x: n.x + n.w, y: n.y + n.h }, {}, handle);
    await move({ x: n.x + n.w + 150, y: n.y + n.h + 150 });
    up({ x: n.x + n.w + 150, y: n.y + n.h + 150 });
    const after = useEditor.getState().doc.nodes[id];
    expect(after.w).toBe(n.w);
    expect(after.h).toBe(n.h);
    expect(consoleErrors).toEqual([]);
  });

  it('exports an empty diagram without complaint', async () => {
    const { buildSvgString } = await import('../export/svg');
    render();
    expect(() => buildSvgString(svg(), useEditor.getState().doc)).not.toThrow();
    const out = buildSvgString(svg(), useEditor.getState().doc);
    expect(out).toContain('<svg');
  });

  it('accepts shortcuts pressed before anything has been drawn', () => {
    render();
    expect(() => {
      key('r');
      key('Delete');
      key('z', { ctrlKey: true });
      key('a', { ctrlKey: true });
      key('ArrowUp');
    }).not.toThrow();
    expect(consoleErrors).toEqual([]);
  });
});

/* ------------------------------------------------------ output correctness */

describe('the generated LaTeX after pointer work', () => {
  it('describes what was actually drawn, and lints clean', async () => {
    render();
    const a = addShape('decision', { x: 300, y: 200 });
    const b = addShape('terminator', { x: 300, y: 560 });
    act(() =>
      useEditor.getState().commit((d) => {
        d.nodes[a].text = 'Approved? 50% & rising';
        d.nodes[b].text = 'Done';
      }),
    );
    act(() => useEditor.getState().setSelection([a]));
    const port = container.querySelector(
      `[data-port="s"][data-port-node="${a}"]`,
    ) as Element;
    const na = useEditor.getState().doc.nodes[a];
    down({ x: na.x + na.w / 2, y: na.y + na.h }, {}, port);
    const nb = useEditor.getState().doc.nodes[b];
    await move({ x: nb.x + nb.w / 2, y: nb.y - PORT_GAP });
    up({ x: nb.x + nb.w / 2, y: nb.y - PORT_GAP });

    const doc = useEditor.getState().doc;
    const res = generateLatex(doc, { mode: 'standalone', comments: true });
    const lint = lintLatex(res.code, { standalone: true });
    expect(lint.problems).toEqual([]);
    expect(res.code).toContain('shape=diamond');
    expect(res.code).toContain('rounded rectangle');
    expect(res.code).toContain('fcedge');
    expect(res.code).toContain('50\\% \\& rising');
    // The editor chrome added for hit testing and hover never reaches the output.
    expect(res.code).not.toContain('data-ui');
    expect(res.code).not.toContain('transparent');
  });

  it('keeps the exported SVG free of hit and hover chrome', async () => {
    const { buildSvgString } = await import('../export/svg');
    render();
    const a = addShape('process', { x: 300, y: 200 });
    const b = addShape('process', { x: 300, y: 520 });
    // A connector as well as shapes: each carries its own invisible hit path,
    // and neither belongs in the exported drawing.
    act(() =>
      useEditor.getState().addEdge({
        source: { nodeId: a, port: 's' },
        target: { nodeId: b, port: 'n' },
        routing: 'straight',
      }),
    );
    act(() => useEditor.getState().setSelection([a]));
    const n = useEditor.getState().doc.nodes[a];
    await move({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

    const out = buildSvgString(svg(), useEditor.getState().doc);
    expect(out).not.toContain('data-hit');
    expect(out).not.toContain('data-port');
    expect(out).not.toContain('data-handle');
    expect(out).not.toContain('data-ui');
    expect(out).not.toContain('transparent');
    // The drawing itself survives intact.
    expect(out).toContain('<svg');
    expect(out).toContain(`data-object-id="${a}"`);
    expect(out).toContain('#1f2933');
  });
});
