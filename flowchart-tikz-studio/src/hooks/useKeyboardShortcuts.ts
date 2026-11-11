import { openScienceEditor } from '../science/editing';
import { useEffect, useRef } from 'react';
import { useEditor } from '../state/store';
import { useTour } from '../state/tourStore';
import { serialize } from '../persistence/schema';
import { downloadText, slugify } from '../export/file';

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'V', description: 'Select tool' },
  { keys: 'H', description: 'Pan tool (or hold Alt / middle mouse while dragging)' },
  { keys: 'C', description: 'Connect tool' },
  { keys: 'Ctrl/Cmd + Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd + Y', description: 'Redo' },
  { keys: 'Ctrl/Cmd + Shift + Z', description: 'Redo' },
  { keys: 'Ctrl/Cmd + C', description: 'Copy selection' },
  { keys: 'Ctrl/Cmd + X', description: 'Cut selection' },
  { keys: 'Ctrl/Cmd + V', description: 'Paste' },
  { keys: 'Ctrl/Cmd + D', description: 'Duplicate' },
  { keys: 'Ctrl/Cmd + A', description: 'Select all' },
  { keys: 'Ctrl/Cmd + S', description: 'Save diagram JSON' },
  { keys: 'Ctrl/Cmd + G', description: 'Group' },
  { keys: 'Ctrl/Cmd + Shift + G', description: 'Ungroup' },
  { keys: 'Delete / Backspace', description: 'Delete selection' },
  { keys: 'Arrow keys', description: 'Nudge by one grid step' },
  { keys: 'Shift + Arrow keys', description: 'Nudge by ten units' },
  { keys: 'Enter / F2', description: 'Edit the selected object (text, chart settings, formula or molecule)' },
  { keys: 'Ctrl/Cmd + +', description: 'Zoom in (also Ctrl + = and numpad +)' },
  { keys: 'Ctrl/Cmd + -', description: 'Zoom out (also numpad -)' },
  { keys: 'Ctrl/Cmd + 0', description: 'Reset zoom to 100%' },
  { keys: 'Ctrl/Cmd + 1', description: 'Fit diagram to the canvas' },
  { keys: 'Ctrl/Cmd + mouse wheel', description: 'Zoom at the pointer' },
  { keys: 'R / Shift + R', description: 'Turn a circuit or physics part by 90 degrees' },
  { keys: 'Escape', description: 'Cancel the current operation' },
  { keys: '?', description: 'Show this list' },
];

/** Tool letters. The only single-letter shortcuts in the application. */
const TOOL_KEYS: Record<string, 'select' | 'pan' | 'connect'> = {
  v: 'select',
  h: 'pan',
  c: 'connect',
};

export const ZOOM_STEP = 1.2;

export type ZoomIntent = 'in' | 'out' | 'reset' | 'fit';

/**
 * What zoom a key chord asks for, if any.
 *
 * Both `key` and `code` are consulted because the two disagree across
 * keyboards: on a US layout Ctrl + "+" reports key "=" (or "+" with Shift),
 * the numpad reports "+" / "Add" with code "NumpadAdd", and several European
 * layouts put "+" on a key whose code is not "Equal" at all. Reading either
 * one alone is what made the shortcut appear dead for some users.
 */
export function zoomIntent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): ZoomIntent | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key;
  const code = e.code ?? '';
  if (key === '+' || key === '=' || key === 'Add' || code === 'Equal' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || key === 'Subtract' || code === 'Minus' || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') return 'reset';
  if (key === '1' || code === 'Digit1' || code === 'Numpad1') return 'fit';
  return null;
}

/** Apply a zoom intent, keeping the middle of the drawing board still. */
export function applyZoom(intent: ZoomIntent, fallbackSize: { width: number; height: number }) {
  const s = useEditor.getState();
  // Measure the board now: panels that fold or widen change its size without
  // a window resize, so a cached size would zoom about the wrong point.
  const el = typeof document !== 'undefined' ? document.querySelector('.canvas-shell') : null;
  const r = el?.getBoundingClientRect();
  const canvasSize = r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : fallbackSize;
  const centre = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  switch (intent) {
    case 'in':
      s.zoomBy(ZOOM_STEP, centre);
      break;
    case 'out':
      s.zoomBy(1 / ZOOM_STEP, centre);
      break;
    case 'reset':
      s.zoomBy(1 / s.view.zoom, centre);
      break;
    case 'fit':
      s.fitToView(canvasSize);
      break;
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Check boxes, radios, colour wells and range sliders take no text.
    return !['checkbox', 'radio', 'button', 'color', 'range', 'file', 'submit'].includes(type);
  }
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

/**
 * Whether a bare letter (the tool keys V, H, C) should act on the drawing board.
 *
 * The board has to own focus - with one deliberate exception. When nothing
 * is focused at all (the page has just loaded, or a dialog has closed and
 * handed focus back to the body) the board is the only thing a letter could
 * sensibly mean, so it still works. Everything else declines.
 */
export function canvasKeysAllowed(
  doc: Document = typeof document === 'undefined'
    ? (undefined as unknown as Document)
    : document,
): boolean {
  if (!doc) return false;
  const active = doc.activeElement as HTMLElement | null;
  if (!active || active === doc.body || active === doc.documentElement) return true;
  if (isTypingTarget(active)) return false;
  const board = doc.querySelector('.canvas-shell');
  return !!board && board.contains(active);
}

function modalOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.querySelector('.modal[aria-modal="true"]')
  );
}

/** Global shortcuts. Ignored while typing into a field (zoom excepted). */
export function useKeyboardShortcuts(opts: {
  onShowHelp: () => void;
  canvasSize: { width: number; height: number };
}) {
  /*
   * The options object is a fresh literal on every render of the caller, so
   * the handler is registered once and reads the current options through a
   * ref instead of being torn down and re-added on every render.
   */
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      /*
       * Zoom first, and everywhere. Ctrl + "+" never types a character, so
       * there is nothing to protect in a text field - and if the app does not
       * take the chord the browser does, zooming the whole interface instead
       * of the drawing. The listener runs in the capture phase so a panel
       * that stops propagation cannot swallow it either.
       */
      // The guided tour owns the keyboard while it runs.
      if (useTour.getState().active) return;

      const zoom = zoomIntent(e);
      if (zoom) {
        e.preventDefault();
        if (!modalOpen() || zoom !== 'fit') applyZoom(zoom, optsRef.current.canvasSize);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target)) return;
      // While a modal dialog is open, the canvas underneath must not react
      // to Delete, arrows or letters.
      if (modalOpen()) return;

      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod) {
        switch (key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'y':
            e.preventDefault();
            s.redo();
            return;
          case 'c':
            s.copySelection();
            return;
          case 'x':
            e.preventDefault();
            s.cutSelection();
            return;
          case 'v':
            e.preventDefault();
            s.paste();
            return;
          case 'd':
            e.preventDefault();
            s.duplicateSelection();
            return;
          case 'a':
            e.preventDefault();
            s.selectAll();
            return;
          case 's':
            e.preventDefault();
            downloadText(
              serialize(s.doc),
              `${slugify(s.doc.name)}.json`,
              'application/json',
            );
            s.markSaved();
            s.setStatus('Diagram saved as JSON.');
            return;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) s.ungroup();
            else s.group();
            return;
          default:
            return;
        }
      }

      switch (key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelection();
          return;
        case 'r':
        case 'R': {
          // Only on electrical and physics parts: the one place quarter turns are routine.
          if (e.ctrlKey || e.metaKey || e.altKey || !canvasKeysAllowed()) return;
          const rotatable = s.selection.filter((i) => /^(circuit|physics)\./.test(s.doc.nodes[i]?.kind ?? ''));
          if (rotatable.length === 0) return;
          e.preventDefault();
          s.rotateSelectionBy(e.shiftKey ? -90 : 90);
          return;
        }
        case 'Escape':
          s.armShape(null);
          s.setTool('select');
          s.setDraft(null);
          s.setEditingNode(null);
          s.clearSelection();
          return;
        case 'Enter':
        case 'F2': {
          const id = s.selection.find((i) => s.doc.nodes[i]);
          if (id) {
            e.preventDefault();
            if (s.doc.nodes[id].chart) {
              // Charts have no free text; Enter opens their settings instead.
              s.requestChartFocus(id);
            } else if (!openScienceEditor(s.doc.nodes[id])) {
              s.setEditingNode(id);
            }
          }
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (s.selection.length === 0) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : s.doc.settings.gridSize || 1;
          const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
          s.beginInteraction();
          s.moveSelection(dx, dy, false);
          s.endInteraction();
          return;
        }
        case '?':
          optsRef.current.onShowHelp();
          return;
        default:
          break;
      }

      /* ------------------------------------------- tool letters, scoped */
      if (e.repeat) return;
      if (e.altKey) return;
      if (!canvasKeysAllowed()) return;

      const tool = TOOL_KEYS[key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        s.setTool(tool);
      }
      // Shapes deliberately have no letter keys: they are placed from the
      // palette only, which keeps typing on the board from ever arming one.
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
